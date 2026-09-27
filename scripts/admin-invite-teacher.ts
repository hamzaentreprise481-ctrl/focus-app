// Administrator tool: invite a teacher and give them one class/subject.
// Run from an administrator's shell only; the service-role key must never be
// set in Vercel, the application or git.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… \
//   FOCUS_SITE_URL=https://<focus deployment> \
//   node --import tsx scripts/admin-invite-teacher.ts --project-ref <ref> \
//     --email teacher-a@example.test --school <uuid> --class <uuid> --subject <uuid> \
//     [--first-name Alice --last-name Recette] [--commit]
//
// Without --commit it only checks the school, class and subject and prints
// the plan. With --commit it sends the Supabase invitation (the e-mail link
// opens /auth/confirm, then the teacher chooses a password), sets
// app_metadata.role = "teacher" (never user_metadata), and creates the
// profile, school membership and teacher assignment. For fictitious test
// accounts, use an address you control.

import { createClient } from "@supabase/supabase-js";
import { parseInviteArgs } from "../lib/auth/invite-plan";

async function main() {
  const parsed = parseInviteArgs(process.argv.slice(2), process.env);
  if ("error" in parsed) {
    console.error(parsed.error);
    process.exit(2);
  }
  const { plan } = parsed;
  const admin = createClient(plan.supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

  const classRow = (await admin.from("classes").select("id,school_id,name").eq("id", plan.classId).maybeSingle()).data as {
    school_id: string;
    name: string;
  } | null;
  const subjectRow = (await admin.from("subjects").select("id,school_id,name").eq("id", plan.subjectId).maybeSingle()).data as {
    school_id: string;
    name: string;
  } | null;
  if (!classRow || classRow.school_id !== plan.schoolId) throw new Error("The class does not belong to that school.");
  if (!subjectRow || subjectRow.school_id !== plan.schoolId) throw new Error("The subject does not belong to that school.");
  console.log(`Plan (${plan.commit ? "COMMIT" : "dry run"}) on project ${plan.projectRef}:`);
  console.log(`  invite ${plan.email} → ${plan.siteUrl}/auth/confirm?type=invite`);
  console.log(`  role teacher (app_metadata), class "${classRow.name}", subject "${subjectRow.name}"`);
  if (!plan.commit) {
    console.log("Dry run: nothing was sent or written. Add --commit to proceed.");
    return;
  }

  const invited = await admin.auth.admin.inviteUserByEmail(plan.email, { redirectTo: `${plan.siteUrl}/auth/confirm?type=invite` });
  if (invited.error || !invited.data.user) throw new Error(`Invitation refused: ${invited.error?.code ?? "unknown"}`);
  const userId = invited.data.user.id;
  const role = await admin.auth.admin.updateUserById(userId, { app_metadata: { role: "teacher" } });
  if (role.error) throw new Error(`Role not set: ${role.error.code ?? "unknown"}`);
  const writes = [
    await admin.from("profiles").upsert({ id: userId, first_name: plan.firstName, last_name: plan.lastName }),
    await admin.from("school_memberships").insert({ school_id: plan.schoolId, user_id: userId, role: "teacher" }),
    await admin.from("teacher_assignments").insert({ school_id: plan.schoolId, teacher_id: userId, class_id: plan.classId, subject_id: plan.subjectId }),
  ];
  const failed = writes.find((write) => write.error);
  if (failed?.error) throw new Error(`Account created and invited, but its access is incomplete: ${failed.error.code}. Fix it before sharing the link.`);
  console.log("Invitation sent; role, membership and assignment recorded.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "unexpected error");
  process.exit(1);
});
