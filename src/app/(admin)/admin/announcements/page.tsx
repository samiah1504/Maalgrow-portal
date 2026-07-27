import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AnnouncementsScreen } from "./_announcements";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Announcements | Admin" };
export const revalidate = 0;

const ADMIN_ROLES = ["super_admin", "administrator"];

/**
 * What has actually been sent.
 *
 * This page used to be a mock — MOCK_ANNOUNCEMENTS in React state,
 * "Publish" pushing onto a local array. It listed announcements as
 * published that had never left the browser tab, which is why no
 * investor ever saw one.
 *
 * Read on the server so the list is the database's answer rather than
 * anything the client is holding, and so a stale tab cannot show an
 * announcement that has since been withdrawn.
 */
export default async function AdminAnnouncementsPage() {
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
  if (!profile || !ADMIN_ROLES.includes(profile.role ?? "")) redirect("/admin");

  const { data } = await supabase
    .from("announcements")
    .select(
      "id, title, content, target_audience, recipient_count, is_published, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(50);

  return <AnnouncementsScreen rows={data ?? []} />;
}
