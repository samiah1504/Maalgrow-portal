"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button size="sm" onClick={() => window.print()} className="print:hidden">
      <Printer className="h-3.5 w-3.5" /> Print or save as PDF
    </Button>
  );
}
