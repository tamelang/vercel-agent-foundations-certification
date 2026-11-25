/**
 * Result shapes returned by the agents' tools.
 *
 * Pure type module (plus tiny guards) so both the server-side tool
 * implementations and the client-side chat renderers can import it. Every
 * tool resolves to either `{ ok: true, ... }` or a `ToolFailure`; transient
 * service errors are thrown instead so the workflow step retries them.
 */
import type {
  BackOfficeDateRangeMeta,
  BackOfficeSalesMeta,
  Category,
  PaginationMeta,
  Product,
  ProductSalesRow,
  Return,
  StockEntry,
  StockInfo,
  SupportTicket,
} from "./types";

export type ToolFailureCode =
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "NOT_ELIGIBLE"
  | "ALREADY_IN_PROGRESS"
  | "SERVICE_ERROR"
  | "SANDBOX_UNAVAILABLE";

export interface ToolFailure {
  ok: false;
  error: { code: ToolFailureCode; message: string };
  /** Present when a category filter was rejected, so the model can recover. */
  validCategories?: string[];
}

export function isToolFailure(value: unknown): value is ToolFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { ok?: unknown }).ok === false
  );
}

// ---------------------------------------------------------------------------
// Catalog (shared by both agents)
// ---------------------------------------------------------------------------

export interface ProductSummary {
  id: string;
  name: string;
  slug: string;
  price: number;
  currency: string;
  category: string;
  image: string | null;
  featured: boolean;
  url: string;
}

export interface SearchProductsSuccess {
  ok: true;
  query: string | null;
  category: string | null;
  /** `keywords` means the full phrase had no hits and terms were matched individually. */
  matchedBy: "browse" | "phrase" | "keywords";
  products: ProductSummary[];
  pagination: PaginationMeta | null;
}
export type SearchProductsResult = SearchProductsSuccess | ToolFailure;

export interface GetAllCategoriesSuccess {
  ok: true;
  categories: Category[];
}
export type GetAllCategoriesResult = GetAllCategoriesSuccess | ToolFailure;

export interface GetProductDetailsSuccess {
  ok: true;
  product: Product;
  url: string;
  /** `null` when the live stock check failed; the product itself is still valid. */
  stock: StockInfo | null;
}
export type GetProductDetailsResult = GetProductDetailsSuccess | ToolFailure;

// ---------------------------------------------------------------------------
// Returns (shopping agent only)
// ---------------------------------------------------------------------------

export interface ReturnOrderSuccess {
  ok: true;
  status: "filed";
  orderId: string;
  reason: string;
  /** Workflow run ID — doubles as the shopper-facing reference number. */
  reference: string;
  items: { productId: string; name: string; quantity: number }[];
  refundEstimate: { amount: number; currency: string };
  nextSteps: string;
}
export type ReturnOrderResult = ReturnOrderSuccess | ToolFailure;

// ---------------------------------------------------------------------------
// Back office (admin agent only)
// ---------------------------------------------------------------------------

/** Location of the full result set inside the admin sandbox, for bash analysis. */
export interface SandboxDataFile {
  path: string | null;
  /** Why the file could not be written, when `path` is null. */
  note?: string;
}

export interface SupportTicketsSuccess {
  ok: true;
  meta: BackOfficeDateRangeMeta;
  /** Rows included inline; the complete set lives in `dataFile`. */
  tickets: SupportTicket[];
  truncated: boolean;
  dataFile: SandboxDataFile;
}
export type SupportTicketsResult = SupportTicketsSuccess | ToolFailure;

export interface ReturnsHistorySuccess {
  ok: true;
  meta: BackOfficeDateRangeMeta;
  returns: Return[];
  truncated: boolean;
  dataFile: SandboxDataFile;
}
export type ReturnsHistoryResult = ReturnsHistorySuccess | ToolFailure;

export interface InventoryStockSuccess {
  ok: true;
  pagination: PaginationMeta;
  stock: StockEntry[];
  truncated: boolean;
  dataFile: SandboxDataFile;
}
export type InventoryStockResult = InventoryStockSuccess | ToolFailure;

export interface SalesAnalyticsSuccess {
  ok: true;
  meta: BackOfficeSalesMeta;
  rows: ProductSalesRow[];
  truncated: boolean;
  dataFile: SandboxDataFile;
}
export type SalesAnalyticsResult = SalesAnalyticsSuccess | ToolFailure;

export interface BashSuccess {
  ok: true;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  /** True when stdout/stderr were cut to keep the conversation readable. */
  truncated: boolean;
  durationMs: number;
}
export type BashResult = BashSuccess | ToolFailure;

export type MemoryCategory = "preference" | "correction" | "business-context";

export interface SaveMemorySuccess {
  ok: true;
  category: MemoryCategory;
  note: string;
  savedAt: string;
}
export type SaveMemoryResult = SaveMemorySuccess | ToolFailure;
