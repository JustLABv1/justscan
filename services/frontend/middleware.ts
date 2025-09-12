import type { NextRequest } from "next/server";

import { NextResponse } from "next/server";

import "./updateSessionInterval";
import ValidateToken from "./lib/fetch/tokens/validate";

function isPublicRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".gif") ||
    pathname.endsWith(".json") ||
    pathname.endsWith(".js")
  );
}

function isAuthRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/auth/login") || pathname.startsWith("/auth/signup")
  );
}

function isSetupRoute(pathname: string): boolean {
  return pathname.startsWith("/setup");
}

function createResponseWithPathname(pathname: string) {
  const response = NextResponse.next();

  response.headers.set("x-pathname", pathname);

  return response;
}

export async function middleware(request: NextRequest) {
  try {
    const { pathname } = new URL(request.url);
    const cookies = request.cookies;
    const hasSessionCookie = cookies.has("session");
    const userCookie = cookies.get("user");
    const userData = userCookie ? JSON.parse(userCookie.value) : null;

    // Skip public/static routes
    if (isPublicRoute(pathname)) {
      return createResponseWithPathname(pathname);
    }

    // Allow setup routes without authentication
    if (isSetupRoute(pathname)) {
      return createResponseWithPathname(pathname);
    }

    // Validate token for protected routes
    const res = await ValidateToken();

    if (!res.success) {
      cookies.delete("session");
      cookies.delete("user");
      // Only redirect if not already on auth route
      if (!isAuthRoute(pathname)) {
        return NextResponse.redirect(new URL("/auth/login", request.url));
      }

      return createResponseWithPathname(pathname);
    }

    // Admin route protection
    if (
      pathname.startsWith("/admin") &&
      (!userData || userData.role !== "admin")
    ) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    // Auth routes: redirect if already logged in
    if (isAuthRoute(pathname) && hasSessionCookie) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    // Auth routes: allow access if not logged in
    if (isAuthRoute(pathname) && !hasSessionCookie) {
      return createResponseWithPathname(pathname);
    }

    // Require login for protected routes
    if (!hasSessionCookie) {
      return NextResponse.redirect(new URL("/auth/login", request.url));
    }

    // Add pathname header for layout to use
    return createResponseWithPathname(pathname);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Middleware error:", error);

    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
