/**
 * Store admin agent chat endpoint. Requires the admin session cookie; each
 * POST starts a durable admin workflow run and streams the response.
 */
import { DEFAULT_ADMIN_MODEL } from "@/lib/agent";
import { isAdminRequest } from "@/lib/admin-auth";
import { startChatRun } from "@/lib/chat-route";
import { adminChatWorkflow } from "@/lib/workflows/admin-chat-flow";

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isAdminRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return startChatRun(
    request,
    adminChatWorkflow,
    process.env.ADMIN_AGENT_MODEL ?? DEFAULT_ADMIN_MODEL,
  );
}
