// The Claude Desktop session id: its shape, its link, and the session
// record that a `claude` process writes. The record layout was read
// from a real session: see research/claude-desktop-sessions.md.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  desktopSessionUri,
  parseHostSessionId,
  readHostSessionId,
  sessionRecordDir,
} from "../src/focus/index.js";

const HOST = "local_01234567-89ab-4cde-8f01-23456789abcd";
let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("parseHostSessionId", () => {
  it("accepts the id that the app gives a session", () => {
    expect(parseHostSessionId(HOST)).toBe(HOST);
  });

  it("refuses all other values", () => {
    for (const value of ["", "01234567", `${HOST}/x`, `${HOST} `, 7, [HOST]]) {
      expect(parseHostSessionId(value)).toBeUndefined();
    }
  });
});

it("builds the link that opens a session", () => {
  expect(desktopSessionUri(HOST)).toBe(`claude://claude.ai/epitaxy/${HOST}`);
});

it("honors CLAUDE_CONFIG_DIR for the record directory", () => {
  expect(sessionRecordDir({ CLAUDE_CONFIG_DIR: "/x/cfg" })).toBe(
    "/x/cfg/sessions",
  );
});

describe("readHostSessionId", () => {
  it("reads the id from the record of a Desktop session", async () => {
    dir = await mkdtemp(join(tmpdir(), "glancepad-"));
    await writeFile(
      join(dir, "4321.json"),
      JSON.stringify({
        pid: 4321,
        entrypoint: "claude-desktop",
        hostSessionId: HOST,
      }),
    );
    expect(await readHostSessionId(4321, dir)).toBe(HOST);
  });

  it("returns nothing for a terminal session, a bad record, and no record", async () => {
    dir = await mkdtemp(join(tmpdir(), "glancepad-"));
    await writeFile(join(dir, "1.json"), JSON.stringify({ pid: 1 }));
    await writeFile(join(dir, "2.json"), "not json");
    expect(await readHostSessionId(1, dir)).toBeUndefined();
    expect(await readHostSessionId(2, dir)).toBeUndefined();
    expect(await readHostSessionId(3, dir)).toBeUndefined();
  });
});
