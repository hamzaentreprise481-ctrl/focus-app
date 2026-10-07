// FOCUS Scan Storage setup — administrator-only.
//
// Dry run by default:
//   npm run setup:scan-storage
//
// Apply the bucket configuration:
//   npm run setup:scan-storage -- --commit
//
// SUPABASE_SERVICE_ROLE_KEY must exist only in the administrator shell.
// Never set it in Vercel or expose it to the browser.

import { createClient } from "@supabase/supabase-js";

const BUCKET = "focus-scan-imports";
const FILE_SIZE_LIMIT = 50_000_000;
const ALLOWED_MIME_TYPES = ["application/pdf"];

function fail(message: string): never {
  console.error(`BLOQUÉ : ${message}`);
  process.exit(2);
}

function client() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    fail(
      "définissez NEXT_PUBLIC_SUPABASE_URL (ou SUPABASE_URL) et SUPABASE_SERVICE_ROLE_KEY dans votre terminal local uniquement.",
    );
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail("l’URL Supabase est invalide.");
  }
  const loopback =
    parsed!.hostname === "localhost" || parsed!.hostname === "127.0.0.1";
  if (parsed!.protocol !== "https:" && !loopback)
    fail("l’URL Supabase doit être en https.");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function main() {
  const commit = process.argv.slice(2).includes("--commit");
  const supabase = client();

  const existing = await supabase.storage.getBucket(BUCKET);
  if (existing.error && !/not found|does not exist/i.test(existing.error.message))
    throw new Error(`Lecture du bucket refusée : ${existing.error.message}`);

  const desired = {
    public: false,
    fileSizeLimit: FILE_SIZE_LIMIT,
    allowedMimeTypes: ALLOWED_MIME_TYPES,
  };

  if (!commit) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          bucket: BUCKET,
          exists: Boolean(existing.data),
          desired,
          action: existing.data ? "update" : "create",
        },
        null,
        2,
      ),
    );
    console.log("\nAucun changement effectué. Ajoutez --commit pour appliquer.");
    return;
  }

  const result = existing.data
    ? await supabase.storage.updateBucket(BUCKET, desired)
    : await supabase.storage.createBucket(BUCKET, desired);

  if (result.error)
    throw new Error(
      `${existing.data ? "Mise à jour" : "Création"} du bucket refusée : ${result.error.message}`,
    );

  const verified = await supabase.storage.getBucket(BUCKET);
  if (verified.error || !verified.data)
    throw new Error("Le bucket a été écrit mais sa relecture a échoué.");

  if (
    verified.data.public !== false ||
    verified.data.file_size_limit !== FILE_SIZE_LIMIT ||
    JSON.stringify([...(verified.data.allowed_mime_types ?? [])].sort()) !==
      JSON.stringify([...ALLOWED_MIME_TYPES].sort())
  )
    throw new Error(
      "La configuration relue ne correspond pas à la configuration FOCUS attendue.",
    );

  console.log(
    `✓ ${BUCKET} configuré : privé, PDF uniquement, limite 50 000 000 octets.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
