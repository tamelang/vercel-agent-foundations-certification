/**
 * Durable order-return workflow.
 *
 * Started by the shopping agent's `returnOrder` tool as a child run, so the
 * chat can confirm the filing immediately while this keeps running. Every
 * side effect is its own step: if one fails, the workflow retries only that
 * step — a completed customer notification or refund pre-authorization is
 * never repeated.
 */
import { createWebhook, FatalError, sleep } from "workflow";
import {
  ApiRequestError,
  createReturn,
  getOrder,
  getReturn,
  notifyReturnInProcess,
  preauthorizeRefund,
} from "../api";
import type { RefundPreauthorization, Return } from "../types";

export interface ReturnOrderInput {
  orderId: string;
  reason: string;
}

const RETURNABLE = ["fulfilled", "delivered", "shipped"];
// The store decides 15–60s after filing; poll a little beyond that.
const MAX_STATUS_CHECKS = 6;

async function lookUpOrder(orderId: string) {
  "use step";
  try {
    const order = await getOrder(orderId);
    if (!RETURNABLE.includes(order.status)) {
      throw new FatalError(`Order ${orderId} is ${order.status} and cannot be returned.`);
    }
    return {
      id: order.id,
      items: order.items.map(({ productId, quantity }) => ({ productId, quantity })),
    };
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) {
      throw new FatalError(`Order ${orderId} does not exist.`);
    }
    throw err;
  }
}

async function notifyCustomer(orderId: string): Promise<void> {
  "use step";
  await notifyReturnInProcess(orderId);
}

async function preauthorize(orderId: string): Promise<RefundPreauthorization> {
  "use step";
  return preauthorizeRefund(orderId);
}

async function fileReturn(input: {
  orderId: string;
  reason: string;
  items: { productId: string; quantity: number }[];
  callback?: string;
}): Promise<Return> {
  "use step";
  try {
    return await createReturn(input);
  } catch (err) {
    // A 4xx means the store rejected the request itself; retrying won't help.
    if (err instanceof ApiRequestError && err.status >= 400 && err.status < 500) {
      throw new FatalError(`The store rejected the return: ${err.message}`);
    }
    throw err;
  }
}

async function checkReturnStatus(returnId: string): Promise<Return> {
  "use step";
  return getReturn(returnId);
}

async function notifyDecision(ret: Return): Promise<void> {
  "use step";
  // In production this would hit your email provider.
  console.log(
    `[returnOrder] 📧 told customer return ${ret.id} for order ${ret.orderId} was ${ret.decision ?? ret.status}`,
  );
}

export async function returnOrderWorkflow({ orderId, reason }: ReturnOrderInput) {
  "use workflow";

  const order = await lookUpOrder(orderId);
  await notifyCustomer(orderId);
  const refund = await preauthorize(orderId);

  // The store POSTs to `callback` when it has decided. It can only reach a
  // public URL, so locally we skip it and rely on polling alone. The callback
  // is just a wake-up signal: the decision is always re-read from the API.
  const webhook = createWebhook();
  const callback = webhook.url.startsWith("https://") ? webhook.url : undefined;
  if (callback) await webhook.getConflict();

  const filed = await fileReturn({ orderId, reason, items: order.items, callback });

  let latest = filed;
  for (let check = 0; check < MAX_STATUS_CHECKS && latest.decision === null; check++) {
    await (callback ? Promise.race([webhook, sleep("30s")]) : sleep("20s"));
    latest = await checkReturnStatus(filed.id);
  }
  webhook.dispose();

  if (latest.decision !== null) await notifyDecision(latest);

  return {
    returnId: filed.id,
    orderId,
    refundPreauthorizationId: refund.id,
    status: latest.status,
    decision: latest.decision,
    refundAmount: latest.refundAmount,
  };
}
