import type { ModelCallStreamPart } from "@ai-sdk/workflow";

/**
 * Close a chat run's durable stream, optionally reporting an error first so
 * the client shows it instead of an empty reply. Stream writes must happen
 * in a step.
 */
export async function finishStream(
  writable: WritableStream<ModelCallStreamPart>,
  errorMessage?: string,
): Promise<void> {
  "use step";
  if (errorMessage) {
    const writer = writable.getWriter();
    try {
      await writer.write({ type: "error", error: errorMessage } as ModelCallStreamPart);
    } finally {
      writer.releaseLock();
    }
  }
  await writable.close();
}
