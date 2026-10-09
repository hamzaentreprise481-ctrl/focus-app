import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/lib/auth/config";
import {
  hasActiveDirectorMembership,
  hasActiveStudentMembership,
  hasActiveTeacherMembership,
  safeDirectorNext,
  safeNext,
  safeStudentNext,
} from "@/lib/auth/policy";

export async function proxy(request: NextRequest) {
  const config = authConfig();
  let response = NextResponse.next({ request });

  const teacherProtected =
    request.nextUrl.pathname === "/app" ||
    request.nextUrl.pathname.startsWith("/app/");
  const studentProtected =
    request.nextUrl.pathname === "/student" ||
    request.nextUrl.pathname.startsWith("/student/");
  const directorProtected =
    request.nextUrl.pathname === "/director" ||
    request.nextUrl.pathname.startsWith("/director/");

  const deny = (kind: "teacher" | "student" | "director") => {
    const url = request.nextUrl.clone();
    url.pathname =
      kind === "teacher"
        ? "/connexion"
        : kind === "student"
          ? "/connexion-eleve"
          : "/connexion-direction";
    url.search = "";
    const requested = request.nextUrl.pathname + request.nextUrl.search;
    url.searchParams.set(
      "next",
      kind === "teacher"
        ? safeNext(requested)
        : kind === "student"
          ? safeStudentNext(requested)
          : safeDirectorNext(requested),
    );
    const redirected = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirected.cookies.set(cookie));
    redirected.headers.set("Cache-Control", "private, no-store");
    return redirected;
  };

  if (!config) {
    if (teacherProtected) return deny("teacher");
    if (studentProtected) return deny("student");
    if (directorProtected) return deny("director");
    return response;
  }

  const supabase = createServerClient(config.url, config.key, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: !!process.env.VERCEL || config.url.startsWith("https:"),
      path: "/",
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (teacherProtected) {
      if (error || !(await hasActiveTeacherMembership(supabase, user)))
        return deny("teacher");
    }
    if (studentProtected) {
      if (error || !(await hasActiveStudentMembership(supabase, user)))
        return deny("student");
    }
    if (directorProtected) {
      if (error || !(await hasActiveDirectorMembership(supabase, user)))
        return deny("director");
    }
  } catch {
    if (teacherProtected) return deny("teacher");
    if (studentProtected) return deny("student");
    if (directorProtected) return deny("director");
  }

  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    "/app/:path*",
    "/student/:path*",
    "/director/:path*",
    "/connexion",
    "/connexion/:path*",
    "/connexion-eleve",
    "/connexion-eleve/:path*",
    "/connexion-direction",
    "/connexion-direction/:path*",
    "/auth/:path*",
  ],
};
