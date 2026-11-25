/**
 * Resumes a shopping chat run's stream (`id` is the workflow run ID). Called
 * by `WorkflowChatTransport` after a dropped connection or a page refresh.
 */
import { resumeChatRun } from "@/lib/chat-route";

export const maxDuration = 300;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return resumeChatRun(request, id, "shoppingChatWorkflow");
}
