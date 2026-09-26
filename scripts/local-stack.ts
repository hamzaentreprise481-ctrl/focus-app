// Local end-to-end environment: real schema + fictitious school in PGlite,
// Supabase Auth/PostgREST stand-in, scripted model stand-in, and the built
// app (`npm run build` first). Nothing leaves the machine; results produced
// with the scripted model are simulated, never real model outputs.
//
//   npm run build && node --import tsx scripts/local-stack.ts [port]
//
// FOCUS_LOCAL_UP_TO=<migration file> stops the schema at that migration, to
// see how the app behaves against a database that is not up to date.

import { spawn } from "node:child_process";
import { LOCAL_TEACHER, startLocalStack } from "../tests/helpers/local-stack";

async function main() {
  const port = Number(process.argv[2] ?? 3300);
  const stack = await startLocalStack({ supabasePort: 54321, modelPort: 54329, upTo: process.env.FOCUS_LOCAL_UP_TO || undefined });
  const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"], {
    env: { ...process.env, ...stack.env },
    stdio: "inherit",
  });
  console.log(`FOCUS local stack: http://127.0.0.1:${port}/connexion`);
  console.log(`Teacher (fictitious): ${LOCAL_TEACHER.email} / ${LOCAL_TEACHER.password}`);
  const stop = async () => {
    app.kill("SIGTERM");
    await stack.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
