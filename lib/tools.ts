/**
 * Storefront tools.
 *
 * `catalogTools` (search, categories, product details) are shared by both
 * agents — the admin agent uses them to identify products before joining
 * back-office data. `returnOrder` is customer-facing and only part of
 * `shoppingTools`.
 *
 * Each I/O function is a `"use step"` so the workflow retries transient
 * failures and never re-runs a completed call on replay. Tool definitions
 * are built inside the workflow (see `lib/agent.ts`).
 */
import { tool } from "ai";
import { start } from "workflow/api";
import { HookConflictError } from "workflow/errors";
import { z } from "zod";
import {
  ApiRequestError,
  getCategories,
  getOrder,
  getProductById,
  getProductStock,
  searchProducts as apiSearchProducts,
} from "./api";
import { handleStepError, toolFailure } from "./tool-errors";
import type {
  GetAllCategoriesResult,
  GetProductDetailsResult,
  ProductSummary,
  ReturnOrderResult,
  SearchProductsResult,
} from "./tool-results";
import type { Order, Product } from "./types";
import { returnOrderWorkflow } from "./workflows/return-flow";

/** Orders in these states have shipped and can be returned. */
export const RETURNABLE_ORDER_STATUSES = ["fulfilled", "delivered", "shipped"];

export function productUrl(product: Pick<Product, "id">): string {
  return `/products/${encodeURIComponent(product.id)}`;
}

function toSummary(product: Product): ProductSummary {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    price: product.price,
    currency: product.currency,
    category: product.category,
    image: product.images[0] ?? null,
    featured: product.featured,
    url: productUrl(product),
  };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export async function searchProductsStep(input: {
  query?: string;
  category?: string;
  page?: number;
  limit?: number;
}): Promise<SearchProductsResult> {
  "use step";
  const query = input.query?.trim() || undefined;
  const category = input.category?.trim().toLowerCase() || undefined;
  const limit = input.limit ?? 12;
  const page = input.page ?? 1;

  try {
    const { data, pagination } = await apiSearchProducts({
      search: query,
      category,
      page,
      limit,
    });
    const base = { ok: true as const, query: query ?? null, category: category ?? null };
    if (data.length > 0 || !query || !query.includes(" ")) {
      return {
        ...base,
        matchedBy: query ? "phrase" : "browse",
        products: data.map(toSummary),
        pagination,
      };
    }

    // The API matches the query as one phrase. When a multi-word query has no
    // hits, match each term separately and rank by how many terms matched.
    const terms = [...new Set(query.toLowerCase().split(/\s+/).filter((t) => t.length > 1))];
    const perTerm = await Promise.all(
      terms.map((term) => apiSearchProducts({ search: term, category, limit: 100 })),
    );
    const scored = new Map<string, { product: Product; hits: number }>();
    for (const { data: rows } of perTerm) {
      for (const product of rows) {
        const entry = scored.get(product.id) ?? { product, hits: 0 };
        entry.hits += 1;
        scored.set(product.id, entry);
      }
    }
    const best = Math.max(0, ...[...scored.values()].map((e) => e.hits));
    const products = [...scored.values()]
      .filter((e) => e.hits === best && best > 0)
      .map((e) => toSummary(e.product))
      .slice(0, limit);
    return { ...base, matchedBy: "keywords", products, pagination: null };
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === "VALIDATION_ERROR" && category) {
      const categories = await getCategories().catch(() => []);
      return toolFailure(
        "VALIDATION_ERROR",
        `"${category}" is not a store category.`,
        { validCategories: categories.map((c) => c.slug) },
      );
    }
    return handleStepError(err);
  }
}

export async function getAllCategoriesStep(): Promise<GetAllCategoriesResult> {
  "use step";
  try {
    return { ok: true, categories: await getCategories() };
  } catch (err) {
    return handleStepError(err);
  }
}

export async function getProductDetailsStep(input: {
  productId: string;
}): Promise<GetProductDetailsResult> {
  "use step";
  const idOrSlug = input.productId.trim();
  try {
    const [product, stock] = await Promise.all([
      getProductById(idOrSlug),
      // Stock is best-effort: a failed check shouldn't hide the product.
      getProductStock(idOrSlug).catch(() => null),
    ]);
    return { ok: true, product, url: productUrl(product), stock };
  } catch (err) {
    return handleStepError(
      err,
      `No product matches "${idOrSlug}". Search the catalog to find the right product ID.`,
    );
  }
}

