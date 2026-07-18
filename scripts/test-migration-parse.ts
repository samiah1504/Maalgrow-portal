import { parseSpreadsheet, googleSheetsCsvUrl, normalizePhone, parseDateValue, buildTemplateCsv } from "../src/lib/migration-parse";
import * as XLSX from "xlsx";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log("PASS:", name);
  else { failures++; console.error("FAIL:", name, extra ?? ""); }
}

// ── CSV parsing ──
const csv = [
  "Full Name,Phone Number,Email Address,Residential Address,Number of Slots,Amount Paid,Payment Date,Payment Reference,Notes",
  '"EXAMPLE - delete this row",0803 000 0000,x@y.com,addr,1,500000,2026-06-30,,',
  '"Aisha Bello","+234 803 123 4567",AISHA@Email.com,"12 Marina Rd",1.5,"₦750,000",30/06/2026,TRF-1,legacy',
  '"Musa Okoro",0805 222 3333,musa@mail.com,,0.5,250000,2026-06-15,,',
  '"Bad Slots",0806 444 5555,bad@mail.com,,1.2,0,,,',
  '"No Email",0807 555 6666,,,2,0,,,',
  '"Paid NoDate",0808 666 7777,pnd@mail.com,,1,100000,,,',
  ",,,,,,,,",
].join("\r\n");

const { rows, errors } = parseSpreadsheet(Buffer.from(csv, "utf8"));
check("no file-level errors", errors.length === 0, errors);
check("example + empty rows skipped → 5 rows", rows.length === 5, rows.length);

const aisha = rows[0];
check("email lowercased", aisha.email === "aisha@email.com", aisha.email);
check("naira amount parsed", aisha.amount_paid === 750000, aisha.amount_paid);
check("DD/MM/YYYY date parsed", aisha.payment_date === "2026-06-30", aisha.payment_date);
check("valid row status", aisha.status === "valid", aisha.issue);

check("0.5 slot valid", rows[1].status === "valid", rows[1].issue);
check("1.2 slots rejected", rows[2].status === "invalid" && /0.5 increments/.test(rows[2].issue!), rows[2].issue);
check("missing email rejected", rows[3].status === "invalid" && /Email/.test(rows[3].issue!), rows[3].issue);
check("paid without date rejected", rows[4].status === "invalid" && /Payment date/.test(rows[4].issue!), rows[4].issue);

// ── XLSX parsing (same data through a real workbook) ──
const ws = XLSX.utils.aoa_to_sheet([
  ["Full Name","Phone Number","Email Address","Residential Address","Number of Slots","Amount Paid","Payment Date","Payment Reference","Notes"],
  ["Chidi Eze","0810 111 2222","chidi@mail.com","Abuja",10,5000000,new Date(2026,5,30),"REF-9",""],
]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Investors");
const xlsxBuf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
const x = parseSpreadsheet(xlsxBuf);
check("xlsx parsed 1 row", x.rows.length === 1, x.errors);
check("xlsx 10 slots valid", x.rows[0].status === "valid" && x.rows[0].slots === 10, x.rows[0]);
check("xlsx Date cell → ISO", x.rows[0].payment_date === "2026-06-30", x.rows[0].payment_date);

// ── Missing column detection ──
const bad = parseSpreadsheet(Buffer.from("Name Only\nJoe", "utf8"));
check("missing slots column reported", bad.errors.some(e => /Number of Slots/.test(e)), bad.errors);

// ── Google Sheets URL ──
check("gsheet url basic",
  googleSheetsCsvUrl("https://docs.google.com/spreadsheets/d/1AbC_d-EF/edit#gid=123456")
  === "https://docs.google.com/spreadsheets/d/1AbC_d-EF/export?format=csv&gid=123456");
check("gsheet url no gid",
  googleSheetsCsvUrl("https://docs.google.com/spreadsheets/d/XYZ/edit")
  === "https://docs.google.com/spreadsheets/d/XYZ/export?format=csv&gid=0");
check("non-gsheet url rejected", googleSheetsCsvUrl("https://example.com/foo.csv") === null);

// ── Phone normalization ──
check("phone +234 == 0-prefix", normalizePhone("+234 803 123 4567") === normalizePhone("0803 123 4567"));
check("phone short rejected", normalizePhone("12345") === null);

// ── Template parses cleanly through its own pipeline ──
const t = parseSpreadsheet(Buffer.from(buildTemplateCsv(), "utf8"));
check("template example row ignored, no errors besides empty", t.rows.length === 0 && t.errors.length === 1, t);

process.exit(failures === 0 ? 0 : 1);
