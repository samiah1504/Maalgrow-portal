import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

export const CHAT_BUCKET = "chat-attachments";
export const CHAT_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

// Safe types only — never executables
export const CHAT_ALLOWED_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
};

export const CHAT_STAFF_ROLES = [
  "super_admin",
  "administrator",
  "finance",
  "operations",
  "customer_support",
];

type AnyClient = SupabaseClient<Database>;

/**
 * True when the given profile may access the conversation:
 * the conversation's investor, a senior admin, or the assigned
 * (or general-queue) staff member. Used by the attachment routes —
 * message sending re-checks inside the DB functions.
 */
export async function canAccessConversation(
  adminClient: AnyClient,
  conversationId: string,
  profileId: string
): Promise<{ ok: boolean; isStaff: boolean }> {
  const { data: profile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", profileId)
    .single();
  const role = profile?.role ?? "";

  const { data: conv } = await adminClient
    .from("chat_conversations")
    .select("id, investor_id, assigned_manager_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return { ok: false, isStaff: false };

  if (role === "super_admin" || role === "administrator") {
    return { ok: true, isStaff: true };
  }
  if (CHAT_STAFF_ROLES.includes(role)) {
    return {
      ok: conv.assigned_manager_id === profileId || conv.assigned_manager_id === null,
      isStaff: true,
    };
  }

  const { data: investor } = await adminClient
    .from("investors")
    .select("id")
    .eq("id", conv.investor_id)
    .eq("profile_id", profileId)
    .maybeSingle();
  return { ok: Boolean(investor), isStaff: false };
}
