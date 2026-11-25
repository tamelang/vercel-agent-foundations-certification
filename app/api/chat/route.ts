/**
 * Shopping agent chat endpoint. Each POST starts a durable workflow run for
 * the shopper's turn and streams the agent's response.
 */
import { DEFAULT_SHOP_MODEL } from "@/lib/agent";
import { startChatRun } from "@/lib/chat-route";
import { shoppingChatWorkflow } from "@/lib/workflows/chat-flow";

export const maxDuration = 300;

export async function POST(request: Request) {
  return startChatRun(
    request,
    shoppingChatWorkflow,
    process.env.SHOP_AGENT_MODEL ?? DEFAULT_SHOP_MODEL,
  );
}
