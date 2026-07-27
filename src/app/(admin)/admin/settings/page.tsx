"use client";

import { useState, useEffect, useMemo } from "react";
import { Settings, Bell, Shield, Globe, Save, RefreshCw, CheckCircle2, CreditCard, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SettingSection = {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
};

const sections: SettingSection[] = [
  { id: "general", title: "General", description: "Company info and branding", icon: <Globe className="h-4 w-4" /> },
  { id: "notifications", title: "Notifications", description: "Email and SMS alerts", icon: <Bell className="h-4 w-4" /> },
  { id: "payments", title: "Payments", description: "Who may approve payouts", icon: <CreditCard className="h-4 w-4" /> },
  { id: "security", title: "Security", description: "Auth and session policy", icon: <Shield className="h-4 w-4" /> },
  { id: "automation", title: "Automation", description: "Cron jobs and triggers", icon: <RefreshCw className="h-4 w-4" /> },
];

export default function AdminSettingsPage() {
  const [activeSection, setActiveSection] = useState("general");
  const [saved, setSaved] = useState(false);

  // General settings state
  const [companyName, setCompanyName] = useState("MaalVest Investment Limited");
  const [portalName, setPortalName] = useState("MaalGrow");
  const [supportEmail, setSupportEmail] = useState("support@maalvest.com");
  const [minInvestment, setMinInvestment] = useState("100000");

  // Notification settings
  const [emailOnInvestment, setEmailOnInvestment] = useState(true);
  const [emailOnPayment, setEmailOnPayment] = useState(true);
  const [emailOnMaturity, setEmailOnMaturity] = useState(true);
  const [smsEnabled, setSmsEnabled] = useState(false);

  // Security settings
  const [sessionTimeout, setSessionTimeout] = useState("60");
  const [requireMFA, setRequireMFA] = useState(false);

  // Payments — the one setting on this page with a row behind it.
  // Everything above is still local state that resets on reload; this
  // reads and writes portal_settings through migration 038.
  const supabase = useMemo(() => createClient(), []);
  const [officerCanApprove, setOfficerCanApprove] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [savingApproval, setSavingApproval] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [{ data: perms }, { data: { user } }] = await Promise.all([
        supabase.rpc("my_payment_permissions"),
        supabase.auth.getUser(),
      ]);
      const p = (perms ?? {}) as { officerCanApprove?: boolean };
      setOfficerCanApprove(Boolean(p.officerCanApprove));

      if (user) {
        const { data: profile } = await supabase
          .from("profiles").select("role").eq("id", user.id).single();
        setIsSuperAdmin(profile?.role === "super_admin");
      }
      setPaymentsLoading(false);
    };
    load();
  }, [supabase]);

  const toggleOfficerApproval = async () => {
    const next = !officerCanApprove;
    setSavingApproval(true);
    setOfficerCanApprove(next); // optimistic
    const { error } = await supabase.rpc("set_payment_officer_can_approve", {
      p_enabled: next,
    });
    setSavingApproval(false);
    if (error) {
      setOfficerCanApprove(!next);
      toast.error(error.message);
      return;
    }
    toast.success(
      next
        ? "Payment Officers can now approve payments"
        : "Payment Officers can no longer approve payments"
    );
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted mt-1">Configure platform behaviour and integrations</p>
      </div>

      <div className="flex gap-6 flex-col lg:flex-row">
        {/* Sidebar Nav */}
        <div className="lg:w-56 flex-shrink-0">
          <nav className="space-y-1">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-left transition-colors ${
                  activeSection === section.id
                    ? "bg-primary-50 text-primary-700 border border-primary-200"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                <span className={activeSection === section.id ? "text-primary-600" : ""}>
                  {section.icon}
                </span>
                <div>
                  <p>{section.title}</p>
                  <p className="text-[10px] font-normal text-muted">{section.description}</p>
                </div>
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4">
          {activeSection === "general" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Globe className="h-4 w-4" /> General Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Input
                    label="Company Name"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                  />
                  <Input
                    label="Portal Name"
                    value={portalName}
                    onChange={(e) => setPortalName(e.target.value)}
                  />
                  <Input
                    label="Support Email"
                    type="email"
                    value={supportEmail}
                    onChange={(e) => setSupportEmail(e.target.value)}
                  />
                  <Input
                    label="Minimum Investment (NGN)"
                    type="number"
                    value={minInvestment}
                    onChange={(e) => setMinInvestment(e.target.value)}
                  />
                </div>
                <div className="rounded-lg bg-primary-50 border border-primary-100 p-3 text-xs text-primary-700">
                  These settings affect investor-facing displays and validation rules. Changes take effect immediately.
                </div>
              </CardContent>
            </Card>
          )}

          {activeSection === "notifications" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Bell className="h-4 w-4" /> Notification Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  {[
                    { label: "Email on new investment", value: emailOnInvestment, set: setEmailOnInvestment, desc: "Send confirmation email when an investment is created" },
                    { label: "Email on payment processed", value: emailOnPayment, set: setEmailOnPayment, desc: "Alert investor and admin when a payment is marked paid" },
                    { label: "Email on investment maturity", value: emailOnMaturity, set: setEmailOnMaturity, desc: "Notify investor 7 days before and on maturity date" },
                    { label: "SMS notifications", value: smsEnabled, set: setSmsEnabled, desc: "Send SMS alerts via configured provider (additional charges)" },
                  ].map((item) => (
                    <div key={item.label} className="flex items-start justify-between gap-4 py-3 border-b border-border last:border-0">
                      <div>
                        <p className="text-sm font-medium text-foreground">{item.label}</p>
                        <p className="text-xs text-muted mt-0.5">{item.desc}</p>
                      </div>
                      <button
                        onClick={() => item.set(!item.value)}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
                          item.value ? "bg-primary-600" : "bg-border"
                        }`}
                      >
                        <span
                          className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5 ${
                            item.value ? "translate-x-5" : "translate-x-0.5"
                          }`}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {activeSection === "payments" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CreditCard className="h-4 w-4" /> Payment Approvals
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start justify-between gap-4 py-1">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Payment Officers can approve payments
                    </p>
                    <p className="text-xs text-muted mt-0.5 max-w-md">
                      Off by default. Approving authorises the money; marking
                      as paid records that it left. With this off, a Payment
                      Officer can only confirm payments that someone else has
                      already approved.
                    </p>
                  </div>
                  {paymentsLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted" />
                  ) : (
                    <button
                      onClick={toggleOfficerApproval}
                      disabled={!isSuperAdmin || savingApproval}
                      title={isSuperAdmin ? undefined : "Only a super admin can change this"}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        officerCanApprove ? "bg-primary-600" : "bg-border"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5 ${
                          officerCanApprove ? "translate-x-5" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  )}
                </div>

                {!isSuperAdmin && !paymentsLoading && (
                  <p className="text-xs text-muted">
                    Only a super admin can change this.
                  </p>
                )}

                <div className="rounded-lg bg-surface-2 border border-border p-3 text-xs text-muted">
                  Every approval, rejection and payment is written to the audit
                  log with the person who did it — including changes to this
                  switch.
                </div>
              </CardContent>
            </Card>
          )}

          {activeSection === "security" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4" /> Security Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  label="Session Timeout (minutes)"
                  type="number"
                  value={sessionTimeout}
                  onChange={(e) => setSessionTimeout(e.target.value)}
                />
                <div className="flex items-start justify-between gap-4 py-3 border-b border-border">
                  <div>
                    <p className="text-sm font-medium text-foreground">Require MFA for admins</p>
                    <p className="text-xs text-muted mt-0.5">All admin accounts must set up multi-factor authentication</p>
                  </div>
                  <button
                    onClick={() => setRequireMFA(!requireMFA)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
                      requireMFA ? "bg-primary-600" : "bg-border"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5 ${
                        requireMFA ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-xs text-amber-700">
                  Security settings changes require a platform restart to take full effect.
                </div>
              </CardContent>
            </Card>
          )}

          {activeSection === "automation" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" /> Automation
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  {[
                    { name: "Process Matured Investments", schedule: "Daily at 00:00 UTC", route: "/api/cron/process-maturities", status: "active" },
                    { name: "Send Maturity Reminders", schedule: "Daily at 09:00 UTC", route: "/api/cron/maturity-reminders", status: "active" },
                    { name: "Generate Monthly Statements", schedule: "1st of each month", route: "/api/cron/monthly-statements", status: "inactive" },
                  ].map((job) => (
                    <div key={job.name} className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{job.name}</p>
                        <p className="text-xs text-muted font-mono mt-0.5">{job.route}</p>
                        <p className="text-xs text-muted mt-0.5">{job.schedule}</p>
                      </div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        job.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
                      }`}>
                        {job.status}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              className={`flex items-center gap-2 transition-all ${saved ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
            >
              {saved ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Saved!
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
