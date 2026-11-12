import { NextResponse } from "next/server";
import { deploymentHealth } from "@/lib/deployment-health";
import { probePedagogicalAiConnection } from "@/lib/pedagogy/openai";

export const dynamic = "force-dynamic";

/**
 * Preview and local only: proves which commit this deployment runs and
 * whether Supabase, the database schema and the model are usable. Booleans,
 * versions and the model name only — never a key, URL or provider message.
 */
export async function GET() {
  if (process.env.VERCEL_ENV === "production") return new NextResponse(null, { status: 404 });
  const health = await deploymentHealth(probePedagogicalAiConnection);
  return NextResponse.json(health, {
    status: health.ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
