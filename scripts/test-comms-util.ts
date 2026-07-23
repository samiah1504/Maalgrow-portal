import { normalizeNigerianPhone, resolveTemplate, extractVariables, smsUnits, firstName } from "../src/lib/comms/util";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log("PASS:", name);
  else { failures++; console.error("FAIL:", name, extra ?? ""); }
}

// phone normalisation
check("0-prefix 11 digits", normalizeNigerianPhone("08012345678") === "2348012345678");
check("spaces and dashes", normalizeNigerianPhone("0801 234-5678") === "2348012345678");
check("+234 format", normalizeNigerianPhone("+234 801 234 5678") === "2348012345678");
check("bare 234 format", normalizeNigerianPhone("2348012345678") === "2348012345678");
check("10-digit form", normalizeNigerianPhone("8012345678") === "2348012345678");
check("too short rejected", normalizeNigerianPhone("12345") === null);
check("empty rejected", normalizeNigerianPhone("") === null);
// International numbers
check("+44 UK number", normalizeNigerianPhone("+44 7911 123456") === "447911123456");
check("+1 US number", normalizeNigerianPhone("+1 202 555 0123") === "12025550123");
check("00 prefix", normalizeNigerianPhone("0044 7911 123456") === "447911123456");
check("bare UK with country code", normalizeNigerianPhone("447911123456") === "447911123456");
check("+971 UAE number", normalizeNigerianPhone("+971 50 123 4567") === "971501234567");
check("intl too short rejected", normalizeNigerianPhone("+44 123") === null);
check("intl leading zero rejected", normalizeNigerianPhone("+0801234567") === null);

// template resolution
const r1 = resolveTemplate("Dear {{first_name}}, email: {{registered_email}}", {
  first_name: "Aisha", registered_email: "a@x.com",
});
check("all vars resolved", r1.unresolved.length === 0 && r1.text === "Dear Aisha, email: a@x.com", r1);

const r2 = resolveTemplate("Dear {{first_name}}, series {{series_name}}", { first_name: "Musa" });
check("unresolved reported", r2.unresolved.length === 1 && r2.unresolved[0] === "series_name", r2);

check("extract variables", JSON.stringify(extractVariables("{{full_name}} x {{portal_url}} x {{full_name}}"))
  === JSON.stringify(["full_name", "portal_url"]));

// SMS units
check("short GSM = 1 unit", smsUnits("Hello investor") === 1);
check("160 GSM chars = 1 unit", smsUnits("a".repeat(160)) === 1);
check("161 GSM chars = 2 units", smsUnits("a".repeat(161)) === 2);
check("459 GSM chars = 3 units", smsUnits("a".repeat(459)) === 3);
check("unicode ₦ short = 1 unit", smsUnits("₦" + "a".repeat(60)) === 1);
check("unicode 71 chars = 2 units", smsUnits("₦" + "a".repeat(70)) === 2);

check("first name split", firstName("Aisha Bello Mohammed") === "Aisha");

process.exit(failures === 0 ? 0 : 1);
