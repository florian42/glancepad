// Claude Desktop sessions. One app window contains all sessions, so a
// process id cannot select one. The app gives each session an id of
// the form `local_<uuid>`, and it opens a session from a link that
// contains this id. The evidence is in
// research/claude-desktop-sessions.md.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** The Hyprland window class of the Claude Desktop app. */
export const DESKTOP_WINDOW_CLASS = "com.anthropic.Claude";

const HOST_SESSION_ID =
  /^local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Accepts a Claude Desktop session id and nothing else. The id goes
 * into a link that the system opens, so the shape check is the guard.
 */
export function parseHostSessionId(value: unknown): string | undefined {
  return typeof value === "string" && HOST_SESSION_ID.test(value)
    ? value
    : undefined;
}

/** The link that opens one session in the Claude Desktop app. */
export function desktopSessionUri(hostSessionId: string): string {
  return `claude://claude.ai/epitaxy/${hostSessionId}`;
}

/** The directory where each `claude` process keeps a session record. */
export function sessionRecordDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "sessions");
}

/**
 * Reads the Claude Desktop session id of process `pid` from its
 * session record, `<dir>/<pid>.json`. A terminal session has a record
 * without this id. Returns `undefined` for that, and for any failure.
 */
export async function readHostSessionId(
  pid: number,
  dir: string = sessionRecordDir(),
): Promise<string | undefined> {
  try {
    const record: unknown = JSON.parse(
      await readFile(join(dir, `${pid}.json`), "utf8"),
    );
    if (typeof record !== "object" || record === null) return undefined;
    return parseHostSessionId(
      (record as Record<string, unknown>).hostSessionId,
    );
  } catch {
    return undefined;
  }
}
