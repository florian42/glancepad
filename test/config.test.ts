import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  configPath,
  EMPTY_CONFIG,
  loadConfig,
  mergeTalkCommands,
  parseConfig,
} from "../src/ui/config.js";

describe("configPath", () => {
  it("uses XDG_CONFIG_HOME when it is an absolute path", () => {
    expect(configPath({ XDG_CONFIG_HOME: "/xdg" }, "/home/u")).toBe(
      "/xdg/glancepad/config.json",
    );
  });

  it("falls back to ~/.config when the variable is not set", () => {
    expect(configPath({}, "/home/u")).toBe(
      "/home/u/.config/glancepad/config.json",
    );
  });

  it("ignores a relative XDG_CONFIG_HOME", () => {
    expect(configPath({ XDG_CONFIG_HOME: "relative" }, "/home/u")).toBe(
      "/home/u/.config/glancepad/config.json",
    );
  });
});

describe("parseConfig", () => {
  it("reads the two talk commands", () => {
    expect(parseConfig('{"talk":{"start":" a ","stop":"b"}}')).toEqual({
      talk: { start: "a", stop: "b" },
    });
  });

  it("accepts a file with no talk section", () => {
    expect(parseConfig("{}")).toEqual(EMPTY_CONFIG);
  });

  it("drops an empty command", () => {
    expect(parseConfig('{"talk":{"start":"  "}}')).toEqual(EMPTY_CONFIG);
  });

  it("rejects a command that is not a string", () => {
    expect(() => parseConfig('{"talk":{"start":5}}')).toThrow("talk.start");
  });

  it("rejects a top level that is not an object", () => {
    expect(() => parseConfig("[]")).toThrow("object");
  });
});

describe("loadConfig", () => {
  const dir = mkdtempSync(join(tmpdir(), "glancepad-config-"));

  it("returns the empty configuration for a missing file, silently", () => {
    const lines: string[] = [];
    expect(loadConfig(join(dir, "none.json"), (l) => lines.push(l))).toEqual(
      EMPTY_CONFIG,
    );
    expect(lines).toEqual([]);
  });

  it("reads a valid file", () => {
    const path = join(dir, "ok.json");
    writeFileSync(path, '{"talk":{"start":"x"}}');
    expect(loadConfig(path).talk).toEqual({ start: "x" });
  });

  it("reports an invalid file in one line that omits the content", () => {
    const path = join(dir, "bad.json");
    writeFileSync(path, '{"talk":{"start":"secret-command",}}');
    const lines: string[] = [];
    expect(loadConfig(path, (l) => lines.push(l))).toEqual(EMPTY_CONFIG);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(path);
    expect(lines[0]).not.toContain("secret-command");
  });
});

describe("mergeTalkCommands", () => {
  it("lets the environment replace the file, one command at a time", () => {
    expect(
      mergeTalkCommands({ start: "file-a", stop: "file-b" }, { stop: "env-b" }),
    ).toEqual({ start: "file-a", stop: "env-b" });
  });
});
