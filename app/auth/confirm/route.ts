import { NextResponse, type NextRequest } from "next/server";
import { createAuthClient } from "@/lib/auth/server";
import { emailLinkType } from "@/lib/auth/password";

export const dynamic = "force-dynamic";

/**
 * Landing point of the password-reset and invitation e-mails. Verifies the
 * one-time token (token_hash + type, or a PKCE code), which opens a session
 * in cookies, then sends the user to choose a password. Fixed destinations
 * only: nothing from the link decides where the user goes.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const type = emailLinkType(url.searchParams.get("type"));
  const tokenHash = url.searchParams.get("token_hash");
  const code = url.searchParams.get("code");
  const supabase = await createAuthClient();
  let verified = false;
  if (supabase) {
    try {
      if (tokenHash && type) verified = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
      else if (code) verified = !(await supabase.auth.exchangeCodeForSession(code)).error;
    } catch {
      verified = false;
    }
  }
  const target = verified
    ? `/connexion/nouveau-mot-de-passe${type === "invite" ? "?bienvenue=1" : ""}`
    : "/connexion/mot-de-passe-oublie?lien=invalide";
  const response = NextResponse.redirect(new URL(target, url.origin));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
