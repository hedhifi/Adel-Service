import { z } from "zod";
import { AppError } from "./errors";

export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => {
        const path = issue.path.join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join("; ");
    throw new AppError(400, message || "Invalid input.", "invalid_input");
  }
  return result.data;
}

export function isUniqueViolation(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

export const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const lineItemSchema = z.object({
  kind: z.enum(["labor", "material", "other"]).default("other"),
  description: z.string().trim().min(1).max(500),
  quantity: z.string().regex(/^\d+(\.\d{1,2})?$/, "Use a quantity like 1 or 1.50"),
  unitAmountCents: z.number().int().min(0).max(10_000_000),
  taxable: z.boolean(),
});

export type LineInput = z.infer<typeof lineItemSchema>;

const blank = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .nullable()
  .transform((value) => (value ? value : null));

export const optionalText = blank;
