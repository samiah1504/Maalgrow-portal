/**
 * Investor Data Export — what goes into the files.
 * Run: npx tsx scripts/test-investor-export.ts
 */
import * as XLSX from "xlsx";
import {
  CONTACT_PRESET,
  MG_CONTACT_FIELDS,
  MG_INVESTMENT_FIELDS,
  MR_FIELDS,
  exportFile,
  maskAccount,
  mgContactRows,
  neutralize,
  paymentStatus,
  pickFields,
  sortInvestmentRows,
  table,
  type MgInvestmentRow,
  type MgInvestor,
  type MrRow,
} from "../src/lib/export/investor-export";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log("PASS:", name);
  else { failures++; console.log("FAIL:", name, detail === undefined ? "" : JSON.stringify(detail)); }
}

const person = (id: string, name: string, phone: string, extra: Partial<MgInvestor> = {}): MgInvestor => ({
  id, investor_code: `MG-${id}`, full_name: name, email: `${id}@x.com`, phone, address: null,
  residential_street_address: "12 Marina Road", residential_city: "Lagos Island", residential_lga_name: "Lagos Island",
  residential_state_name: "Lagos", gender: "female", nationality: "Nigerian", occupation: "Trader", kyc_status: "approved",
  bank_name: "GTB", account_name: name, account_number: "0123456701", ...extra,
});
const inv = (id: string, investor: string, cycle: string, units: number, capital: number, date: string, status = "active") =>
  ({ id, investment_code: `INV-${id}`, investor_id: investor, cycle_id: cycle, units, price_per_unit: capital / units, capital,
     investment_date: date, maturity_date: "2027-01-01", status });

const ada = person("a", "Ada Obi", "08031234567");
const bola = person("b", "Bola Ade", "+234 803 000 0001", { account_number: null });
const rows: MgInvestmentRow[] = [
  { investor: ada, nok: { investor_id: "a", full_name: "Chi Obi", relationship: "Sister", phone: "08030000000", email: null },
    inv: inv("1", "a", "c1", 2, 1000000, "2026-01-05"), series: "A", cycle: "A-2026-1", paid: 1000000 },
  { investor: ada, nok: null, inv: inv("2", "a", "c2", 1.5, 750000, "2026-04-05"), series: "A", cycle: "A-2026-2", paid: 300000 },
  { investor: ada, nok: null, inv: inv("3", "a", "c3", 1, 500000, "2026-07-05"), series: "A", cycle: "A-2026-3", paid: 0 },
  { investor: bola, nok: null, inv: inv("4", "b", "c1", 3, 1500000, "2026-01-07"), series: "A", cycle: "A-2026-1", paid: 1600000 },
];

// One row per person in contact lists; one per investment in reports
const contacts = mgContactRows(rows);
check("contact list: an investor with three investments appears once", contacts.length === 2 && contacts.filter((c) => c.investor.id === "a").length === 1);
const a = contacts.find((c) => c.investor.id === "a")!;
check("contact list: totals across their investments (slots 4.5, ₦2.25m invested, ₦1.3m paid, 3 investments, 3 cycles)",
  a.slots === 4.5 && a.capital === 2250000 && a.paid === 1300000 && a.count === 3 && a.cycles === "A-2026-1, A-2026-2, A-2026-3", a);
const sorted = sortInvestmentRows(rows);
check("investment report: one row per investment, by name then cycle", sorted.length === 4
  && sorted.map((r) => r.inv.id).join() === "1,2,3,4");
check("investment report totals equal the series", sorted.reduce((t, r) => t + Number(r.inv.capital), 0) === 3750000);

// Payment status — the same rule as the investor's page
check("payment status: unpaid, part paid, fully paid, overpaid",
  paymentStatus(500000, 0) === "Unpaid" && paymentStatus(750000, 300000) === "Part Paid"
  && paymentStatus(1000000, 1000000) === "Fully Paid" && paymentStatus(1500000, 1600000) === "Overpaid");

// Field choice
const f = pickFields(MG_INVESTMENT_FIELDS, ["phone", "full_name", "capital", "payment_status"]);
check("fields come out in the list's order, whatever order they were ticked", !("error" in f) && f.map((x) => x.key).join() === "full_name,phone,capital,payment_status");
check("an unknown field is refused", "error" in pickFields(MG_INVESTMENT_FIELDS, ["full_name", "nin"]));
check("no field is chosen → refused", "error" in pickFields(MG_INVESTMENT_FIELDS, []));
const all = [...MG_INVESTMENT_FIELDS, ...MG_CONTACT_FIELDS, ...MR_FIELDS].map((x) => x.key);
check("NIN, TIN and passwords are never offered", !all.some((k) => /nin|tin|bvn|password/i.test(k)), all);
check("the phone-list preset is name, phone and email", CONTACT_PRESET.join() === "full_name,phone,email");

