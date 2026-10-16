"use client";

import { inputClass } from "@/components/ui";
import { useState } from "react";

type Row = {
  kind: "labor" | "material" | "other";
  description: string;
  quantity: string;
  dollars: string;
  taxable: boolean;
};

const blank = (kind: Row["kind"], taxable: boolean): Row => ({
  kind,
  description: "",
  quantity: "1",
  dollars: "",
  taxable,
});

export function LineItemsEditor() {
  const [rows, setRows] = useState<Row[]>([blank("labor", false), blank("material", true)]);
  const payload = rows
    .filter((row) => row.description.trim())
    .map((row) => ({
      kind: row.kind,
      description: row.description.trim(),
      quantity: row.quantity || "1",
      unitAmountCents: Math.round(Number(row.dollars || "0") * 100),
      taxable: row.taxable,
    }));

  return (
    <div className="space-y-3">
      <input type="hidden" name="lineItems" value={JSON.stringify(payload)} />
      {rows.map((row, index) => (
        <div key={index} className="grid gap-2 rounded-md border border-line p-3 md:grid-cols-[140px_1fr_90px_120px_90px]">
          <select
            className={inputClass}
            value={row.kind}
            onChange={(event) => {
              const kind = event.target.value as Row["kind"];
              setRows((current) => current.map((item, i) => (i === index ? { ...item, kind, taxable: kind === "material" } : item)));
            }}
          >
            <option value="labor">Labor</option>
            <option value="material">Material</option>
            <option value="other">Other</option>
          </select>
          <input
            className={inputClass}
            placeholder="Description"
            value={row.description}
            onChange={(event) => setRows((current) => current.map((item, i) => (i === index ? { ...item, description: event.target.value } : item)))}
          />
          <input
            className={inputClass}
            inputMode="decimal"
            aria-label="Quantity"
            value={row.quantity}
            onChange={(event) => setRows((current) => current.map((item, i) => (i === index ? { ...item, quantity: event.target.value } : item)))}
          />
          <input
            className={inputClass}
            inputMode="decimal"
            aria-label="Unit price in dollars"
            placeholder="0.00"
            value={row.dollars}
            onChange={(event) => setRows((current) => current.map((item, i) => (i === index ? { ...item, dollars: event.target.value } : item)))}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={row.taxable}
              onChange={(event) => setRows((current) => current.map((item, i) => (i === index ? { ...item, taxable: event.target.checked } : item)))}
            />
            Tax
          </label>
        </div>
      ))}
      <button type="button" className="text-sm font-semibold text-pine" onClick={() => setRows((current) => [...current, blank("other", false)])}>
        Add a line
      </button>
    </div>
  );
}
