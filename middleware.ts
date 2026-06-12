import { NextRequest, NextResponse } from "next/server";

const authCookieName = "servefit_admin";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicRoute =
    pathname === "/login" ||
    pathname.startsWith("/reports/") ||
    pathname.startsWith("/api/reports/") ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/api/logout") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico";
  const isAuthed = request.cookies.get(authCookieName)?.value === "1";

  if (pathname === "/login" && isAuthed) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!isPublicRoute && !isAuthed) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"],
};
