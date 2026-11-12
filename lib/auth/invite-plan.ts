// Validation of an administrator's teacher invitation (scripts/admin-invite-teacher.ts).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface InvitePlan {
  supabaseUrl: string;
  projectRef: string;
  siteUrl: string;
  email: string;
  schoolId: string;
  classId: string;
  subjectId: string;
  firstName: string | null;
  lastName: string | null;
  commit: boolean;
}

export function parseInviteArgs(argv: string[], env: Record<string, string | undefined>): { plan: InvitePlan } | { error: string } {
  const value = (name: string) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl || !env.SUPABASE_SERVICE_ROLE_KEY) return { error: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in this shell (never in the app)." };
  let host: string;
  try {
    host = new URL(supabaseUrl).hostname;
  } catch {
    return { error: "SUPABASE_URL is not a URL." };
  }
  const projectRef = host.split(".")[0];
  if (value("project-ref") !== projectRef) return { error: `Confirm the target with --project-ref ${projectRef}.` };
  const siteUrl = env.FOCUS_SITE_URL;
  if (!siteUrl || !/^https:\/\//.test(siteUrl)) return { error: "FOCUS_SITE_URL must be the HTTPS address of the FOCUS deployment the invitation opens." };
  const email = (value("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { error: "--email must be an e-mail address." };
  const schoolId = value("school") ?? "";
  const classId = value("class") ?? "";
  const subjectId = value("subject") ?? "";
  for (const [name, id] of [["school", schoolId], ["class", classId], ["subject", subjectId]] as const)
    if (!UUID.test(id)) return { error: `--${name} must be a UUID.` };
  return {
    plan: {
      supabaseUrl,
      projectRef,
      siteUrl: new URL(siteUrl).origin,
      email,
      schoolId,
      classId,
      subjectId,
      firstName: value("first-name")?.trim().slice(0, 80) || null,
      lastName: value("last-name")?.trim().slice(0, 80) || null,
      commit: argv.includes("--commit"),
    },
  };
}
