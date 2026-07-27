import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_ROLE_VALUES } from "@/lib/staff-roles";

const ADMIN_ROUTES = ["/admin"];
const PAYMENT_OFFICER = "payment_officer";
const PAYMENT_OFFICER_HOME = "/admin/payment-requests";
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
function homeFor(role?: string | null): string {
  if (role === PAYMENT_OFFICER) return PAYMENT_OFFICER_HOME;
  return isAdminRole(role) ? "/admin/dashboard" : "/dashboard";
}

/**
 * From ONE list, not a fourth hand-written copy. This must mirror
 * is_admin() in the database — if payment_officer ever appeared here
 * it would be waved through every admin route while the database
 * still refused it, which reads as a broken portal rather than a
 * blocked one.
 */
function isAdminRole(role?: string | null): boolean {
  return ADMIN_ROLE_VALUES.includes(role as never);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
