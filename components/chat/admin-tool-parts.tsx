"use client";

import { BookmarkCheck, Database } from "lucide-react";
import type { ReactNode } from "react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Terminal,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalStatus,
  TerminalTitle,
} from "@/components/ai-elements/terminal";
import { Tool, ToolContent, ToolHeader } from "@/components/ai-elements/tool";
import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/format";
import type {
  BashResult,
  GetProductDetailsResult,
  InventoryStockResult,
  ReturnsHistoryResult,
  SalesAnalyticsResult,
  SandboxDataFile,
  SaveMemoryResult,
  SupportTicketsResult,
  ToolFailure,
} from "@/lib/tool-results";
import type { ToolPartView } from "./shop-tool-parts";
import { ToolNotice, ToolPending } from "./tool-status";

const PREVIEW_ROWS = 8;

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Shared data-result frame
// ---------------------------------------------------------------------------

interface Column<T> {
  label: string;
  cell: (row: T) => ReactNode;
  align?: "right";
}

function DataResult<T>({
  part,
  pendingLabel,
  title,
  summary,
  rows,
  columns,
  rowKey,
  dataFile,
}: {
  part: ToolPartView<unknown, { ok: boolean } | ToolFailure>;
  pendingLabel: string;
  title: string;
  summary?: string;
  rows?: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  dataFile?: SandboxDataFile;
}) {
  if (part.state === "output-error") {
    return <ToolNotice title={`${title}: request failed`} message="The back-office service didn't respond. Try again shortly." />;
  }
  if (part.state !== "output-available" || !part.output) {
    return <ToolPending label={pendingLabel} />;
  }
  if (!part.output.ok) {
    return <ToolNotice title={`${title}: no data`} message={(part.output as ToolFailure).error.message} />;
  }

  const preview = (rows ?? []).slice(0, PREVIEW_ROWS);
  return (
    <Tool className="mb-0 bg-card">
      <ToolHeader type="dynamic-tool" toolName={title} title={summary ? `${title} · ${summary}` : title} state="output-available" />
      <ToolContent className="space-y-3 pt-0">
        {preview.length === 0 ? (
          <p className="text-sm text-muted-foreground">No records in this range.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  {columns.map((c) => (
                    <th key={c.label} scope="col" className={`px-2 py-1.5 font-medium ${c.align === "right" ? "text-right" : ""}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={rowKey(row)} className="border-t border-border">
                    {columns.map((c) => (
                      <td key={c.label} className={`px-2 py-1.5 align-top ${c.align === "right" ? "text-right tabular-nums" : ""}`}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(rows?.length ?? 0) > PREVIEW_ROWS && (
          <p className="text-xs text-muted-foreground">Showing {PREVIEW_ROWS} of {rows?.length} rows returned.</p>
        )}
        {dataFile && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Database className="size-3.5" aria-hidden="true" />
            {dataFile.path ? (
              <span>
                Full dataset saved to <code className="font-mono">{dataFile.path.replace("/vercel/sandbox/", "")}</code>
              </span>
            ) : (
              <span>{dataFile.note ?? "Dataset not saved to the sandbox."}</span>
            )}
          </p>
        )}
      </ToolContent>
    </Tool>
  );
}

// ---------------------------------------------------------------------------
// Back-office tools
// ---------------------------------------------------------------------------

export function SupportTicketsPart({ part }: { part: ToolPartView<unknown, SupportTicketsResult> }) {
  const out = part.output?.ok ? part.output : undefined;
  return (
    <DataResult
      part={part}
      pendingLabel="Pulling support tickets…"
      title="Support tickets"
      summary={out && `${out.meta.count} found · ${formatDay(out.meta.from)} – ${formatDay(out.meta.to)}`}
      rows={out?.tickets}
      rowKey={(t) => t.id}
      dataFile={out?.dataFile}
      columns={[
        { label: "Subject", cell: (t) => t.subject },
        { label: "Status", cell: (t) => t.status },
        { label: "Priority", cell: (t) => t.priority },
        { label: "Assignee", cell: (t) => t.assignee ?? "—" },
      ]}
    />
  );
}

export function ReturnsHistoryPart({ part }: { part: ToolPartView<unknown, ReturnsHistoryResult> }) {
  const out = part.output?.ok ? part.output : undefined;
  return (
    <DataResult
      part={part}
      pendingLabel="Pulling returns history…"
      title="Returns"
      summary={out && `${out.meta.count} found · ${formatDay(out.meta.from)} – ${formatDay(out.meta.to)}`}
      rows={out?.returns}
      rowKey={(r) => r.id}
      dataFile={out?.dataFile}
      columns={[
        { label: "Items", cell: (r) => r.items.map((i) => `${i.productId} ×${i.quantity}`).join(", ") },
        { label: "Decision", cell: (r) => r.decision ?? r.status },
        { label: "Refund", align: "right", cell: (r) => (r.refundAmount != null ? formatPrice(r.refundAmount) : "—") },
        { label: "Date", cell: (r) => formatDay(r.createdAt) },
      ]}
    />
  );
}

export function InventoryStockPart({ part }: { part: ToolPartView<unknown, InventoryStockResult> }) {
  const out = part.output?.ok ? part.output : undefined;
  return (
    <DataResult
      part={part}
      pendingLabel="Checking inventory…"
      title="Inventory"
      summary={out && `${out.pagination.total} products · page ${out.pagination.page} of ${Math.max(1, out.pagination.totalPages)}`}
      rows={out?.stock}
      rowKey={(s) => s.productId}
      dataFile={out?.dataFile}
      columns={[
        { label: "Product", cell: (s) => s.product.name },
        { label: "Stock", align: "right", cell: (s) => s.stock },
        {
          label: "Status",
          cell: (s) => (!s.inStock ? "Out of stock" : s.lowStock ? "Low" : "OK"),
        },
      ]}
    />
  );
}

export function SalesAnalyticsPart({ part }: { part: ToolPartView<unknown, SalesAnalyticsResult> }) {
  const out = part.output?.ok ? part.output : undefined;
  return (
    <DataResult
      part={part}
      pendingLabel="Pulling sales analytics…"
      title="Sales"
      summary={
        out &&
        `${formatPrice(out.meta.totals.revenue, out.meta.currency)} revenue · ${formatDay(out.meta.from)} – ${formatDay(out.meta.to)}`
      }
      rows={out?.rows}
      rowKey={(r) => r.productId}
      dataFile={out?.dataFile}
      columns={[
        { label: "Product", cell: (r) => r.product.name },
        { label: "Units", align: "right", cell: (r) => r.unitsSold },
        { label: "Revenue", align: "right", cell: (r) => formatPrice(r.revenue, r.currency) },
      ]}
    />
  );
}

/** Compact product lookup for the admin chat (no cart actions). */
export function AdminProductDetailsPart({ part }: { part: ToolPartView<unknown, GetProductDetailsResult> }) {
  if (part.state === "output-error") {
    return <ToolNotice title="Product lookup failed" message="Try again shortly." />;
  }
  if (part.state !== "output-available" || !part.output) {
    return <ToolPending label="Looking up product…" />;
  }
  if (!part.output.ok) {
    return <ToolNotice title="Product not found" message={part.output.error.message} />;
  }
  const { product, stock } = part.output;
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-sm">
      <p className="font-medium text-foreground">{product.name}</p>
      <p className="text-muted-foreground">
        <span className="font-mono text-xs">{product.id}</span> · {product.category} ·{" "}
        {formatPrice(product.price, product.currency)} ·{" "}
        {stock ? `${stock.stock} in stock` : "stock unknown"}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

export function BashPart({
  part,
}: {
  part: ToolPartView<{ command: string }, BashResult>;
}) {
  const command = part.input?.command ?? "";
  const running = part.state === "input-streaming" || part.state === "input-available";
  const result = part.state === "output-available" ? part.output : undefined;

  if (result && !result.ok) {
    return <ToolNotice title="Sandbox command didn't run" message={result.error.message} />;
  }
  if (part.state === "output-error") {
    return <ToolNotice title="Sandbox command failed" message={part.errorText ?? "The sandbox didn't respond."} />;
  }

  const failed = result ? result.exitCode !== 0 : false;
  const output = result
    ? [result.stdout.trimEnd(), result.stderr ? `\u001b[31m${result.stderr.trimEnd()}\u001b[0m` : ""]
        .filter(Boolean)
        .join("\n") || "(no output)"
    : "";

  return (
    <Terminal
      output={`\u001b[2m$ ${command}\u001b[0m${output ? `\n${output}` : ""}`}
      isStreaming={running}
      aria-label="Sandbox command"
      className="text-xs"
    >
      <TerminalHeader className="gap-2 px-3">
        <TerminalTitle className="min-w-0">
          <span className="truncate">{running ? "Running in sandbox" : "Sandbox"}</span>
        </TerminalTitle>
        <div className="flex shrink-0 items-center gap-1.5">
          <TerminalStatus>
            <Shimmer as="span" className="text-xs">running…</Shimmer>
          </TerminalStatus>
          {result && (
            <Badge variant={failed ? "destructive" : "secondary"} className="rounded-full text-[10px]">
              {failed ? `exit ${result.exitCode}` : `ok · ${(result.durationMs / 1000).toFixed(1)}s`}
            </Badge>
          )}
          <TerminalCopyButton className="size-7" />
        </div>
      </TerminalHeader>
      <TerminalContent className="max-h-72 p-3 text-xs" />
    </Terminal>
  );
}

export function SaveMemoryPart({ part }: { part: ToolPartView<{ note: string }, SaveMemoryResult> }) {
  if (part.state === "output-error" || (part.output && !part.output.ok)) {
    const message = part.output && !part.output.ok ? part.output.error.message : "Memory could not be saved.";
    return <ToolNotice title="Not saved to memory" message={message} />;
  }
  if (part.state !== "output-available" || !part.output?.ok) {
    return <ToolPending label="Saving to memory…" />;
  }
  return (
    <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <BookmarkCheck className="mt-0.5 size-3.5 shrink-0 text-foreground" aria-hidden="true" />
      <span>
        <span className="font-medium text-foreground">Remembered ({part.output.category}):</span>{" "}
        {part.output.note}
      </span>
    </p>
  );
}
