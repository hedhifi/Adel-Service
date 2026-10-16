import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "./client";

const lineItem = z.object({
  kind: z.enum(["labor", "material", "other"]).optional(),
  description: z.string(),
  quantity: z.string(),
  unitAmountCents: z.number().int(),
  taxable: z.boolean(),
});

async function call(method: string, path: string, body?: unknown) {
  const result = await api(method, path, body);
  const text = JSON.stringify(result.body, null, 2);
  if (!result.ok) {
    return { isError: true as const, content: [{ type: "text" as const, text: `${result.status} ${text}` }] };
  }
  return { content: [{ type: "text" as const, text }] };
}

export const TOOL_NAMES = [
  "list_brands",
  "list_customers",
  "create_customer",
  "create_property",
  "list_requests",
  "create_request",
  "create_quote",
  "approve_quote",
  "convert_quote",
  "list_jobs",
  "schedule_visit",
  "list_visits",
  "get_visit",
  "complete_visit",
  "create_invoice",
  "issue_invoice",
  "record_payment",
] as const;

export function registerTools(server: McpServer) {
  server.registerTool(
    "list_brands",
    { description: "List Adel Electric and HED brands.", inputSchema: {} },
    async () => call("GET", "/api/v1/brands"),
  );
  server.registerTool(
    "list_customers",
    {
      description: "Search customers by name, email, or phone.",
      inputSchema: { q: z.string().optional() },
    },
    async ({ q }) => call("GET", `/api/v1/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  );
  server.registerTool(
    "create_customer",
    {
      description: "Create a customer on a brand.",
      inputSchema: {
        brandId: z.string().uuid(),
        name: z.string(),
        email: z.string().optional(),
        phone: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    async (input) => call("POST", "/api/v1/customers", input),
  );
  server.registerTool(
    "create_property",
    {
      description: "Add a service location for a customer.",
      inputSchema: {
        customerId: z.string().uuid(),
        label: z.string(),
        line1: z.string(),
        city: z.string(),
        postalCode: z.string(),
        state: z.string().optional(),
        accessNotes: z.string().optional(),
      },
    },
    async ({ customerId, ...rest }) => call("POST", `/api/v1/customers/${customerId}/properties`, rest),
  );
  server.registerTool(
    "list_requests",
    {
      description: "List inbound work requests.",
      inputSchema: { status: z.string().optional() },
    },
    async ({ status }) => call("GET", `/api/v1/requests${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  );
  server.registerTool(
    "create_request",
    {
      description: "Log an inbound work request. Emits request.created.",
      inputSchema: {
        customerId: z.string().uuid(),
        propertyId: z.string().uuid(),
        brandId: z.string().uuid(),
        title: z.string(),
        description: z.string(),
        source: z.enum(["phone", "email", "in_person", "web", "other"]).optional(),
      },
    },
    async (input) => call("POST", "/api/v1/requests", input),
  );
  server.registerTool(
    "create_quote",
    {
      description: "Draft an estimate with line items. Amounts are integer cents.",
      inputSchema: {
        customerId: z.string().uuid(),
        propertyId: z.string().uuid(),
        brandId: z.string().uuid(),
        requestId: z.string().uuid().optional(),
        title: z.string(),
        notes: z.string().optional(),
        taxRateBps: z.number().int().optional(),
        lineItems: z.array(lineItem).min(1),
      },
    },
    async (input) => call("POST", "/api/v1/quotes", input),
  );
  server.registerTool(
    "approve_quote",
    {
      description: "Approve an estimate in the office. Emits quote.approved.",
      inputSchema: { quoteId: z.string().uuid(), approvedByName: z.string() },
    },
    async ({ quoteId, approvedByName }) => call("POST", `/api/v1/quotes/${quoteId}/approve`, { approvedByName }),
  );
  server.registerTool(
    "convert_quote",
    {
      description: "Turn an approved estimate into an unscheduled job.",
      inputSchema: { quoteId: z.string().uuid() },
    },
    async ({ quoteId }) => call("POST", `/api/v1/quotes/${quoteId}/convert`),
  );
  server.registerTool(
    "list_jobs",
    {
      description: "List jobs.",
      inputSchema: { status: z.string().optional() },
    },
    async ({ status }) => call("GET", `/api/v1/jobs${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  );
  server.registerTool(
    "schedule_visit",
    {
      description: "Assign a visit on the dispatch board. Emits job.scheduled the first time the job is scheduled.",
      inputSchema: {
        jobId: z.string().uuid(),
        technicianId: z.string().uuid().optional(),
        scheduledStart: z.string(),
        scheduledEnd: z.string(),
      },
    },
    async (input) => call("POST", "/api/v1/visits", input),
  );
  server.registerTool(
    "list_visits",
    {
      description: "List visits for a calendar day (YYYY-MM-DD). Technician tokens only see their own visits.",
      inputSchema: { day: z.string().optional(), technicianId: z.string().uuid().optional() },
    },
    async ({ day, technicianId }) => {
      const params = new URLSearchParams();
      if (day) params.set("day", day);
      if (technicianId) params.set("technicianId", technicianId);
      const query = params.toString();
      return call("GET", `/api/v1/visits${query ? `?${query}` : ""}`);
    },
  );
  server.registerTool(
    "get_visit",
    {
      description: "Read one visit, including notes, forms, and time entries.",
      inputSchema: { visitId: z.string().uuid() },
    },
    async ({ visitId }) => call("GET", `/api/v1/visits/${visitId}`),
  );
  server.registerTool(
    "complete_visit",
    {
      description: "Mark a visit complete. Emits visit.completed. Technician tokens still need a signature and required checklist items.",
      inputSchema: { visitId: z.string().uuid() },
    },
    async ({ visitId }) => call("POST", `/api/v1/visits/${visitId}/complete`),
  );
  server.registerTool(
    "create_invoice",
    {
      description: "Draft an invoice for a job. Omit line items to copy the estimate.",
      inputSchema: {
        jobId: z.string().uuid(),
        notes: z.string().optional(),
        lineItems: z.array(lineItem).optional(),
      },
    },
    async (input) => call("POST", "/api/v1/invoices", input),
  );
  server.registerTool(
    "issue_invoice",
    {
      description: "Issue a draft invoice. Emits invoice.issued. Terms are net 15.",
      inputSchema: { invoiceId: z.string().uuid() },
    },
    async ({ invoiceId }) => call("POST", `/api/v1/invoices/${invoiceId}/issue`),
  );
  server.registerTool(
    "record_payment",
    {
      description: "Record a check, cash, or other payment. Card payments stay on the invoice screen in Stripe test mode.",
      inputSchema: {
        invoiceId: z.string().uuid(),
        method: z.enum(["check", "cash", "other"]),
        amountCents: z.number().int().positive(),
        reference: z.string().optional(),
      },
    },
    async ({ invoiceId, ...rest }) => call("POST", `/api/v1/invoices/${invoiceId}/payments`, rest),
  );
}
