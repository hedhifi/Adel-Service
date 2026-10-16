export type PricedLine = {
  quantity: string;
  unitAmountCents: number;
  taxable: boolean;
};

export function lineAmountCents(quantity: string, unitAmountCents: number): number {
  if (!/^\d+(\.\d{1,2})?$/.test(quantity)) {
    throw new Error("Quantity must be a number with up to 2 decimal places.");
  }
  const [whole, fraction = ""] = quantity.split(".");
  const hundredths = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  if (hundredths <= 0n) {
    throw new Error("Quantity must be greater than zero.");
  }
  if (!Number.isInteger(unitAmountCents) || unitAmountCents < 0) {
    throw new Error("Unit amount must be zero or a positive number of cents.");
  }
  const product = BigInt(unitAmountCents) * hundredths;
  return Number((product + 50n) / 100n);
}

export function summarizeMoney(lines: PricedLine[], taxRateBps: number) {
  let subtotalCents = 0;
  let taxableCents = 0;
  const priced = lines.map((line) => {
    const amountCents = lineAmountCents(line.quantity, line.unitAmountCents);
    subtotalCents += amountCents;
    if (line.taxable) taxableCents += amountCents;
    return { ...line, amountCents };
  });
  const taxCents = Math.round((taxableCents * taxRateBps) / 10000);
  return {
    lines: priced,
    subtotalCents,
    taxableCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
  };
}