// Masking
const bank = pickFields(MG_INVESTMENT_FIELDS, ["full_name", "account_number"]) as typeof MG_INVESTMENT_FIELDS;
check("account numbers masked by default, full only when asked",
  table(bank, [rows[0]], false).body[0][1] === "******6701" && table(bank, [rows[0]], true).body[0][1] === "0123456701");
check("no account number → empty, not a mask", maskAccount(null) === "" && table(bank, [rows[3]], false).body[0][1] === "");

// Values
const t = table(MG_INVESTMENT_FIELDS, [rows[0]], false);
const v = (label: string) => t.body[0][t.head.indexOf(label)];
check("values: address joined, slots and amounts as numbers, labels readable",
  v("Residential address") === "12 Marina Road, Lagos Island, Lagos Island, Lagos" && v("Number of slots") === 2
  && v("Investment amount (NGN)") === 1000000 && v("Series") === "Series A" && v("KYC status") === "Approved"
  && v("Gender") === "Female" && v("Next of kin") === "Chi Obi" && v("Investment status") === "Active", t);

// Formula neutralising
check("formulas are neutralised; phone numbers and negatives are not",
  neutralize("=HYPERLINK(\"x\")") === "'=HYPERLINK(\"x\")" && neutralize("@SUM(A1)") === "'@SUM(A1)" && neutralize("+cmd|x") === "'+cmd|x"
  && neutralize("+234 803 000 0001") === "+234 803 000 0001" && neutralize("-5") === "-5" && neutralize("08031234567") === "08031234567");

// CSV
const phones = pickFields(MG_CONTACT_FIELDS, CONTACT_PRESET) as typeof MG_CONTACT_FIELDS;
const evil = mgContactRows([{ ...rows[3], investor: { ...bola, full_name: "=cmd(\"x\"), Bola" } }]);
const csv = exportFile("csv", "Series A", table(phones, [...contacts, ...evil], false)).bytes.toString("utf8");
const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
check("CSV: UTF-8 with BOM, header, one line per person", csv.startsWith("﻿") && lines[0] === "Full name,Phone number,Email address" && lines.length === 4, lines);
check("CSV: leading zero kept in the text; commas and quotes escaped; formula neutralised",
  lines[1] === "Ada Obi,08031234567,a@x.com" && lines[3].startsWith("\"'=cmd(\"\"x\"\"), Bola\""), lines);

// Excel
const x = exportFile("xlsx", "Series A", table(MG_INVESTMENT_FIELDS, sorted, false));
const wb = XLSX.read(x.bytes, { type: "buffer" });
const ws = wb.Sheets["Series A"];
const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
const col = (label: string) => (aoa[0] as string[]).indexOf(label);
const phoneCell = ws[XLSX.utils.encode_cell({ r: 1, c: col("Phone number") })];
const capCell = ws[XLSX.utils.encode_cell({ r: 1, c: col("Investment amount (NGN)") })];
check("Excel: a header and one row per investment", aoa.length === 5, aoa.length);
check("Excel: phone stored as text (leading 0 kept); amounts stored as numbers",
  phoneCell?.t === "s" && phoneCell.v === "08031234567" && capCell?.t === "n" && capCell.v === 1000000, { phoneCell, capCell });
check("Excel: the MIME type is right", x.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

// MaalRise
const mr: MrRow = {
  investor: { investor_code: "MR-1", full_name: "Ngozi Eze", email: "n@x.com", phone: "08039990000", kyc_status: "verified",
              bank_name: "Access", account_name: "Ngozi Eze", account_number: "0987654321", bank_confirmed_at: null },
  cycle: "Kanziy 1", units: 30, capitalKobo: 300000000, participationBps: 3000, expectedProfitKobo: 100800000,
  profitPaidKobo: 33600000, profitApprovedKobo: 0, capitalReturnedKobo: 0, fundingDates: "2026-10-14", fundingRefs: "IMPORT-ABC, MV-1/moved",
};
const mt = table(MR_FIELDS, [mr], false);
const mv = (label: string) => mt.body[0][mt.head.indexOf(label)];
check("MaalRise: naira from kobo, participation in %, references kept, bank masked and unconfirmed",
  mv("Capital (NGN)") === 3000000 && mv("Participation (%)") === 30 && mv("Expected profit for the term (NGN)") === 1008000
  && mv("Profit paid (NGN)") === 336000 && mv("Funding bank reference(s)") === "IMPORT-ABC, MV-1/moved"
  && mv("Account number") === "******4321" && mv("Bank details confirmed") === "No" && mv("KYC status") === "Verified", mt);
check("MaalRise: a figure that cannot be worked out is blank, not 0",
  table(MR_FIELDS, [{ ...mr, participationBps: null, expectedProfitKobo: null }], false).body[0][MR_FIELDS.findIndex((d) => d.key === "participation")] === null);

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nAll investor export checks passed.");
