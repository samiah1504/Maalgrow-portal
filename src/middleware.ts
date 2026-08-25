import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  homeForRole as homeFor,
  isAdminRole,
  PAYMENT_OFFICER,
  PAYMENT_OFFICER_HOME,
} from "@/lib/home-for-role";

const ADMIN_ROUTES = ["/admin"];
const PUBLIC_ROUTES = ["/login", "/forgot-password", "/reset-password", "/auth/callback"];

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Allow public routes
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    // Redirect authenticated users away from auth pages
    if (user && (pathname === "/login" || pathname === "/forgot-password")) {
      const profile = await getProfile(supabase, user.id);
      return NextResponse.redirect(new URL(homeFor(profile?.role), request.url));
    }
    return supabaseResponse;
  }

  // Root path redirect
  if (pathname === "/") {
    if (!user) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    const profile = await getProfile(supabase, user.id);
    return NextResponse.redirect(new URL(homeFor(profile?.role), request.url));
  }

  // Protected routes require authentication
  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Admin routes require admin role
  if (ADMIN_ROUTES.some((route) => pathname.startsWith(route))) {
    const profile = await getProfile(supabase, user.id);

    // The Payment Officer is not an admin — deliberately, so that
    // every is_admin() policy in the database refuses them. Here they
    // get the one route their job needs and nothing else. This is the
    // convenience half; the database is the half that matters.
    if (profile?.role === PAYMENT_OFFICER) {
      return pathname.startsWith(PAYMENT_OFFICER_HOME)
        ? supabaseResponse
        : NextResponse.redirect(new URL(PAYMENT_OFFICER_HOME, request.url));
    }

    if (!isAdminRole(profile?.role)) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return supabaseResponse;
}

async function getProfile(supabase: ReturnType<typeof createServerClient>, userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();
  return data;
}

/** Where signing in lands you. An officer has one page; that is it. */


export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
