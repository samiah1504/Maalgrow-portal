import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ChatInbox, type InboxRow, type StaffOption } from "./_chat-inbox";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Investor Chats | Admin" };
export const revalidate = 0;

const STAFF_ROLES = ["super_admin", "administrator", "finance", "operations", "customer_support"] as const;

export default async function AdminChatsPage() {
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

  const [{ data: conversations }, { data: staff }, { data: investors }, { data: settings }, { data: quickReplies }] =
    await Promise.all([
      db
        .from("chat_conversations")
        .select("*")
        .order("last_message_at", { ascending: false, nullsFirst: false }),
      db
        .from("profiles")
        .select("id, full_name, email, role")
        .in("role", STAFF_ROLES)
        .eq("is_active", true)
        .order("full_name"),
      db
        .from("investors")
        .select("id, full_name, investor_code, email, phone, assigned_manager_id")
        .order("full_name"),
      db.from("chat_settings").select("support_notice").maybeSingle(),
      db.from("chat_quick_replies").select("*").order("created_at"),
    ]);

  const investorById = new Map((investors ?? []).map((i) => [i.id, i]));
  const staffById = new Map((staff ?? []).map((s) => [s.id, s]));

  // Non-senior staff see their own queue + unassigned only
  const visible = (conversations ?? []).filter(
    (c) => isSenior || c.assigned_manager_id === user.id || c.assigned_manager_id === null
  );

  const rows: InboxRow[] = visible.map((c) => {
    const inv = investorById.get(c.investor_id);
    return {
      id: c.id,
      investor_id: c.investor_id,
      investor_name: inv?.full_name ?? "Unknown",
      investor_code: inv?.investor_code ?? "—",
      investor_email: inv?.email ?? "",
      investor_phone: inv?.phone ?? "",
      manager_name: c.assigned_manager_id
        ? staffById.get(c.assigned_manager_id)?.full_name ?? "—"
        : null,
      assigned_manager_id: c.assigned_manager_id,
      category: c.category,
      status: c.status,
      priority: c.priority,
      admin_unread: c.admin_unread,
      last_message_at: c.last_message_at,
      created_at: c.created_at,
      first_admin_reply_at: c.first_admin_reply_at,
      resolved_at: c.resolved_at,
    };
  });

  const staffOptions: StaffOption[] = (staff ?? []).map((s) => ({
    id: s.id,
    name: s.full_name ?? s.email,
    role: s.role,
    assigned_investors: (investors ?? []).filter((i) => i.assigned_manager_id === s.id).length,
  }));

  const investorRows = (investors ?? []).map((i) => ({
    id: i.id,
    full_name: i.full_name,
    investor_code: i.investor_code,
    manager_name: i.assigned_manager_id
      ? staffById.get(i.assigned_manager_id)?.full_name ?? "—"
      : null,
    assigned_manager_id: i.assigned_manager_id,
  }));

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Investor Chats</h1>
        <p className="text-muted text-sm mt-1">
          In-portal support conversations with investors. Internal notes are
          never visible to investors.
        </p>
      </div>

      <ChatInbox
        rows={rows}
        staff={staffOptions}
        investors={investorRows}
        currentUserId={user.id}
        isSenior={isSenior}
        supportNotice={settings?.support_notice ?? ""}
        quickReplies={(quickReplies ?? []).map((q) => ({
          id: q.id,
          title: q.title,
          message: q.message,
          active: q.active,
        }))}
      />
    </div>
  );
}
