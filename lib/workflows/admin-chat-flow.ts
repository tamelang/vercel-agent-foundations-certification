/**
 * Durable admin-chat workflow: one run per employee turn.
 *
 * Each run starts by reading the memory file from the admin sandbox and
 * handing it to the agent, so saved preferences and corrections apply from
 * the first message of every new conversation.
 */
import type { ModelCallStreamPart } from "@ai-sdk/workflow";
import { convertToModelMessages, isStepCount, type UIMessage } from "ai";
import { getWritable } from "workflow";
import { loadMemoryStep } from "../admin-tools";
import { adminInstructions, createAdminAgent } from "../agent";
import { finishStream } from "./stream-utils";

export async function adminChatWorkflow({
  messages,
  model,
}: {
  messages: UIMessage[];
  model: string;
}) {
  "use workflow";

  const writable = getWritable<ModelCallStreamPart>();
  const agent = createAdminAgent(model);
  const { memory, error: memoryError } = await loadMemoryStep();

  try {
    const result = await agent.stream({
      messages: await convertToModelMessages(messages),
      instructions: adminInstructions({ memory, memoryError, now: new Date() }),
      writable,
      stopWhen: isStepCount(20),
      preventClose: true,
    });
    await finishStream(writable);
    return { steps: result.steps.length };
  } catch (err) {
    await finishStream(writable, "Sorry, the analysis failed before it finished. Please try again.");
    throw err;
  }
}
