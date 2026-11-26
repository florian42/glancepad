// The user configuration file. It follows the XDG Base Directory
// rule: `$XDG_CONFIG_HOME/glancepad/config.json`, and
// `~/.config/glancepad/config.json` when the variable is not set or
// not an absolute path. A missing file is normal. A file that glancepad
// cannot use is reported in one line, and glancepad then starts with
// no configuration.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { TalkCommands } from "./talkaction.js";

export interface GlancepadConfig {
  readonly talk: TalkCommands;
}

export const EMPTY_CONFIG: GlancepadConfig = { talk: {} };

type Env = Readonly<Record<string, string | undefined>>;

/** The path of the configuration file for this environment. */
export function configPath(env: Env, home: string = homedir()): string {
  const base = env.XDG_CONFIG_HOME;
  const dir =
    base !== undefined && isAbsolute(base) ? base : join(home, ".config");
  return join(dir, "glancepad", "config.json");
}

const command = (value: unknown, name: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

/** Reads the configuration from JSON text. Throws on a wrong shape. */
export function parseConfig(text: string): GlancepadConfig {
  const data: unknown = JSON.parse(text);
  if (typeof data !== "object" || data === null || Array.isArray(data))
    throw new Error("the top level must be an object");
  const talk = (data as { talk?: unknown }).talk ?? {};
  if (typeof talk !== "object" || talk === null || Array.isArray(talk))
    throw new Error("talk must be an object");
  const { start: rawStart, stop: rawStop } = talk as Record<string, unknown>;
  const start = command(rawStart, "talk.start");
  const stop = command(rawStop, "talk.stop");
  return {
    talk: {
      ...(start === undefined ? {} : { start }),
      ...(stop === undefined ? {} : { stop }),
    },
  };
}

/**
 * Loads the configuration file. Never throws. The report line names
 * the file and the reason, and never the content of the file.
 */
export function loadConfig(
  path: string,
  report: (line: string) => void = (line) => console.error(line),
): GlancepadConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      report(`config ${path} is not readable: ${(error as Error).message}`);
    return EMPTY_CONFIG;
  }
  try {
    return parseConfig(text);
  } catch (error) {
    report(`config ${path} is not valid: ${(error as Error).message}`);
    return EMPTY_CONFIG;
  }
}

/** A command from the environment replaces the same command in the file. */
export function mergeTalkCommands(
  file: TalkCommands,
  env: TalkCommands,
): TalkCommands {
  return { ...file, ...env };
}
