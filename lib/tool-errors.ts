/**
 * Server-side error handling shared by every agent tool step.
 *
 * Convention: transient failures (network, 429, 5xx) are re-thrown so the
 * workflow step retries them; everything else becomes a `ToolFailure` the
 * model can explain to the user. Messages are scrubbed of credentials before
 * they leave the server.
 */
import { getStepMetadata } from "workflow";
import { ADMIN_PASSWORD } from "./admin-auth";
import { ApiRequestError } from "./api";
import type { ToolFailure, ToolFailureCode } from "./tool-results";

export function isTransientError(err: unknown): boolean {
  if (err instanceof ApiRequestError) {
    return err.status === 0 || err.status === 429 || err.status >= 500;
  }
  // Unknown errors (timeouts, DNS, etc.) are worth a retry.
  return true;
}

/** Remove any configured credential from text before it reaches the model or UI. */
export function redactSecrets(text: string): string {
  let out = text;
  const secrets = [
    process.env.BYPASS_SECRET,
    process.env.AI_GATEWAY_API_KEY,
    process.env.VERCEL_OIDC_TOKEN,
    process.env.VERCEL_TOKEN,
    ADMIN_PASSWORD,
  ];
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join("[redacted]");
  }
  return out.replace(/x-vercel-protection-bypass=[^&\s"']+/gi, "x-vercel-protection-bypass=[redacted]");
}

export function toolFailure(
  code: ToolFailureCode,
  message: string,
  extra?: Partial<Omit<ToolFailure, "ok" | "error">>,
): ToolFailure {
  return { ok: false, error: { code, message: redactSecrets(message) }, ...extra };
}

/**
 * Map a non-transient API error to a `ToolFailure`. Call only after
 * `isTransientError` returned false (or retries are exhausted).
 */
export function apiErrorToFailure(err: unknown, notFoundMessage?: string): ToolFailure {
  if (err instanceof ApiRequestError) {
    if (err.status === 404) {
      return toolFailure("NOT_FOUND", notFoundMessage ?? err.message);
    }
    if (err.status === 400 || err.status === 422 || err.code === "VALIDATION_ERROR") {
      return toolFailure("VALIDATION_ERROR", err.message);
    }
    return toolFailure("SERVICE_ERROR", `The store service returned an error (${err.status}).`);
  }
  return toolFailure("SERVICE_ERROR", "The store service could not be reached.");
}

/**
 * Call from a step's `catch`: rethrows transient errors so the workflow
 * retries the step, and converts everything else — including a transient
 * error on the final attempt — into a `ToolFailure` the model can explain.
 */
export function handleStepError(err: unknown, notFoundMessage?: string): ToolFailure {
  if (isTransientError(err)) {
    const { attempt, maxAttempts } = getStepMetadata();
    if (attempt < maxAttempts) throw err;
    console.error("[tool] giving up after retries:", redactSecrets(String(err)));
    return toolFailure(
      "SERVICE_ERROR",
      "The store service is temporarily unavailable. Please try again in a moment.",
    );
  }
  return apiErrorToFailure(err, notFoundMessage);
}
