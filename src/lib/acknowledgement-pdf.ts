"use client";

export type AcknowledgementDetails = {
  investorCode: string;
  fullName: string;
  email: string;
  investmentCode: string;
  seriesName: string;
  cycleLabel: string;
  slots: number;
  slotValue: number;
  totalInvestment: number;
  totalPaid: number;
  outstandingBalance: number;
  paymentStatus: string;
  investmentDate: string;
  cycleStart: string;
  maturityDate: string;
  acknowledgedAt: string;
};

function fmtNGN(amount: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function payLabel(status: string): string {
  if (status === "full" || status === "Full Payment") return "Fully Paid";
  if (status === "partial" || status === "Partial Payment") return "Partially Paid";
  return "Payment Pending";
}

export async function downloadAcknowledgementPDF(
  d: AcknowledgementDetails
): Promise<void> {
  const { default: jsPDF } = await import("jspdf");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const pageW = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentW = pageW - margin * 2;

  let y = margin;

  // Header band
  doc.setFillColor(30, 58, 95); // #1e3a5f
  doc.rect(0, 0, pageW, 38, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("MaalGrow Portal", margin, 18);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Shariah-Compliant Mudārabah Investment Platform", margin, 26);
  doc.setFontSize(10);
  doc.text("INVESTMENT ACKNOWLEDGEMENT", pageW - margin, 22, { align: "right" });

  y = 50;
  doc.setTextColor(17, 24, 39); // #111827

  // Reference number
  const refNo = `ACK-${d.investorCode}-${d.investmentCode}`;
  doc.setFillColor(240, 244, 255);
  doc.roundedRect(margin, y, contentW, 16, 3, 3, "F");
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(107, 114, 128);
  doc.text("REFERENCE NUMBER", margin + 4, y + 6);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 58, 95);
  doc.text(refNo, margin + 4, y + 13);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(107, 114, 128);
  doc.text(`Issued: ${fmtDate(d.acknowledgedAt)}`, pageW - margin - 4, y + 10, {
    align: "right",
  });

  y += 24;

  // Helper: section title
  const sectionTitle = (title: string) => {
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(107, 114, 128);
    doc.text(title.toUpperCase(), margin, y);
    doc.setDrawColor(229, 231, 235);
    doc.line(margin + doc.getTextWidth(title.toUpperCase()) + 3, y - 1, margin + contentW, y - 1);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(17, 24, 39);
  };

  // Helper: row
  const row = (label: string, value: string, valueColor?: [number, number, number]) => {
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(107, 114, 128);
    doc.text(label, margin, y);
    if (valueColor) doc.setTextColor(...valueColor);
    else doc.setTextColor(17, 24, 39);
    doc.setFont("helvetica", "bold");
    doc.text(value, pageW - margin, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setTextColor(229, 231, 235);
    doc.line(margin, y + 1.5, pageW - margin, y + 1.5);
    y += 8;
    doc.setTextColor(17, 24, 39);
  };

  // Investor details
  sectionTitle("Investor Information");
  row("Full Name", d.fullName);
  row("Email Address", d.email);
  row("Investor Code", d.investorCode);
  y += 4;

  // Investment details
  sectionTitle("Investment Allocation");
  row("Investment Reference", d.investmentCode);
  row("Series", `Series ${d.seriesName}`);
  row("Cycle", d.cycleLabel);
  row(
    "Slots Allocated",
    `${d.slots} ${d.slots === 1 ? "slot" : "slots"} × ${fmtNGN(d.slotValue)}`
  );
  row("Total Investment Amount", fmtNGN(d.totalInvestment));
  row("Investment Date", fmtDate(d.investmentDate));
  row("Cycle Start", fmtDate(d.cycleStart));
  row("Maturity Date", fmtDate(d.maturityDate));
  y += 4;

  // Payment summary
  sectionTitle("Payment Summary");
  row("Total Amount Paid", fmtNGN(d.totalPaid), [5, 150, 105]);
  row(
    "Outstanding Balance",
    fmtNGN(d.outstandingBalance),
    d.outstandingBalance > 0 ? [217, 119, 6] : [5, 150, 105]
  );
  row("Payment Status", payLabel(d.paymentStatus));
  y += 8;

  // Disclaimer box
  const disclaimer =
    "IMPORTANT NOTICE: This document acknowledges the investment allocation described above and " +
    "is issued by MaalGrow for record-keeping purposes only. Profit (Mudārabah) will be declared " +
    "at cycle maturity based on actual business performance and is NOT guaranteed in advance. " +
    "This document does not constitute a guaranteed-return certificate or financial guarantee of any kind. " +
    "This is a Shariah-compliant Mudārabah investment and all parties share in profit and loss " +
    "in accordance with Islamic finance principles.";

  doc.setFillColor(255, 251, 235); // amber-50
  doc.setDrawColor(253, 230, 138); // amber-200
  const disclaimerLines = doc.splitTextToSize(disclaimer, contentW - 8);
  const disclaimerH = disclaimerLines.length * 4.5 + 8;
  doc.roundedRect(margin, y, contentW, disclaimerH, 2, 2, "FD");
  doc.setFontSize(8);
  doc.setTextColor(120, 53, 15); // amber-900
  doc.setFont("helvetica", "normal");
  doc.text(disclaimerLines, margin + 4, y + 6);
  y += disclaimerH + 8;

  // Signature line
  doc.setDrawColor(229, 231, 235);
  doc.line(margin, y, margin + 60, y);
  doc.line(pageW - margin - 60, y, pageW - margin, y);
  doc.setFontSize(8);
  doc.setTextColor(107, 114, 128);
  doc.text("Administrator Signature", margin, y + 5);
  doc.text("Date", pageW - margin - 60, y + 5);

  // Footer
  const footerY = doc.internal.pageSize.getHeight() - 12;
  doc.setFillColor(249, 250, 251);
  doc.rect(0, footerY - 4, pageW, 16, "F");
  doc.setFontSize(8);
  doc.setTextColor(156, 163, 175);
  doc.text(
    `MaalGrow Portal · ${refNo} · Generated ${fmtDate(d.acknowledgedAt)}`,
    pageW / 2,
    footerY + 2,
    { align: "center" }
  );

  doc.save(`MaalGrow-Acknowledgement-${d.investorCode}.pdf`);
}
