// Disposable local stack only. Never accepts a hosted project URL or credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const config = JSON.parse(readFileSync(process.env.FOCUS_LOCAL_STATUS, "utf8"));
const url = new URL(config.API_URL);
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "Only loopback Supabase is permitted");
assert.equal(url.protocol, "http:");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url.href, config.SERVICE_ROLE_KEY, options);
const client = () => createClient(url.href, config.ANON_KEY, options);
const sql = (query) => execFileSync("docker", [
  "exec", "-i", "supabase_db_focus-staging", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1",
], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const ok = (label) => console.log(`PASS ${label}`);
const must = (result, label) => {
  assert.equal(result.error, null, `${label}: ${result.error?.message}`);
  return result.data;
};

const version = must(await client().rpc("focus_schema_version"), "schema version");
assert.equal(version, "20261009120000");
ok("all 29 migrations applied on real Supabase PostgreSQL");

const password = randomBytes(24).toString("base64url");
const teachers = [];
for (const letter of ["a", "b"]) {
  const email = `teacher-${letter}@example.test`;
  const user = must(await admin.auth.admin.createUser({ email, password, email_confirm: true }), "create fictitious teacher").user;
  teachers.push({ email, id: user.id, api: client() });
}
sql(readFileSync("supabase/staging/seed-fictitious.sql", "utf8"));
for (const teacher of teachers) {
  must(await teacher.api.auth.signInWithPassword({ email: teacher.email, password }), "real Auth login");
}
ok("fictitious teachers authenticate through real GoTrue");

execFileSync(process.execPath, ["--import", "tsx", "scripts/staging-rls-check.ts", "--write"], {
  stdio: "inherit",
  env: {
    ...process.env,
    FOCUS_CHECK_SUPABASE_URL: url.href,
    FOCUS_CHECK_SUPABASE_KEY: config.ANON_KEY,
    FOCUS_CHECK_TEACHER_A_EMAIL: teachers[0].email,
    FOCUS_CHECK_TEACHER_B_EMAIL: teachers[1].email,
    FOCUS_CHECK_TEACHER_A_PASSWORD: password,
    FOCUS_CHECK_TEACHER_B_PASSWORD: password,
  },
});

execFileSync(process.execPath, ["--import", "tsx", "scripts/setup-scan-storage.ts", "--commit"], {
  stdio: "inherit",
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url.href, SUPABASE_URL: url.href, SUPABASE_SERVICE_ROLE_KEY: config.SERVICE_ROLE_KEY },
});
const bucket = "focus-scan-imports";
const [a, b] = teachers;
const object = `${a.id}/isolation.pdf`;
const pdf = Buffer.from("%PDF-1.4\n% Fictitious FOCUS storage access test\n%%EOF");
const signed = must(await a.api.storage.from(bucket).createSignedUploadUrl(object), "signed upload token");
must(await a.api.storage.from(bucket).uploadToSignedUrl(object, signed.token, pdf, { contentType: "application/pdf" }), "signed PDF upload");
must(await a.api.storage.from(bucket).download(object), "owner downloads PDF");
ok("private bucket accepts owner signed PDF upload and download");

assert.ok((await b.api.storage.from(bucket).download(object)).error, "other teacher must not download PDF");
assert.ok((await client().storage.from(bucket).download(object)).error, "anonymous must not download PDF");
assert.ok((await b.api.storage.from(bucket).createSignedUploadUrl(`${a.id}/intruder.pdf`)).error, "other teacher must not write owner's prefix");
must(await b.api.storage.from(bucket).remove([object]), "foreign delete is a no-op");
must(await a.api.storage.from(bucket).download(object), "foreign delete preserves owner's PDF");
assert.ok((await a.api.storage.from(bucket).upload(`${a.id}/wrong.txt`, "text", { contentType: "text/plain" })).error, "bucket must reject non-PDF");
ok("cross-teacher and anonymous access denied; foreign delete harmless; MIME restriction enforced");

// Retain the existing Auth session: revocation must be enforced by current
// membership in the database, not by a refreshed token or a frontend check.
must(await admin.from("school_memberships").update({ status: "disabled" }).eq("user_id", a.id).eq("role", "teacher"), "disable teacher membership");
assert.ok((await a.api.storage.from(bucket).download(object)).error, "disabled teacher must not download with old token");
assert.ok((await a.api.storage.from(bucket).createSignedUploadUrl(`${a.id}/disabled.pdf`)).error, "disabled teacher must not upload");
const classes = must(await a.api.from("classes").select("id"), "disabled teacher class query");
assert.equal(classes.length, 0, "disabled teacher must lose class access while retaining assignments");
must(await a.api.storage.from(bucket).remove([object]), "disabled delete is a no-op");
must(await admin.storage.from(bucket).download(object), "disabled delete preserves PDF");
ok("disabled membership revokes database and Storage access with an existing token");

must(await admin.from("school_memberships").update({ status: "active" }).eq("user_id", a.id).eq("role", "teacher"), "reactivate teacher");
must(await a.api.storage.from(bucket).remove([object]), "owner deletes PDF");
assert.ok((await admin.storage.from(bucket).download(object)).error, "owner delete removes PDF");
ok("reactivated teacher can delete their PDF");

// Test storage-policy rollback against real storage.objects, retaining the
// environment-owned bucket, then reapply the exact committed migration.
sql(readFileSync("supabase/rollback/20261007130000_scan_import_storage.down.sql", "utf8"));
assert.ok((await a.api.storage.from(bucket).createSignedUploadUrl(`${a.id}/rolled-back.pdf`)).error);
must(await admin.storage.getBucket(bucket), "rollback preserves bucket");
sql(readFileSync("supabase/migrations/20261007130000_scan_import_storage.sql", "utf8"));
must(await a.api.storage.from(bucket).createSignedUploadUrl(`${a.id}/reapplied.pdf`), "policy reapplication restores upload authorization");
ok("Storage policies roll back and reapply on real Supabase");
