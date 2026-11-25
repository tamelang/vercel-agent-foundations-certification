/**
 * Admin (employee-facing) tools: read-only back-office data, a bash tool that
 * runs in the admin Vercel Sandbox, and persistent memory. Never imported by
 * the shopping agent.
 *
 * Every back-office tool also writes its complete result set to a JSON file
 * in the sandbox so the agent can aggregate and join datasets with bash
 * instead of doing arithmetic in its head.
 */
import { tool } from "ai";
import { getStepMetadata } from "workflow";
import { z } from "zod";
import {
  getBackOfficeReturns,
  getBackOfficeSales,
  getBackOfficeStock,
  getBackOfficeSupportTickets,
} from "./api";
import {
  appendMemoryEntry,
  describeSandboxError,
  MEMORY_FILE,
  readMemoryFile,
  runInSandbox,
  writeDataFile,
} from "./sandbox";
import { handleStepError, redactSecrets, toolFailure } from "./tool-errors";
import type {
  BashResult,
  InventoryStockResult,
  MemoryCategory,
  ReturnsHistoryResult,
  SalesAnalyticsResult,
  SandboxDataFile,
  SaveMemoryResult,
  SupportTicketsResult,
} from "./tool-results";
import { createCatalogTools } from "./tools";

// Rows returned inline to the model; the full set is always in the data file.
const INLINE_ROWS = 40;
const MAX_OUTPUT_CHARS = 8_000;

async function saveDataset(name: string, data: unknown): Promise<SandboxDataFile> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    return { path: await writeDataFile(`${name}-${stamp}`, data) };
  } catch (err) {
    return { path: null, note: describeSandboxError(err) };
  }
}

function inline<T>(rows: T[]) {
  return { rows: rows.slice(0, INLINE_ROWS), truncated: rows.length > INLINE_ROWS };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

type DateRange = { from?: string; to?: string };

async function getSupportTicketsStep(
  input: DateRange & {
    status?: "open" | "pending" | "resolved" | "closed";
    priority?: "low" | "normal" | "high" | "urgent";
    category?:
      | "shipping"
      | "returns"
      | "product_quality"
      | "sizing"
      | "billing"
      | "payment"
      | "account"
      | "other";
    assignee?: string;
    limit?: number;
  },
): Promise<SupportTicketsResult> {
  "use step";
  try {
    const { data, meta } = await getBackOfficeSupportTickets(input);
    const { rows, truncated } = inline(data);
    const dataFile = await saveDataset("support-tickets", { meta, data });
    return { ok: true, meta, tickets: rows, truncated, dataFile };
  } catch (err) {
    return handleStepError(err);
  }
}

async function getReturnsHistoryStep(
  input: DateRange & {
    status?: "pending" | "processing" | "completed";
    decision?: "approved" | "rejected" | "needs_info";
    limit?: number;
  },
): Promise<ReturnsHistoryResult> {
  "use step";
  try {
    const { data, meta } = await getBackOfficeReturns(input);
    const { rows, truncated } = inline(data);
    const dataFile = await saveDataset("returns", { meta, data });
    return { ok: true, meta, returns: rows, truncated, dataFile };
  } catch (err) {
    return handleStepError(err);
  }
}

async function getInventoryStockStep(input: {
  productIds?: string[];
  lowStock?: boolean;
  inStock?: boolean;
  page?: number;
  limit?: number;
}): Promise<InventoryStockResult> {
  "use step";
  try {
    const { data, meta } = await getBackOfficeStock(input);
    const { rows, truncated } = inline(data);
    const dataFile = await saveDataset("inventory", { meta, data });
    return { ok: true, pagination: meta.pagination, stock: rows, truncated, dataFile };
  } catch (err) {
    return handleStepError(err, "One or more of those product IDs don't exist.");
  }
}

async function getSalesAnalyticsStep(
  input: DateRange & { productId?: string },
): Promise<SalesAnalyticsResult> {
  "use step";
  try {
    const { data, meta } = await getBackOfficeSales(input);
    const { rows, truncated } = inline(data);
    const dataFile = await saveDataset("sales", { meta, data });
    return { ok: true, meta, rows, truncated, dataFile };
  } catch (err) {
    return handleStepError(
      err,
      input.productId ? `No product with ID "${input.productId}".` : undefined,
    );
  }
}

function clip(text: string) {
  const clean = redactSecrets(text);
  return clean.length > MAX_OUTPUT_CHARS
    ? { text: `${clean.slice(0, MAX_OUTPUT_CHARS)}\n… [output truncated]`, truncated: true }
    : { text: clean, truncated: false };
}

async function bashStep(input: { command: string; timeoutSeconds?: number }): Promise<BashResult> {
  "use step";
  const started = Date.now();
  try {
    const result = await runInSandbox(input.command, (input.timeoutSeconds ?? 60) * 1000);
    const stdout = clip(result.stdout);
    const stderr = clip(result.stderr);
    return {
      ok: true,
      command: input.command,
      exitCode: result.exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      truncated: stdout.truncated || stderr.truncated,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    // Sandbox API failures are retried by the step; the final attempt reports.
    const { attempt, maxAttempts } = getStepMetadata();
    if (attempt < maxAttempts) throw err;
    return toolFailure("SANDBOX_UNAVAILABLE", describeSandboxError(err));
  }
}

async function saveMemoryStep(input: {
  note: string;
  category: MemoryCategory;
}): Promise<SaveMemoryResult> {
  "use step";
  const note = redactSecrets(input.note.replace(/\s+/g, " ").trim());
  const savedAt = new Date().toISOString();
  try {
    await appendMemoryEntry(`- [${savedAt.slice(0, 10)}] (${input.category}) ${note}`);
    return { ok: true, category: input.category, note, savedAt };
  } catch (err) {
    return toolFailure("SANDBOX_UNAVAILABLE", describeSandboxError(err));
  }
}
saveMemoryStep.maxRetries = 2;

/** Read saved memory at the start of an admin turn. Never throws. */
export async function loadMemoryStep(): Promise<{ memory: string | null; error?: string }> {
  "use step";
  try {
    return { memory: await readMemoryFile() };
  } catch (err) {
    return { memory: null, error: describeSandboxError(err) };
  }
}
loadMemoryStep.maxRetries = 1;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const isoDate = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), "Use YYYY-MM-DD or an ISO 8601 datetime");

