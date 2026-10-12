/**
 * MaalRise — ILLUSTRATIVE SAMPLE DATA. NOT FINANCIAL RECORDS.
 *
 * Phase 1 builds the admin screens before any MaalRise table exists.
 * There is no database behind these pages yet, so every figure they
 * show either comes from here — and is labelled SAMPLE wherever it is
 * rendered — or is an empty state.
 *
 * Names, emails and account numbers are deliberately fictitious
 * (example.com, "Sample Bank", 000000000x). Nothing here may ever be
 * written to a database or used to send a message. Delete this file,
 * and every import of it, when Phase 2 connects the real tables.
 */
import type { FeeInput, MarkupInput, ScheduleInput } from "./compute";

export const SAMPLE_PREFIX = "sample-";

/**
 * The fixed date the sample figures are "as of". Statuses (paid,
 * part-paid, pending, upcoming) are derived from it and the receipts,
 * never typed in by hand, so they cannot drift from the amounts.
 */
export const SAMPLE_AS_OF = "2026-10-12";

export function isSampleId(id: string): boolean {
  return id.startsWith(SAMPLE_PREFIX);
}

export type SampleCycle = {
  id: string;
  name: string;
  transactionName: string;
  description: string;
  counterparty: { name: string; registration: string; contact: string };
  startDate: string; // ISO yyyy-mm-dd
  durationMonths: number;
  status: "draft" | "terms_submitted" | "terms_approved" | "active" | "matured" | "closed";
  unitPriceKobo: number;
  costKobo: number;
  markup: MarkupInput;
  statedSalePriceKobo: number | null;
  fee: FeeInput;
  schedule: ScheduleInput;
  taxTreatment: string;
  preparedBy: string;
  approvedBy: string | null;
};

export type SampleInvestor = {
  id: string;
  investorCode: string;
  fullName: string;
  email: string;
  phone: string;
  kycStatus: "not_started" | "pending_review" | "verified_via_maalgrow" | "verified" | "rejected";
  bank: { bankName: string; accountName: string; accountNumber: string; confirmed: boolean };
  alsoMaalGrow: boolean;
  status: "invited" | "active" | "suspended";
  addedOn: string;
};

export type SampleAllocation = { cycleId: string; investorId: string; units: number };

export const SAMPLE_INVESTORS: SampleInvestor[] = [
  {
    id: "sample-investor-1",
    investorCode: "MR-SAMPLE1",
    fullName: "Sample Investor One",
    email: "investor.one@example.com",
    phone: "+234 800 000 0001",
    kycStatus: "verified_via_maalgrow",
    bank: { bankName: "Sample Bank", accountName: "Sample Investor One", accountNumber: "0000000001", confirmed: true },
    alsoMaalGrow: true,
    status: "active",
    addedOn: "2026-06-10",
  },
  {
    id: "sample-investor-2",
    investorCode: "MR-SAMPLE2",
    fullName: "Sample Investor Two",
    email: "investor.two@example.com",
    phone: "+234 800 000 0002",
    kycStatus: "verified",
    bank: { bankName: "Sample Bank", accountName: "Sample Investor Two", accountNumber: "0000000002", confirmed: true },
    alsoMaalGrow: false,
    status: "active",
    addedOn: "2026-06-12",
  },
  {
    id: "sample-investor-3",
    investorCode: "MR-SAMPLE3",
    fullName: "Sample Investor Three",
    email: "investor.three@example.com",
    phone: "+234 800 000 0003",
    kycStatus: "pending_review",
    bank: { bankName: "Sample Bank", accountName: "Sample Investor Three", accountNumber: "0000000003", confirmed: false },
    alsoMaalGrow: false,
    status: "invited",
    addedOn: "2026-10-05",
  },
  {
    id: "sample-investor-4",
    investorCode: "MR-SAMPLE4",
    fullName: "Sample Investor Four",
    email: "investor.four@example.com",
    phone: "+234 800 000 0004",
    kycStatus: "not_started",
    bank: { bankName: "", accountName: "", accountNumber: "", confirmed: false },
    alsoMaalGrow: false,
    status: "invited",
    addedOn: "2026-10-08",
  },
];

