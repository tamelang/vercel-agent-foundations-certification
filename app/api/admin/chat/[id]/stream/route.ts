/**
 * Resumes an admin chat run's stream (`id` is the workflow run ID).
 * Requires the admin session cookie.
 */
import { isAdminRequest } from "@/lib/admin-auth";
import { resumeChatRun } from "@/lib/chat-route";

export const maxDuration = 300;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAdminRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  return resumeChatRun(request, id, "adminChatWorkflow");
}
