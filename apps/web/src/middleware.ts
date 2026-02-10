import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const accessToken = request.cookies.get("access_token");
  const refreshToken = request.cookies.get("refresh_token");
  const isLoginPage = request.nextUrl.pathname === "/login";

  // If user has any auth token and tries to visit /login, redirect to home
  if (isLoginPage && (accessToken || refreshToken)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // If no tokens at all, redirect to login
  if (!isLoginPage && !accessToken && !refreshToken) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public files
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