export const SAMPLE_CYCLES: SampleCycle[] = [
  {
    id: "sample-cycle-1",
    name: "Sample Cycle Alpha",
    transactionName: "Sample commodity purchase and resale",
    description:
      "Illustrative transaction only: purchase of goods at cost and resale to a counterparty on deferred terms, markup paid monthly and cost repaid at maturity.",
    counterparty: { name: "Sample Counterparty Ltd", registration: "RC 000000", contact: "accounts@example.com" },
    startDate: "2026-07-01",
    durationMonths: 6,
    status: "active",
    unitPriceKobo: 100_000_00,
    costKobo: 100_000_000_00,
    markup: { type: "percent", bps: 1200 },
    statedSalePriceKobo: 112_000_000_00,
    fee: { basis: "markup", bps: 500, treatment: "deducted_from_investors" },
    schedule: { mode: "equal" },
    taxTreatment: "Not configured — pending confirmation of Nigerian tax treatment (A12)",
    preparedBy: "Sample Preparer",
    approvedBy: "Sample Approver",
  },
  {
    id: "sample-cycle-2",
    name: "Sample Cycle Beta",
    transactionName: "Sample equipment Murabaha",
    description: "Illustrative draft awaiting full subscription and terms approval.",
    counterparty: { name: "Sample Counterparty Ltd", registration: "RC 000000", contact: "accounts@example.com" },
    startDate: "2026-11-01",
    durationMonths: 4,
    status: "draft",
    unitPriceKobo: 100_000_00,
    costKobo: 40_000_000_00,
    markup: { type: "amount", kobo: 3_000_000_00 },
    statedSalePriceKobo: null,
    fee: { basis: "cost", bps: 0, treatment: "waived" },
    schedule: { mode: "contract", netKobo: [500_000_00, 500_000_00, 1_000_000_00, 1_000_000_00] },
    taxTreatment: "Not configured — pending confirmation of Nigerian tax treatment (A12)",
    preparedBy: "Sample Preparer",
    approvedBy: null,
  },
];

export const SAMPLE_ALLOCATIONS: SampleAllocation[] = [
  // The active sample Cycle holds only investors whose KYC and bank
  // details are complete — an active Cycle that failed its own
  // activation checks would be an impossible state to show.
  { cycleId: "sample-cycle-1", investorId: "sample-investor-1", units: 600 },
  { cycleId: "sample-cycle-1", investorId: "sample-investor-2", units: 400 },
  { cycleId: "sample-cycle-2", investorId: "sample-investor-3", units: 150 },
  { cycleId: "sample-cycle-2", investorId: "sample-investor-4", units: 100 },
];

/** Illustrative receipts for the active sample Cycle. */
export const SAMPLE_RECEIPTS = [
  { cycleId: "sample-cycle-1", period: 1, receivedOn: "2026-08-01", grossKobo: 1_900_000_00 + 100_000_00, reference: "SAMPLE-REF-001" },
  { cycleId: "sample-cycle-1", period: 2, receivedOn: "2026-09-01", grossKobo: 1_900_000_00 + 100_000_00, reference: "SAMPLE-REF-002" },
  { cycleId: "sample-cycle-1", period: 3, receivedOn: "2026-10-01", grossKobo: 1_500_000_00, reference: "SAMPLE-REF-003" },
];

export const SAMPLE_DOCUMENTS = [
  { cycleId: "sample-cycle-1", name: "Sample Murabaha contract.pdf", category: "Contract", visibleToInvestors: true },
  { cycleId: "sample-cycle-1", name: "Sample purchase invoice.pdf", category: "Supporting", visibleToInvestors: false },
];

export const SAMPLE_ACTIVITY = [
  { cycleId: "sample-cycle-1", at: "2026-06-20T10:00:00Z", who: "Sample Preparer", what: "Prepared and submitted terms (version 1)" },
  { cycleId: "sample-cycle-1", at: "2026-06-22T14:30:00Z", who: "Sample Approver", what: "Approved terms version 1 — calculation breakdown frozen" },
  { cycleId: "sample-cycle-1", at: "2026-07-01T09:00:00Z", who: "Sample Approver", what: "Activated Cycle — all activation checks passed" },
  { cycleId: "sample-cycle-2", at: "2026-10-09T11:15:00Z", who: "Sample Preparer", what: "Created draft" },
];

export function sampleCycle(id: string) {
  return SAMPLE_CYCLES.find((c) => c.id === id) ?? null;
}

export function sampleInvestor(id: string) {
  return SAMPLE_INVESTORS.find((i) => i.id === id) ?? null;
}
