// Administrator tool: create the fictitious FOCUS demonstration school with
// a demo STUDENT account and, on request, a demo DIRECTION login, so the
// Student and Direction spaces can be tried on a deployment. Run from an
// administrator's shell only; the service-role key must never be set in
// Vercel, the application or git.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… \
//   node --import tsx scripts/admin-create-demo-portals.ts --project-ref <ref> [--with-direction-login] [--commit]
//
// Without --commit: read-only — checks the project and that the demo school
// does not exist yet, then prints the plan. With --commit: creates, in a NEW
// school "Établissement de démonstration FOCUS (fictif)", four confirmed
// auth users on the reserved .invalid domain (no e-mail is ever sent; only
// the student — and the direction with --with-direction-login — get a usable
// password, printed once), and their fictitious class, results, answers,
// teacher comments, competency levels and declared lessons. It only inserts;
// it never touches another school, user or row. To remove it later, delete
// that school and the four users (app_metadata.focus_demo = true) from the
// Supabase dashboard.
//
// Prefer a staging project. On the live project, run it only once the owner
// has decided that a demo account may exist there (see the PR).

import { createClient } from "@supabase/supabase-js";
import { demoPlan } from "./demo-portals/plan";
import { seedDemoPortals, type DemoWriter } from "./demo-portals/seed";

function parseArgs(argv: string[]) {
  const value = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    projectRef: value("--project-ref"),
    commit: argv.includes("--commit"),
    directionLogin: argv.includes("--with-direction-login"),
  };
}

async function main() {
  const { projectRef, commit, directionLogin } = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!projectRef || !url || !key) {
    console.error("Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… admin-create-demo-portals.ts --project-ref <ref> [--with-direction-login] [--commit]");
    process.exit(2);
  }
  // The project named on the command line must be the one the URL points to.
  if (new URL(url).hostname !== `${projectRef}.supabase.co`) {
    console.error("SUPABASE_URL does not belong to --project-ref: nothing was done.");
    process.exit(2);
  }
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const writer: DemoWriter = {
    async insert(table, rows, returning = "id") {
      const { data, error } = await admin.from(table).insert(rows).select(returning);
      if (error) throw new Error(`insert into ${table} refused: ${error.code ?? "unknown"}`);
      return (data ?? []) as never[];
    },
    async select(table, columns, equals, options = {}) {
      let query = admin.from(table).select(columns);
      for (const [column, value] of Object.entries(equals)) query = query.eq(column, value);
      if (options.orderBy) query = query.order(options.orderBy);
      if (options.limit) query = query.limit(options.limit);
      const { data, error } = await query;
      if (error) throw new Error(`read of ${table} refused: ${error.code ?? "unknown"}`);
      return (data ?? []) as never[];
    },
    async createUser(person, password) {
      const { data, error } = await admin.auth.admin.createUser({
        email: person.email,
        password,
        email_confirm: true,
        app_metadata: { focus_demo: true },
        user_metadata: { first_name: person.firstName, last_name: person.lastName },
      });
      if (error || !data.user) throw new Error(`account ${person.email} not created: ${error?.code ?? "unknown"}`);
      return data.user.id;
    },
  };

  const plan = demoPlan(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date()), { directionLogin });
  if (directionLogin)
    console.warn(
      "WARNING: until supabase/proposals/20261010100000_direction_read_only_official_data.sql is applied, the demo\n" +
        "direction can write the demo school's data through the API and make itself a teacher there (AI analyses).",
    );
  const existing = await writer.select<{ id: string }>("schools", "id", { name: plan.school });
  console.log(`Plan (${commit ? "COMMIT" : "dry run"}) on project ${projectRef}:`);
  console.log(`  new school "${plan.school}", class "${plan.className}" (${plan.classLevel}), year ${plan.year.name}`);
  for (const person of plan.people) console.log(`  ${person.role.padEnd(7)} ${person.email}${person.login ? " (login)" : " (no login)"}`);
  console.log(`  ${plan.assessments.length} assessments, ${plan.lessons.length} declared lessons, all fictitious`);
  if (existing.length) {
    console.error("The demonstration school already exists: nothing was written.");
    process.exit(1);
  }
  if (!commit) {
    console.log("Dry run: nothing was written. Add --commit to proceed.");
    return;
  }
  const { schoolId, logins } = await seedDemoPortals(writer, plan);
  console.log(`Created school ${schoolId}. Logins (shown once, fictitious accounts):`);
  for (const login of logins) console.log(`  ${login.space}: ${login.path} — ${login.email} / ${login.password}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "unexpected error");
  console.error("If accounts were created before the failure, remove the users with app_metadata.focus_demo = true.");
  process.exit(1);
});
