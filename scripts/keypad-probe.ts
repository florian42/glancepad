// Talks to the physical keypad and prints each report in both
// directions. It sends the two lighting requests only, and it never
// sends a firmware, bootloader, or reset command.
//
//   pnpm keypad:probe listen 5
//   pnpm keypad:probe colors
//   pnpm keypad:probe off
//   pnpm keypad:probe thstatus '[{"id":0,"c":255,"b":1,"e":1}]'
//   pnpm keypad:probe rgbcfg '{"ambient":{...},"keys":{...}}'
//   pnpm keypad:probe partial 2000
//
// `partial` sends the first fragment of a message, waits the given
// milliseconds, and then sends a complete message. The replies show
// whether the keypad recovers from a message that never completes.

import { HidTransport } from "../src/device/hidtransport.js";
import {
  CHANNEL_RPC,
  encodeFrames,
  encodeRequest,
  feedReport,
  initialReassembly,
  LIGHTING_EFFECTS,
  METHOD_LIGHTING_CONFIG,
  METHOD_THREADS_LIGHTING,
  OFF_ZONE,
  SEND_COOLDOWN_MS,
  STATUS_COLORS,
} from "../src/protocol/index.js";
import { keypadAccessFor } from "../src/ui/keypadbackend.js";

const started = Date.now();
const stamp = (): string => `${String(Date.now() - started).padStart(6)}ms`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hex = (report: Uint8Array): string =>
  Array.from(report, (b) => b.toString(16).padStart(2, "0")).join("");
const verbose = process.env.PROBE_HEX === "1";

const access = await keypadAccessFor(process.platform);
if (access === undefined) {
  console.error("the probe needs Linux or macOS");
  process.exit(2);
}
const transport = new HidTransport(access.backend);
transport.onStatus((status) => console.log(stamp(), "status", status));

let reassembly = initialReassembly;
transport.onReport((report) => {
  if (verbose) console.log(stamp(), "<- raw", report.length, hex(report));
  const [next, events] = feedReport(reassembly, report);
  reassembly = next;
  for (const event of events) {
    if (event.kind === "line") {
      console.log(stamp(), `<- ch${event.channel}`, JSON.stringify(event.text));
    } else {
      console.log(stamp(), "<- decode error", event.error, hex(report));
    }
  }
});

let id = 100;
const sendText = async (text: string, limit = Infinity): Promise<void> => {
  const reports = encodeFrames(CHANNEL_RPC, text);
  console.log(
    stamp(),
    `-> ${Math.min(limit, reports.length)}/${reports.length} reports`,
    text,
  );
  for (const report of reports.slice(0, limit)) {
    if (verbose) console.log(stamp(), "-> raw", hex(report));
    await transport.send(report);
    await sleep(SEND_COOLDOWN_MS);
  }
};
const request = (method: string, params: unknown, limit?: number) =>
  sendText(encodeRequest(id++, method, params), limit);

const solid = (slot: number, color: number) => ({
  id: slot,
  c: color,
  b: 1,
  e: LIGHTING_EFFECTS.solid,
  s: 0,
  sk: 0,
  sa: 0,
});
const SIX_COLORS = [
  STATUS_COLORS.error,
  STATUS_COLORS["awaiting-approval"],
  STATUS_COLORS.unread,
  STATUS_COLORS.working,
  STATUS_COLORS.idle,
  0xff00ff,
];
const ALL_OFF = [0, 1, 2, 3, 4, 5].map((slot) => ({
  id: slot,
  c: 0,
  b: 0,
  e: LIGHTING_EFFECTS.off,
  s: 0,
  sk: 0,
  sa: 0,
}));

const connected = new Promise<void>((resolve) => transport.onConnect(resolve));
const timeout = sleep(5000).then(() => {
  throw new Error("no keypad opened within 5 seconds");
});
await Promise.race([connected, timeout]);

const [command = "listen", argument] = process.argv.slice(2);
if (command === "listen") {
  await sleep(Number(argument ?? 5) * 1000);
} else if (command === "colors") {
  await request(
    METHOD_THREADS_LIGHTING,
    SIX_COLORS.map((color, slot) => solid(slot, color)),
  );
  await request(METHOD_LIGHTING_CONFIG, { ambient: OFF_ZONE, keys: OFF_ZONE });
  await sleep(1500);
} else if (command === "off") {
  await request(METHOD_THREADS_LIGHTING, ALL_OFF);
  await request(METHOD_LIGHTING_CONFIG, { ambient: OFF_ZONE, keys: OFF_ZONE });
  await sleep(1500);
} else if (command === "thstatus" || command === "rgbcfg") {
  const method =
    command === "thstatus" ? METHOD_THREADS_LIGHTING : METHOD_LIGHTING_CONFIG;
  await request(method, JSON.parse(argument ?? "null"));
  await sleep(Number(process.argv[4] ?? 1500));
} else if (command === "partial") {
  await request(METHOD_THREADS_LIGHTING, ALL_OFF, 1);
  await sleep(Number(argument ?? 2000));
  await request(METHOD_THREADS_LIGHTING, [solid(0, STATUS_COLORS.unread)]);
  await sleep(Number(process.argv[4] ?? 1500));
  await request(METHOD_THREADS_LIGHTING, [solid(1, STATUS_COLORS.unread)]);
  await sleep(1500);
  await request(METHOD_THREADS_LIGHTING, [solid(2, STATUS_COLORS.unread)]);
  await sleep(1500);
} else if (command === "split") {
  // One message, with a pause between its two reports.
  const text = encodeRequest(id++, METHOD_THREADS_LIGHTING, [
    solid(0, STATUS_COLORS.unread),
  ]);
  const [first, second] = encodeFrames(CHANNEL_RPC, text);
  console.log(stamp(), "-> report 1 of 2");
  await transport.send(first as Uint8Array);
  await sleep(Number(argument ?? 3000));
  console.log(stamp(), "-> report 2 of 2");
  await transport.send(second as Uint8Array);
  await sleep(7000);
} else if (command === "watch") {
  // A scene for a person to check, sent again after each replug.
  const scene = async () => {
    await request(METHOD_THREADS_LIGHTING, [
      ...SIX_COLORS.slice(0, 5).map((color, slot) => solid(slot, color)),
      { ...solid(5, 0xff00ff), e: LIGHTING_EFFECTS.breath, s: 0.4 },
    ]);
    await request(METHOD_LIGHTING_CONFIG, {
      ambient: {
        e: LIGHTING_EFFECTS.snake,
        b: 1,
        s: 0.4,
        m: 0,
        c: STATUS_COLORS.working,
      },
      keys: OFF_ZONE,
    });
  };
  transport.onConnect(() => void scene().catch(console.error));
  await scene();
  await sleep(Number(argument ?? 60) * 1000);
} else {
  console.error(`unknown command "${command}"`);
}
await transport.close();
