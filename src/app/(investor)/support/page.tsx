import { HelpCircle, Mail, Phone, MessageSquare, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Support" };

const faqs = [
  {
    q: "When will my investment mature?",
    a: "Each MaalGrow cycle is exactly 3 months. Your maturity date is shown on each investment card. You'll be notified when your investment matures.",
  },
  {
    q: "What happens when my investment matures?",
    a: "When your investment matures, you'll receive a notification and can log in to submit your maturity decision — either to continue into the next cycle or to withdraw your capital. ROI is always paid regardless of your decision.",
  },
  {
    q: "How long does it take to receive my payment?",
    a: "Once you submit your payment request and it's approved by the MaalVest team, payments are typically processed within 3–5 business days.",
  },
  {
    q: "Can I invest in multiple series at the same time?",
    a: "Yes! You can participate in Series A, B, and C simultaneously. Each series operates independently with its own cycle and investment record.",
  },
  {
    q: "What is Mudārabah?",
    a: "Mudārabah is a Shariah-compliant profit-sharing arrangement where you provide the capital (Rabb-ul-Maal) and MaalVest manages the investment (Mudārib). Profits are shared at a pre-agreed ratio, and the principal is guaranteed.",
  },
  {
    q: "How do I update my bank account details?",
    a: "Visit your Profile page and update your bank details under the 'Bank Account Details' section. Updated details will be pre-filled in future payment requests.",
  },
];

export default function SupportPage() {
  return (
    <div className="space-y-6 max-w-3xl animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Support</h1>
        <p className="text-sm text-muted mt-1">Get help with your MaalGrow investments</p>
      </div>

      {/* Contact Options */}
      <div className="grid gap-4 sm:grid-cols-3">
        <a
          href="mailto:support@maalvest.com"
          className="flex flex-col items-center gap-3 rounded-xl border-2 border-border bg-surface p-5 text-center hover:border-primary-300 hover:bg-primary-50/30 transition-all"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
            <Mail className="h-6 w-6" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Email Support</p>
            <p className="text-xs text-muted mt-0.5">support@maalvest.com</p>
            <p className="text-xs text-muted">Response within 24 hours</p>
          </div>
        </a>

        <a
          href="tel:+2340000000000"
          className="flex flex-col items-center gap-3 rounded-xl border-2 border-border bg-surface p-5 text-center hover:border-primary-300 hover:bg-primary-50/30 transition-all"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gold-100 text-gold-700">
            <Phone className="h-6 w-6" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Phone Support</p>
            <p className="text-xs text-muted mt-0.5">Mon–Fri, 9am–5pm WAT</p>
            <p className="text-xs text-muted">+234 000 000 0000</p>
          </div>
        </a>

        <a
          href="https://wa.me/2340000000000"
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col items-center gap-3 rounded-xl border-2 border-border bg-surface p-5 text-center hover:border-primary-300 hover:bg-primary-50/30 transition-all"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <MessageSquare className="h-6 w-6" />
          </div>
          <div>
            <p className="font-semibold text-foreground">WhatsApp</p>
            <p className="text-xs text-muted mt-0.5">Quick responses</p>
            <p className="text-xs text-primary-600 flex items-center justify-center gap-1">
              Open WhatsApp <ExternalLink className="h-3 w-3" />
            </p>
          </div>
        </a>
      </div>

      {/* FAQ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HelpCircle className="h-4 w-4 text-primary-600" />
            Frequently Asked Questions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {faqs.map((faq, i) => (
            <details
              key={i}
              className="group rounded-lg border border-border overflow-hidden"
            >
              <summary className="flex cursor-pointer items-center justify-between p-4 text-sm font-medium text-foreground hover:bg-primary-50/50 transition-colors list-none">
                {faq.q}
                <span className="ml-2 h-5 w-5 flex-shrink-0 text-muted transition-transform group-open:rotate-180">
                  ▾
                </span>
              </summary>
              <div className="border-t border-border bg-surface-2 px-4 py-3">
                <p className="text-sm text-muted leading-relaxed">{faq.a}</p>
              </div>
            </details>
          ))}
        </CardContent>
      </Card>

      {/* Important Notice */}
      <div className="rounded-xl bg-primary-50 border border-primary-100 p-4">
        <p className="text-sm font-semibold text-primary-700 mb-1">Important Notice</p>
        <p className="text-xs text-primary-600">
          MaalVest Investment Limited will never ask for your password or one-time PIN via email, phone, or WhatsApp.
          If you receive suspicious communications, please report them immediately to our support team.
        </p>
      </div>
    </div>
  );
}
