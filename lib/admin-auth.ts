/**
 * Shared constants for the demo-grade admin gate.
 *
 * Imported by both `proxy.ts` (cookie check) and `lib/admin-actions.ts`
 * (login/logout server actions) so the password and cookie name live in
 * exactly one place.
 *
 * DEMO ONLY: the password is a hardcoded literal and the cookie value is
 * the password itself. Not suitable for real auth — replace with a random
 * opaque token compared against a server-side allowlist (or a signed
 * value) before shipping anything user-facing.
 */
export const ADMIN_PASSWORD = "letmeinadminagent";
export const ADMIN_COOKIE_NAME = "admin_auth";

/** Cookie path: `/` so the session also reaches the `/api/admin/*` routes. */
export const ADMIN_COOKIE_PATH = "/";

/** True when the request carries a valid admin session cookie. */
export function isAdminRequest(request: Request): boolean {
  const header = request.headers.get("cookie") ?? "";
  return header
    .split(";")
    .some((part) => part.trim() === `${ADMIN_COOKIE_NAME}=${ADMIN_PASSWORD}`);
}
