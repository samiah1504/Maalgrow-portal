import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { MessageCircle, Clock } from "lucide-react";
import { ChatThread, type ChatMessage } from "@/components/chat/chat-thread";
import { StartChat } from "./_start-chat";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Chat With Your Investor Manager" };
export const revalidate = 0;

export default async function InvestorChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const db = await createAdminClient();
  const { data: investor } = await db
    .from("investors")
    .select("id, full_name, investor_code, assigned_manager_id")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!investor) redirect("/dashboard");

  // Active conversation (RLS: session client sees only their own)
  const { data: conversation } = await supabase
    .from("chat_conversations")
    .select("*")
    .eq("investor_id", investor.id)
    .neq("status", "archived")
    .maybeSingle();

  // Messages via session client: RLS already excludes internal notes
  const { data: messages } = conversation
    ? await supabase
        .from("chat_messages")
        .select("*")
        .eq("conversation_id", conversation.id)
        .order("created_at")
    : { data: [] as ChatMessage[] };

  const { data: settings } = await supabase
    .from("chat_settings")
    .select("support_notice")
    .maybeSingle();

  // Manager display name only — no private contact details
  const managerId =
    conversation?.assigned_manager_id ?? investor.assigned_manager_id;
  let managerName: string | null = null;
  if (managerId) {
    const { data: manager } = await db
      .from("profiles")
      .select("full_name")
      .eq("id", managerId)
      .maybeSingle();
    managerName = manager?.full_name ?? null;
  }

  // The investor's own series/cycles for the optional "related to" link
  const { data: myInvestments } = await db
    .from("investments")
    .select("series_id, cycle_id, series(name), cycle:cycles(cycle_label)")
    .eq("investor_id", investor.id)
    .eq("status", "active");

  const related = (myInvestments ?? []).map((i) => ({
    series_id: i.series_id as string,
    cycle_id: i.cycle_id as string,
    label: `Series ${(i.series as { name?: string } | null)?.name ?? "?"} — ${
      (i.cycle as { cycle_label?: string } | null)?.cycle_label ?? ""
    }`,
  }));

  const relatedLabel = conversation?.related_cycle_id
    ? related.find((r) => r.cycle_id === conversation.related_cycle_id)?.label ??
      null
    : null;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-3xl mx-auto animate-fade-in rounded-xl border border-border bg-white overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 bg-white">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 shrink-0">
            <MessageCircle className="h-5 w-5 text-primary-700" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-foreground truncate">
              {managerName
                ? `Your Investor Manager: ${managerName}`
                : "MaalGrow Investor Support"}
            </h1>
            <p className="text-xs text-muted">
              {conversation
                ? conversation.status === "resolved"
                  ? "Resolved — send a message to reopen"
                  : conversation.status === "awaiting_investor"
                  ? "Replied — your turn"
                  : "Response expected within one business day"
                : "Response expected within one business day"}
              {relatedLabel ? ` · Related to: ${relatedLabel}` : ""}
            </p>
          </div>
        </div>
        {settings?.support_notice && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted">
            <Clock className="h-3 w-3 mt-0.5 shrink-0" />
            {settings.support_notice}
          </p>
        )}
      </div>

      {conversation ? (
        <ChatThread
          conversationId={conversation.id}
          perspective="investor"
          initialMessages={(messages ?? []) as ChatMessage[]}
          apiPath="/api/investor/chat"
        />
      ) : (
        <StartChat related={related} />
      )}
    </div>
  );
}
