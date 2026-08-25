import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ChatMessage } from "@/components/chat/chat-thread";
import { ChatDetail } from "./_chat-detail";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Investor Chat | Admin" };
export const revalidate = 0;

// The one list, so the Payment Officer stays excluded here for the
// same reason she is excluded everywhere else.
import { ADMIN_ROLE_VALUES as STAFF_ROLES } from "@/lib/staff-roles";

export default async function AdminChatDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = profile?.role ?? "";
  if (!(STAFF_ROLES as readonly string[]).includes(role)) redirect("/admin/dashboard");
  const isSenior = ["super_admin", "administrator"].includes(role);

  const db = await createAdminClient();
  const { data: conversation } = await db
    .from("chat_conversations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!conversation) notFound();

  // Staff scoping — mirror of the DB rules
  if (
    !isSenior &&
    conversation.assigned_manager_id !== null &&
    conversation.assigned_manager_id !== user.id
  ) {
    redirect("/admin/chats");
  }

  const [{ data: investor }, { data: messages }, { data: staff }, { data: quickReplies }, seriesRes, cycleRes] =
    await Promise.all([
      db
        .from("investors")
        .select("id, full_name, investor_code, email, phone")
        .eq("id", conversation.investor_id)
        .single(),
      db
        .from("chat_messages")
        .select("*")
        .eq("conversation_id", id)
        .order("created_at"),
      db
        .from("profiles")
        .select("id, full_name, email, role")
        .in("role", STAFF_ROLES)
        .eq("is_active", true)
        .order("full_name"),
      db.from("chat_quick_replies").select("id, title, message").eq("active", true).order("created_at"),
      conversation.related_series_id
        ? db.from("series").select("name").eq("id", conversation.related_series_id).maybeSingle()
        : Promise.resolve({ data: null }),
      conversation.related_cycle_id
        ? db.from("cycles").select("cycle_label").eq("id", conversation.related_cycle_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  if (!investor) notFound();

  const relatedLabel = [
    seriesRes.data ? `Series ${(seriesRes.data as { name: string }).name}` : null,
    cycleRes.data ? (cycleRes.data as { cycle_label: string }).cycle_label : null,
  ]
    .filter(Boolean)
    .join(" — ");

  return (
    <div className="space-y-4 animate-fade-in max-w-4xl">
      <Link
        href="/admin/chats"
        className="flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Investor Chats
      </Link>

      <ChatDetail
        conversation={{
          id: conversation.id,
          category: conversation.category,
          status: conversation.status,
          priority: conversation.priority,
          assigned_manager_id: conversation.assigned_manager_id,
          created_at: conversation.created_at,
        }}
        investor={investor}
        relatedLabel={relatedLabel || null}
        messages={(messages ?? []) as ChatMessage[]}
        staff={(staff ?? []).map((s) => ({
          id: s.id,
          name: s.full_name ?? s.email,
          role: s.role,
        }))}
        quickReplies={quickReplies ?? []}
        isSenior={isSenior}
      />
    </div>
  );
}
