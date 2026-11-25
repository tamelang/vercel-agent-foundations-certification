"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Check, CheckCircle2, Minus, Plus, ShoppingBag } from "lucide-react";
import { useCart } from "@/components/cart-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/format";
import type {
  GetAllCategoriesResult,
  GetProductDetailsResult,
  ProductSummary,
  ReturnOrderResult,
  SearchProductsResult,
} from "@/lib/tool-results";
import type { StockInfo } from "@/lib/types";
import { ToolNotice, ToolPending } from "./tool-status";

/** The tool-part fields every renderer needs (structurally matches AI SDK tool parts). */
export interface ToolPartView<I, O> {
  state: string;
  input?: Partial<I>;
  output?: O;
  errorText?: string;
}

/** Called when the shopper follows a link out of the chat (e.g. to close a mobile panel). */
type OnNavigate = { onNavigate?: () => void };

// ---------------------------------------------------------------------------
// searchProducts
// ---------------------------------------------------------------------------

export function ProductSearchPart({
  part,
  onNavigate,
}: {
  part: ToolPartView<{ query: string; category: string }, SearchProductsResult>;
} & OnNavigate) {
  if (part.state === "output-error") {
    return <ToolNotice title="Search failed" message="We couldn't search the catalog just now." />;
  }
  if (part.state !== "output-available" || !part.output) {
    const q = part.input?.query;
    const c = part.input?.category;
    return (
      <ToolPending
        label={q ? `Searching for “${q}”…` : c ? `Browsing ${c}…` : "Browsing the catalog…"}
      />
    );
  }
  const result = part.output;
  if (!result.ok) {
    return (
      <ToolNotice title="Search failed" message={result.error.message}>
        {result.validCategories && (
          <p className="text-xs text-muted-foreground">
            Available categories: {result.validCategories.join(", ")}
          </p>
        )}
      </ToolNotice>
    );
  }
  if (result.products.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
        No products matched
        {result.query ? ` “${result.query}”` : ""}
        {result.category ? ` in ${result.category}` : ""}.
      </p>
    );
  }

  const total = result.pagination?.total ?? result.products.length;
  const label = result.query
    ? `Results for “${result.query}”`
    : result.category
      ? `${result.category} products`
      : "Products";

  return (
    <section aria-label={label} className="w-full space-y-2">
      <p className="text-xs text-muted-foreground">
        {label} · showing {result.products.length} of {total}
      </p>
      <ul className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2">
        {result.products.map((product) => (
          <li key={product.id} className="w-36 shrink-0 snap-start">
            <ProductTile product={product} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProductTile({ product, onNavigate }: { product: ProductSummary } & OnNavigate) {
  return (
    <Link
      href={product.url}
      onClick={onNavigate}
      className="group block overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative aspect-square overflow-hidden bg-secondary">
        {product.image && (
          <Image
            src={product.image}
            alt=""
            fill
            sizes="144px"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        )}
      </div>
      <div className="space-y-0.5 p-2.5">
        <p className="line-clamp-2 text-xs font-medium leading-snug text-foreground">
          {product.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatPrice(product.price, product.currency)}
        </p>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// getProductDetails
// ---------------------------------------------------------------------------

export function ProductDetailsPart({
  part,
  onNavigate,
}: {
  part: ToolPartView<{ productId: string }, GetProductDetailsResult>;
} & OnNavigate) {
  if (part.state === "output-error") {
    return (
      <ToolNotice title="Couldn't load that product" message="The product lookup failed. Please try again." />
    );
  }
  if (part.state !== "output-available" || !part.output) {
    return <ToolPending label="Looking up product details…" />;
  }
  const result = part.output;
  if (!result.ok) {
    return (
      <ToolNotice
        title={result.error.code === "NOT_FOUND" ? "Product not found" : "Couldn't load that product"}
        message={result.error.message}
      />
    );
  }
  return <ProductDetailsCard result={result} onNavigate={onNavigate} />;
}

function stockLabel(stock: StockInfo | null) {
  if (!stock) return { text: "Availability unknown", tone: "muted" as const };
  if (!stock.inStock) return { text: "Out of stock", tone: "bad" as const };
  if (stock.lowStock) return { text: `Only ${stock.stock} left`, tone: "warn" as const };
  return { text: `In stock · ${stock.stock} available`, tone: "good" as const };
}

function ProductDetailsCard({
  result,
  onNavigate,
}: {
  result: Extract<GetProductDetailsResult, { ok: true }>;
} & OnNavigate) {
  const { product, stock, url } = result;
  const { addToCart, openCart } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [imageIndex, setImageIndex] = useState(0);
  const availability = stockLabel(stock);
  const maxQty = stock?.inStock ? Math.max(1, stock.stock) : 1;
  const canBuy = stock?.inStock ?? false;

  const handleAdd = () => {
    addToCart(product, quantity);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <article
      aria-label={product.name}
      className="w-full overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="relative aspect-[4/3] bg-secondary">
        {product.images[imageIndex] && (
          <Image
            src={product.images[imageIndex]}
            alt={product.name}
            fill
            sizes="(min-width: 768px) 400px, 90vw"
            className="object-cover"
          />
        )}
      </div>
      {product.images.length > 1 && (
        <div className="flex gap-2 px-3 pt-3" role="group" aria-label="Product images">
          {product.images.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setImageIndex(i)}
              aria-label={`Show image ${i + 1}`}
              aria-pressed={i === imageIndex}
              className="relative size-12 overflow-hidden rounded-md border border-border aria-pressed:border-foreground"
            >
              <Image src={src} alt="" fill sizes="48px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
      <div className="space-y-3 p-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="capitalize">
              {product.category}
            </Badge>
            {product.featured && <Badge variant="outline">Featured</Badge>}
          </div>
          <h3 className="text-base font-semibold leading-tight text-foreground">{product.name}</h3>
          <p className="text-sm font-medium text-foreground">
            {formatPrice(product.price, product.currency)}
          </p>
        </div>

        <p
          className={
            availability.tone === "good"
              ? "text-sm text-emerald-600 dark:text-emerald-400"
              : availability.tone === "warn"
                ? "text-sm text-amber-600 dark:text-amber-400"
                : availability.tone === "bad"
                  ? "text-sm text-destructive"
                  : "text-sm text-muted-foreground"
          }
        >
          {availability.text}
        </p>

        <p className="text-sm leading-relaxed text-muted-foreground">{product.description}</p>

        {product.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
            {product.tags.map((tag) => (
              <li key={tag}>
                <Badge variant="outline" className="font-normal">
                  {tag}
                </Badge>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <div className="flex items-center rounded-md border border-border" role="group" aria-label="Quantity">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={!canBuy || quantity <= 1}
              aria-label="Decrease quantity"
            >
              <Minus className="size-3.5" />
            </Button>
            <span className="w-8 text-center text-sm tabular-nums" aria-live="polite">
              {quantity}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
              disabled={!canBuy || quantity >= maxQty}
              aria-label="Increase quantity"
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
          <Button type="button" size="sm" onClick={handleAdd} disabled={!canBuy} className="flex-1">
            {added ? (
              <>
                <Check className="size-4" aria-hidden="true" /> Added
              </>
            ) : (
              <>
                <ShoppingBag className="size-4" aria-hidden="true" /> Add to cart
              </>
            )}
          </Button>
        </div>
        <div className="flex items-center justify-between text-sm">
          <Link
            href={url}
            onClick={onNavigate}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            View product page
          </Link>
          {added && (
            <button
              type="button"
              onClick={openCart}
              className="text-muted-foreground underline-offset-4 hover:underline"
            >
              Open cart
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// getAllCategories
// ---------------------------------------------------------------------------

export function CategoriesPart({
  part,
  onNavigate,
}: {
  part: ToolPartView<Record<string, never>, GetAllCategoriesResult>;
} & OnNavigate) {
  if (part.state === "output-error") {
    return <ToolNotice title="Couldn't load categories" message="Please try again in a moment." />;
  }
  if (part.state !== "output-available" || !part.output) {
    return <ToolPending label="Checking store categories…" />;
  }
  if (!part.output.ok) {
    return <ToolNotice title="Couldn't load categories" message={part.output.error.message} />;
  }
  return (
    <nav aria-label="Store categories">
      <ul className="flex flex-wrap gap-1.5">
        {part.output.categories.map((category) => (
          <li key={category.slug}>
            <Link
              href={`/search?category=${encodeURIComponent(category.slug)}`}
              onClick={onNavigate}
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-foreground transition-colors hover:bg-secondary"
            >
              {category.name}
              <span className="text-muted-foreground">{category.productCount}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// returnOrder
// ---------------------------------------------------------------------------

export function ReturnOrderPart({
  part,
}: {
  part: ToolPartView<{ orderId: string; reason: string }, ReturnOrderResult>;
}) {
  if (part.state === "output-error") {
    return (
      <ToolNotice
        title="Return not filed"
        message="Something went wrong before the return could be filed. Nothing was submitted — please try again."
      />
    );
  }
  if (part.state !== "output-available" || !part.output) {
    return (
      <ToolPending
        label={part.input?.orderId ? `Filing a return for order ${part.input.orderId}…` : "Filing your return…"}
      />
    );
  }
  const result = part.output;
  if (!result.ok) {
    const title =
      result.error.code === "NOT_FOUND"
        ? "Order not found"
        : result.error.code === "NOT_ELIGIBLE"
          ? "This order can't be returned"
          : result.error.code === "ALREADY_IN_PROGRESS"
            ? "Return already in progress"
            : "Return not filed";
    return <ToolNotice title={title} message={result.error.message} />;
  }

  return (
    <section
      aria-label={`Return for order ${result.orderId}`}
      className="w-full space-y-3 rounded-lg border border-border bg-card p-4 text-sm"
    >
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <div>
          <h3 className="font-semibold text-foreground">Return filed for order {result.orderId}</h3>
          <p className="text-muted-foreground">Reason: {result.reason}</p>
        </div>
      </div>
      <ul className="space-y-1 border-y border-border py-2">
        {result.items.map((item) => (
          <li key={item.productId} className="flex justify-between gap-3">
            <span className="text-foreground">{item.name}</span>
            <span className="text-muted-foreground">× {item.quantity}</span>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Refund (up to)</dt>
        <dd className="text-right font-medium text-foreground">
          {formatPrice(result.refundEstimate.amount, result.refundEstimate.currency)}
        </dd>
        <dt className="text-muted-foreground">Reference</dt>
        <dd className="truncate text-right font-mono text-xs leading-5 text-foreground" title={result.reference}>
          {result.reference}
        </dd>
      </dl>
      <p className="text-xs text-muted-foreground">{result.nextSteps}</p>
    </section>
  );
}
