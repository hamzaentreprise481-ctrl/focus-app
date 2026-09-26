import { NextResponse } from "next/server";
import { probePedagogicalAiConnection } from "@/lib/pedagogy/openai";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.VERCEL_ENV === "production")
    return new NextResponse(null, { status: 404 });

  const result = await probePedagogicalAiConnection();
  return NextResponse.json(
    {
      service: "focus-pedagogical-ai",
      environment: process.env.VERCEL_ENV || "local",
      ...result,
    },
    {
      status: result.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
