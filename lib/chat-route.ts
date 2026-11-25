/**
 * Shared plumbing for the durable chat routes (server-only).
 *
 * POST starts one workflow run per turn and streams it back with the
 * `x-workflow-run-id` header that `WorkflowChatTransport` needs. GET replays
 * an existing run's stream from the client's chunk cursor so interrupted or
 * refreshed clients resume without duplicating output or re-running work.
 */
import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse, type UIMessage, validateUIMessages } from "ai";
import { getRun, start } from "workflow/api";

const MAX_BODY_BYTES = 512 * 1024;
const MAX_MESSAGES = 80;

type ChatWorkflow = (input: { messages: UIMessage[]; model: string }) => Promise<unknown>;

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function startChatRun(
  request: Request,
  workflow: ChatWorkflow,
  model: string,
): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return jsonError(413, "Conversation is too long.");

  let messages: UIMessage[];
  try {
    const body = JSON.parse(raw) as { messages?: unknown };
    messages = await validateUIMessages({ messages: body.messages });
  } catch {
    return jsonError(400, "Invalid chat request.");
  }
  if (messages.length === 0 || messages.length > MAX_MESSAGES) {
    return jsonError(400, "Invalid number of messages.");
  }
  if (messages.at(-1)?.role !== "user") {
    return jsonError(400, "The last message must come from the user.");
  }

  const run = await start(workflow, [{ messages, model }]);
  return createUIMessageStreamResponse({
    stream: run.readable.pipeThrough(createModelCallToUIChunkTransform()),
    headers: { "x-workflow-run-id": run.runId },
  });
}

export async function resumeChatRun(
  request: Request,
  runId: string,
  workflowFunctionName: string,
): Promise<Response> {
  const startIndex = Number(new URL(request.url).searchParams.get("startIndex") ?? "0");
  if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
    return jsonError(400, "startIndex must be a non-negative integer.");
  }
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(runId)) return jsonError(404, "Run not found.");

  try {
    const run = getRun(runId);
    // Only replay runs of this route's workflow, so one chat can never read
    // another chat's stream.
    const workflowName = await run.workflowName;
    if (!workflowName.endsWith(`//${workflowFunctionName}`)) {
      return jsonError(404, "Run not found.");
    }
    return createUIMessageStreamResponse({
      stream: run
        .getReadable({ startIndex: 0 })
        .pipeThrough(createModelCallToUIChunkTransform({ uiStartIndex: startIndex })),
      headers: { "x-workflow-run-id": runId },
    });
  } catch {
    return jsonError(404, "Run not found.");
  }
}