const dateRange = {
  from: isoDate.optional().describe("Start (YYYY-MM-DD or ISO datetime). Defaults to 30 days before `to`."),
  to: isoDate.optional().describe("End (YYYY-MM-DD or ISO datetime). Defaults to now."),
};

function validRange<T extends DateRange>(v: T) {
  return !(v.from && v.to) || Date.parse(v.from) <= Date.parse(v.to);
}
const rangeMessage = { message: "`from` must be on or before `to`", path: ["from"] };

const dataFileNote =
  "The complete result set is saved as JSON ({ meta, data }) at `dataFile.path` in the sandbox; use bash (jq/python3/node) on it for counts, sums, rankings, and joins.";

export function createAdminTools() {
  const { searchProducts, getAllCategories, getProductDetails } = createCatalogTools();

  return {
    searchProducts,
    getAllCategories,
    getProductDetails,

    getSupportTickets: tool({
      description: `Read-only. List customer support tickets (subject, status, priority, category, assignee, related order/return, message preview) within a date range. History covers ~180 days. ${dataFileNote}`,
      inputSchema: z
        .object({
          ...dateRange,
          status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
          priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
          category: z
            .enum(["shipping", "returns", "product_quality", "sizing", "billing", "payment", "account", "other"])
            .optional(),
          assignee: z
            .string()
            .max(60)
            .optional()
            .describe("Staff username, e.g. 'alex'. Excludes unassigned tickets."),
          limit: z.number().int().min(1).max(500).optional().describe("Max tickets (default 25)."),
        })
        .refine(validRange, rangeMessage),
      execute: (input) => getSupportTicketsStep(input),
    }),

    getReturnsHistory: tool({
      description: `Read-only. List historical customer returns with items, status, decision, refund amount (integer cents), and the related order summary. History covers ~180 days. ${dataFileNote}`,
      inputSchema: z
        .object({
          ...dateRange,
          status: z.enum(["pending", "processing", "completed"]).optional(),
          decision: z.enum(["approved", "rejected", "needs_info"]).optional(),
          limit: z.number().int().min(1).max(500).optional().describe("Max returns (default 25)."),
        })
        .refine(validRange, rangeMessage),
      execute: (input) => getReturnsHistoryStep(input),
    }),

    getInventoryStock: tool({
      description: `Read-only. Current on-hand stock per product, sorted by stock ascending. lowStock = 1–5 units. Paginated: check \`pagination.hasNextPage\` and request the next \`page\` if needed. ${dataFileNote}`,
      inputSchema: z.object({
        productIds: z
          .array(z.string().min(1).max(120))
          .max(100)
          .optional()
          .describe("Restrict to these product IDs."),
        lowStock: z.boolean().optional().describe("true: only 1–5 units; false: exclude those."),
        inStock: z.boolean().optional().describe("true: only items with stock; false: only out of stock."),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(200).optional().describe("Page size (default 50)."),
      }),
      execute: (input) => getInventoryStockStep(input),
    }),

    getSalesAnalytics: tool({
      description: `Read-only. Units sold, order count, and revenue (integer cents) per product for a date range, sorted by units sold, plus period totals in \`meta.totals\`. Sales history covers ~180 days. ${dataFileNote}`,
      inputSchema: z
        .object({
          ...dateRange,
          productId: z.string().min(1).max(120).optional().describe("Restrict to one product ID."),
        })
        .refine(validRange, rangeMessage),
      execute: (input) => getSalesAnalyticsStep(input),
    }),

    bash: tool({
      description:
        "Run a bash command in the isolated admin analysis sandbox (Ubuntu with jq, python3, node; no network). Working directory /vercel/sandbox. Datasets from the back-office tools are in /vercel/sandbox/data. Use it for every count, sum, average, rate, ranking, or join. Print concise results.",
      inputSchema: z.object({
        command: z.string().min(1).max(8_000).describe("The bash command or script to run."),
        timeoutSeconds: z.number().int().min(1).max(120).optional().describe("Default 60."),
      }),
      execute: (input) => bashStep(input),
    }),

    saveMemory: tool({
      description: `Save a durable note to the admin memory file (${MEMORY_FILE}) so it is available in future conversations. Use for employee preferences, corrections to your earlier answers or assumptions, and business context/definitions. Never save store data snapshots (numbers change) or credentials.`,
      inputSchema: z.object({
        category: z.enum(["preference", "correction", "business-context"]),
        note: z
          .string()
          .min(3)
          .max(500)
          .describe("One self-contained sentence, e.g. 'Report revenue in USD with no decimals.'"),
      }),
      execute: (input) => saveMemoryStep(input),
    }),
  };
}

export type AdminTools = ReturnType<typeof createAdminTools>;
