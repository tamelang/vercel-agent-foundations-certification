/**
 * Durable shopping-chat workflow: one run per shopper turn.
 *
 * The agent writes model output to the run's durable stream, so a client
 * that loses its connection (or refreshes) reconnects to the same run via
 * `/api/chat/[id]/stream` instead of starting the turn again.
 */
import type { ModelCallStreamPart } from "@ai-sdk/workflow";
import { convertToModelMessages, isStepCount, type UIMessage } from "ai";
import { getWritable } from "workflow";
import { createShoppingAgent } from "../agent";
import { finishStream } from "./stream-utils";

export async function shoppingChatWorkflow({
  messages,
  model,
}: {
  messages: UIMessage[];
  model: string;
}) {
  "use workflow";

  const writable = getWritable<ModelCallStreamPart>();
  const agent = createShoppingAgent(model);

  try {
    const result = await agent.stream({
      messages: await convertToModelMessages(messages),
      writable,
      stopWhen: isStepCount(10),
      // We close the stream ourselves so a failure can be reported first.
      preventClose: true,
    });
    await finishStream(writable);
    return { steps: result.steps.length };
  } catch (err) {
    await finishStream(writable, "Sorry, I ran into a problem answering that. Please try again.");
    throw err;
  }
}
