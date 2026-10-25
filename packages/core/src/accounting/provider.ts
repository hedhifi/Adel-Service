import { AppError } from "../errors";

/**
 * Adel Service is the book of record. An outside accounting package is a
 * plug-in, and it stays off until ACCOUNTING_PROVIDER names one.
 * `quickbooks` is the only plug-in, and it talks to the Intuit sandbox or the mock.
 */
export function quickBooksPluginEnabled() {
  const name = (process.env.ACCOUNTING_PROVIDER ?? "none").trim().toLowerCase();
  return name === "quickbooks" || name === "qbo";
}

export function assertQuickBooksPlugin() {
  if (!quickBooksPluginEnabled()) {
    throw new AppError(
      404,
      "The QuickBooks plug-in is off. Adel Service keeps each company's books. Download a workbook for an accountant.",
      "qbo_disabled",
    );
  }
}
