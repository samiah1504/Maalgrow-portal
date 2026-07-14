"use client";

import { useState } from "react";
import { Bell, Shield, Eye, EyeOff, CheckCircle2, Save, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { Metadata } from "next";

const notificationPrefs = [
  { key: "email_investment", label: "Investment created", description: "When a new investment is added to your account" },
  { key: "email_maturity", label: "Maturity reminders", description: "7 days before and on the maturity date" },
  { key: "email_payment", label: "Payment updates", description: "When payment requests are approved or paid" },
  { key: "email_announcement", label: "Announcements", description: "News and platform updates from MaalVest" },
] as const;

type NotifKey = (typeof notificationPrefs)[number]["key"];

export default function InvestorSettingsPage() {
  const [prefs, setPrefs] = useState<Record<NotifKey, boolean>>({
    email_investment: true,
    email_maturity: true,
    email_payment: true,
    email_announcement: false,
  });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [savingNotifs, setSavingNotifs] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const handleSaveNotifs = async () => {
    setSavingNotifs(true);
    await new Promise((r) => setTimeout(r, 800));
    setSavingNotifs(false);
    toast.success("Notification preferences saved");
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword) {
      toast.error("Please fill in all password fields");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    setSavingPassword(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Password updated successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  };

  return (
    <div className="space-y-6 max-w-2xl animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted mt-1">Manage your notification preferences and security</p>
      </div>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Email Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {notificationPrefs.map((pref) => (
            <div key={pref.key} className="flex items-start justify-between gap-4 py-2 border-b border-border last:border-0">
              <div>
                <p className="text-sm font-medium text-foreground">{pref.label}</p>
                <p className="text-xs text-muted mt-0.5">{pref.description}</p>
              </div>
              <button
                onClick={() => setPrefs((p) => ({ ...p, [pref.key]: !p[pref.key] }))}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
                  prefs[pref.key] ? "bg-primary-600" : "bg-border"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5 ${
                    prefs[pref.key] ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          ))}
          <Button
            onClick={handleSaveNotifs}
            loading={savingNotifs}
            className="flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            Save Preferences
          </Button>
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="Current Password"
            type={showCurrent ? "text" : "password"}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            leftIcon={<Lock className="h-4 w-4" />}
            rightIcon={
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="text-muted hover:text-foreground transition-colors"
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
            autoComplete="current-password"
          />
          <Input
            label="New Password"
            type={showNew ? "text" : "password"}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            leftIcon={<Lock className="h-4 w-4" />}
            rightIcon={
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="text-muted hover:text-foreground transition-colors"
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
            autoComplete="new-password"
          />
          <Input
            label="Confirm New Password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            leftIcon={<Lock className="h-4 w-4" />}
            autoComplete="new-password"
          />

          {newPassword && newPassword === confirmPassword && newPassword.length >= 8 && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Passwords match
            </p>
          )}

          <div className="rounded-lg bg-primary-50 border border-primary-100 p-3">
            <p className="text-xs text-primary-700">
              Use a strong password with at least 8 characters, mixing letters, numbers, and symbols.
            </p>
          </div>

          <Button
            onClick={handleChangePassword}
            loading={savingPassword}
            variant="secondary"
            className="flex items-center gap-2"
          >
            <Shield className="h-4 w-4" />
            Update Password
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
