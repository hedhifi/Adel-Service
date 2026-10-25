"use client";

import { ghostClass } from "@/components/ui";

export function PrintButton() {
  return (
    <button type="button" className={`${ghostClass} no-print`} onClick={() => window.print()}>
      Print
    </button>
  );
}
