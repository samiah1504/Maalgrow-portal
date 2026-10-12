/**
 * Shared plumbing for the MaalRise API routes.
 *
 * Every route acts as the SIGNED-IN USER, through the session client,
 * so the database functions see who is calling (auth.uid()) and apply
 * their own role checks and the separate-approver rules. The role
 * check here is the courtesy half — a clear 403 before a round trip.
 */
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { mr } from "./db";

type Gate =
  | { ok: true; db: SupabaseClient; userId: string; role: string }
  | { ok: false; response: NextResponse };

export async function maalriseGate(allowed: readonly string[]): Promise<Gate> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const role = (profile?.role as string | undefined) ?? "";
  if (!allowed.includes(role)) {
    return { ok: false, response: NextResponse.json({ error: "Your role cannot do this" }, { status: 403 }) };
  }
  return { ok: true, db: mr(supabase), userId: user.id, role };
}

/**
 * A database refusal as a response. The messages are the ones written
 * in migration 051 ("Terms cannot be approved by the person who
 * prepared or submitted them", …) and are meant to be read by staff.
 */
export function dbError(error: { message: string; code?: string }) {
  const status = error.message === "Unauthorized" ? 403 : 400;
  return NextResponse.json({ error: error.message }, { status });
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export const isUuid = (s: unknown): s is string =>
  typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/**
 * The login with exactly this email (case-insensitive). ILIKE alone
 * would treat "_" and "%" in an address as wildcards — a_b@x.com would
 * match axb@x.com — so wildcards are escaped AND the match is confirmed
 * exactly here before anything acts on it.
 */
export async function findLoginByEmail<T extends { email: string | null }>(
  db: SupabaseClient,
  email: string,
  columns: string
): Promise<{ data: T | null; error: { message: string } | null }> {
  const pattern = email.replace(/[\\%_*]/g, (m) => `\\${m}`);
  const { data, error } = await db.from("profiles").select(`email, ${columns}`).ilike("email", pattern).limit(10);
  if (error) return { data: null, error };
  const exact = ((data ?? []) as unknown as T[]).filter((p) => (p.email ?? "").trim().toLowerCase() === email);
  if (exact.length > 1) return { data: null, error: { message: "More than one login uses this email; resolve that first." } };
  return { data: exact[0] ?? null, error: null };
}
