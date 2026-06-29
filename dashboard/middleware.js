import { NextResponse } from "next/server";

export function middleware(request) {
  const authCookie =
    request.cookies.get("sb-hloqddmdwinvjksqkhey-auth-token") ||
    request.cookies.get("sb-hloqddmdwinvjksqkhey-auth-token.0");

  const isPublic =
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname.startsWith("/_next") ||
    request.nextUrl.pathname.startsWith("/api") ||
    request.nextUrl.pathname === "/favicon.ico";

  if (!authCookie && !isPublic) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
