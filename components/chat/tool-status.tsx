"use client";

import { AlertCircle } from "lucide-react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { cn } from "@/lib/utils";

/** In-progress line for a tool call, phrased for people rather than tools. */
export function ToolPending({ label }: { label: string }) {
  return (
    <div role="status" className="text-sm">
      <Shimmer as="span">{label}</Shimmer>
    </div>
  );
}

/** Inline explanation of a failed lookup or action. */
export function ToolNotice({
  title,
  message,
  className,
  children,
}: {
  title: string;
  message: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm",
        className,
      )}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-muted-foreground">{message}</p>
        {children}
      </div>
    </div>
  );
}
