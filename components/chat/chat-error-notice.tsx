"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToolNotice } from "./tool-status";

/** Shown when a chat turn fails (network, model, or workflow error). */
export function ChatErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <ToolNotice title="Something went wrong" message={message}>
      <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-1 gap-1.5">
        <RotateCcw className="size-3.5" aria-hidden="true" />
        Try again
      </Button>
    </ToolNotice>
  );
}
