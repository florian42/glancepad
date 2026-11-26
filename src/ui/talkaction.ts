// The push-to-talk effect: one shell command for talk-start and one
// for talk-stop. The user sets them. The README gives the reason and
// an example. A command that fails is reported in one line and
// nothing more: the output of the command stays out of the log.

import { spawn } from "node:child_process";
import type { TalkAction } from "../talk/index.js";

export interface TalkCommands {
  readonly start?: string;
  readonly stop?: string;
}

/** A command that runs longer than this is stopped. */
export const TALK_COMMAND_TIMEOUT_MS = 5000;

/** Reads GLANCEPAD_TALK_START and GLANCEPAD_TALK_STOP. */
export function talkCommandsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): TalkCommands {
  const read = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value === undefined || value.length === 0 ? undefined : value;
  };
  const start = read("GLANCEPAD_TALK_START");
  const stop = read("GLANCEPAD_TALK_STOP");
  return {
    ...(start === undefined ? {} : { start }),
    ...(stop === undefined ? {} : { stop }),
  };
}

/** How one action ended. The page shows this. */
export type TalkOutcome = "ok" | "failed" | "no-command";

export interface TalkCommandRunnerOptions {
  readonly timeoutMs?: number;
  /** Receives one line for each failure. Default is console.error. */
  readonly report?: (line: string) => void;
}

/**
 * Returns a function that runs the command of an action. The commands
 * run one at a time and in order, so a stop never overtakes its start.
 * The returned promise never rejects.
 */
export function createTalkCommandRunner(
  commands: TalkCommands,
  options: TalkCommandRunnerOptions = {},
): (action: TalkAction) => Promise<TalkOutcome> {
  const timeoutMs = options.timeoutMs ?? TALK_COMMAND_TIMEOUT_MS;
  const report = options.report ?? ((line: string) => console.error(line));
  let chain: Promise<unknown> = Promise.resolve();

  const run = (action: TalkAction, command: string): Promise<TalkOutcome> =>
    new Promise((resolve) => {
      const fail = (reason: string): void => {
        report(`${action} command failed: ${reason}`);
        resolve("failed");
      };
      try {
        const child = spawn(command, {
          shell: true,
          stdio: "ignore",
          timeout: timeoutMs,
          env: { ...process.env, GLANCEPAD_TALK_ACTION: action },
        });
        child.once("error", (error) => fail(error.message));
        child.once("exit", (code, signal) => {
          if (code === 0) resolve("ok");
          else fail(signal === null ? `exit code ${code}` : `signal ${signal}`);
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "spawn error");
      }
    });

  return (action) => {
    const command = action === "talk-start" ? commands.start : commands.stop;
    if (command === undefined) return Promise.resolve("no-command");
    const result = chain.then(() => run(action, command));
    chain = result;
    return result;
  };
}
