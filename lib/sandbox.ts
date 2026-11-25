/**
 * The admin agent's Vercel Sandbox: one named, persistent microVM that holds
 * both the agent's scratch data and its long-term memory file. Server-only.
 *
 * The sandbox has no network access and receives no credentials — store data
 * reaches it only as files the app writes after fetching it server-side.
 */
import { Sandbox } from "@vercel/sandbox";
import { redactSecrets } from "./tool-errors";

export const SANDBOX_ROOT = "/vercel/sandbox";
export const DATA_DIR = `${SANDBOX_ROOT}/data`;
export const MEMORY_FILE = `${SANDBOX_ROOT}/memory/MEMORY.md`;

const SANDBOX_NAME = process.env.ADMIN_SANDBOX_NAME ?? "ship-it-shop-admin";
// Idle sessions stop after this long; the filesystem is snapshotted and the
// next call resumes it, so memory survives across sessions.
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;

const MEMORY_HEADER = `# Admin agent memory

Saved employee preferences, corrections, and business context.
Newer entries take precedence over older ones.
`;

function credentials() {
  const { VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID } = process.env;
  // Fall back to the SDK's OIDC lookup (VERCEL_OIDC_TOKEN) when unset.
  return VERCEL_TOKEN && VERCEL_TEAM_ID && VERCEL_PROJECT_ID
    ? { token: VERCEL_TOKEN, teamId: VERCEL_TEAM_ID, projectId: VERCEL_PROJECT_ID }
    : {};
}

let sandboxPromise: Promise<Sandbox> | null = null;

/** Get (resuming if stopped) or create the admin sandbox. */
export function getAdminSandbox(): Promise<Sandbox> {
  sandboxPromise ??= Sandbox.getOrCreate({
    ...credentials(),
    name: SANDBOX_NAME,
    persistent: true,
    timeout: SESSION_TIMEOUT_MS,
    networkPolicy: "deny-all",
    tags: { app: "ship-it-shop", role: "admin-agent" },
    onCreate: async (sandbox) => {
      await sandbox.runCommand("mkdir", ["-p", DATA_DIR, `${SANDBOX_ROOT}/memory`]);
      await sandbox.writeFiles([{ path: MEMORY_FILE, content: MEMORY_HEADER }]);
    },
  }).catch((err) => {
    sandboxPromise = null; // don't cache failures
    throw err;
  });
  return sandboxPromise;
}

export function describeSandboxError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/oidc|credential|unauthori[sz]ed|forbidden|401|403/i.test(message)) {
    return "The analysis sandbox isn't configured with Vercel credentials on this server.";
  }
  return redactSecrets(`The analysis sandbox is unavailable: ${message.split("\n")[0]}`);
}

/** Read the memory file. Returns null when it doesn't exist yet. */
export async function readMemoryFile(): Promise<string | null> {
  const sandbox = await getAdminSandbox();
  const buffer = await sandbox.readFileToBuffer({ path: MEMORY_FILE });
  return buffer ? buffer.toString("utf8") : null;
}

export async function appendMemoryEntry(entry: string): Promise<void> {
  const sandbox = await getAdminSandbox();
  const current = (await readMemoryFile()) ?? MEMORY_HEADER;
  const next = `${current.replace(/\s*$/, "")}\n${entry}\n`;
  await sandbox.writeFiles([{ path: MEMORY_FILE, content: next }]);
}

/** Write a JSON dataset for later bash analysis; returns its sandbox path. */
export async function writeDataFile(name: string, data: unknown): Promise<string> {
  const sandbox = await getAdminSandbox();
  const path = `${DATA_DIR}/${name}.json`;
  await sandbox.writeFiles([{ path, content: JSON.stringify(data, null, 2) }]);
  return path;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runInSandbox(command: string, timeoutMs: number): Promise<CommandResult> {
  const sandbox = await getAdminSandbox();
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", command],
    cwd: SANDBOX_ROOT,
    timeoutMs,
  });
  const [stdout, stderr] = await Promise.all([result.stdout(), result.stderr()]);
  return { exitCode: result.exitCode, stdout, stderr };
}