/** Validate an order for a return before anything is filed. */
async function checkReturnEligibilityStep(
  orderId: string,
): Promise<{ ok: true; order: Order } | Extract<ReturnOrderResult, { ok: false }>> {
  "use step";
  try {
    const order = await getOrder(orderId);
    if (!RETURNABLE_ORDER_STATUSES.includes(order.status)) {
      const why =
        order.status === "cancelled"
          ? "it was cancelled, so there is nothing to return"
          : "it hasn't shipped yet";
      return toolFailure("NOT_ELIGIBLE", `Order ${orderId} can't be returned because ${why}.`);
    }
    if (order.items.length === 0) {
      return toolFailure("NOT_ELIGIBLE", `Order ${orderId} has no items to return.`);
    }
    // Strip the customer's email: the agent never needs it.
    return { ok: true, order: { ...order, email: "" } };
  } catch (err) {
    return handleStepError(
      err,
      `We couldn't find an order with ID "${orderId}". Please double-check the order number.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Workflow-level tool bodies
// ---------------------------------------------------------------------------

/**
 * Runs in the chat workflow (not a step) so it can `start()` the return as a
 * child workflow: the spawn is recorded in the event log, so a replay or a
 * reconnecting client never files the same return twice. The chat doesn't
 * await the child — the return keeps running after the reply is sent.
 */
async function returnOrder(input: {
  orderId: string;
  reason: string;
}): Promise<ReturnOrderResult> {
  const orderId = input.orderId.trim().replace(/^#/, "");
  const reason = input.reason.trim();

  const check = await checkReturnEligibilityStep(orderId);
  if (!check.ok) return check;
  const { order } = check;

  try {
    const run = await start(returnOrderWorkflow, [{ orderId, reason }], {
      // One active return per order: a duplicate request is refused while
      // the first is still being processed.
      experimental_hook: { token: `return-order:${orderId}` },
    });
    return {
      ok: true,
      status: "filed",
      orderId,
      reason,
      reference: run.runId,
      items: order.items.map((item) => ({
        productId: item.productId,
        name: item.product?.name ?? item.productId,
        quantity: item.quantity,
      })),
      refundEstimate: { amount: order.total, currency: order.currency },
      nextSteps:
        "We'll email the address on the order with updates. The refund is pre-authorized to the original payment method and is released once the return is reviewed (usually within a minute or two).",
    };
  } catch (err) {
    if (HookConflictError.is(err)) {
      return toolFailure(
        "ALREADY_IN_PROGRESS",
        `A return for order ${orderId} is already being processed (reference ${err.conflictingRunId}).`,
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export function createCatalogTools() {
  return {
    searchProducts: tool({
      description:
        "Search or browse the product catalog. Omit `query` and `category` to browse everything. Use `category` with a slug from getAllCategories to narrow results. Returns product IDs, names, prices (integer cents), images, and page links.",
      inputSchema: z.object({
        query: z
          .string()
          .max(100)
          .optional()
          .describe("Free-text search, e.g. 'hoodie' or 'water bottle'. Short keywords work best."),
        category: z
          .string()
          .max(50)
          .optional()
          .describe("Category slug from getAllCategories, e.g. 'hoodies'."),
        page: z.number().int().min(1).max(50).optional().describe("1-based page number."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(24)
          .optional()
          .describe("Results per page (default 12)."),
      }),
      execute: (input) => searchProductsStep(input),
    }),
    getAllCategories: tool({
      description:
        "List the store's current product categories with their slugs and product counts. Use this to discover valid category filters instead of guessing.",
      inputSchema: z.object({}),
      execute: () => getAllCategoriesStep(),
    }),
    getProductDetails: tool({
      description:
        "Get full details for one product: description, price (integer cents), images, tags, and live stock availability. Accepts a product ID or slug from search results.",
      inputSchema: z.object({
        productId: z
          .string()
          .min(1)
          .max(120)
          .describe("Product ID (e.g. 'hoodie_001') or slug."),
      }),
      execute: (input) => getProductDetailsStep(input),
    }),
  };
}

export function createShoppingTools() {
  return {
    ...createCatalogTools(),
    returnOrder: tool({
      description:
        "File a return for a customer's order. Looks up the order, then starts the return process (customer notification, refund pre-authorization, filing). Only call after the shopper has given both the order ID and a reason.",
      inputSchema: z.object({
        orderId: z
          .string()
          .min(1)
          .max(40)
          .regex(/^#?[A-Za-z0-9_-]+$/, "Order IDs contain only letters, digits, - and _")
          .describe("The order number, e.g. '11111'."),
        reason: z
          .string()
          .min(3)
          .max(500)
          .describe("The shopper's reason for the return, in their words."),
      }),
      execute: (input) => returnOrder(input),
    }),
  };
}

export type ShoppingTools = ReturnType<typeof createShoppingTools>;
