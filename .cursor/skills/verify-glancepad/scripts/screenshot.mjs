#!/usr/bin/env node
// Opens the simulator page in Chrome and saves a screenshot.

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1];
};

const url = opt("--url");
const out = opt("--out");
const report = opt("--report");
const until =
  opt("--until") ??
  'document.querySelector("#conn")?.textContent === "connected"';
const timeoutMs = Number(opt("--timeout", "15000"));

if (!url || !out || !report) {
  console.error(
    "usage: screenshot.mjs --url URL --out FILE.png --report FILE.txt [--until JS] [--timeout MS]",
  );
  process.exit(1);
}

const chromeBin = process.env.CHROME_PATH || "google-chrome";
const userData = await mkdtemp(join(tmpdir(), "glancepad-chrome-"));
const chrome = spawn(
  chromeBin,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--window-size=1400,900",
    "--remote-debugging-port=0",
    `--user-data-dir=${userData}`,
    "about:blank",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

let browserWs;
let log = "";
let browserReady = false;
const waitForBrowser = new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    reject(new Error(`chrome did not open a devtools port\n${log}`));
  }, 10000);
  const onData = (chunk) => {
    log += chunk.toString();
    const match = log.match(/DevTools listening on (ws:\/\/\S+)/);
    if (match) {
      clearTimeout(timer);
      browserWs = match[1];
      browserReady = true;
      resolve();
    }
  };
  chrome.stdout.on("data", onData);
  chrome.stderr.on("data", onData);
  chrome.on("exit", (code) => {
    if (browserReady) return;
    clearTimeout(timer);
    reject(new Error(`chrome exited ${code}\n${log}`));
  });
});

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () =>
      reject(new Error(`websocket failed ${wsUrl}`)),
    );
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  return {
    ready: opened,
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      ws.close();
    },
  };
}

async function evaluate(page, expression) {
  const result = await page.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "page expression failed");
  }
  return result.result?.value;
}

try {
  await waitForBrowser;
  const versionUrl = browserWs
    .replace("ws://", "http://")
    .replace(/\/devtools\/browser\/.*$/, "/json/version");
  const version = await (await fetch(versionUrl)).json();
  const browser = connect(version.webSocketDebuggerUrl);
  await browser.ready;
  const created = await browser.send("Target.createTarget", { url });
  const listUrl = versionUrl.replace("/json/version", "/json/list");
  let pageWs;
  for (let i = 0; i < 50; i++) {
    const list = await (await fetch(listUrl)).json();
    pageWs = list.find(
      (item) => item.id === created.targetId,
    )?.webSocketDebuggerUrl;
    if (pageWs) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!pageWs) throw new Error("devtools page target was not listed");
  const page = connect(pageWs);
  await page.ready;
  await page.send("Runtime.enable");
  const deadline = Date.now() + timeoutMs;
  let matched = false;
  while (Date.now() < deadline) {
    matched = await evaluate(page, `Boolean(${until})`);
    if (matched) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!matched) throw new Error(`timeout waiting for: ${until}`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const facts = await evaluate(
    page,
    `({
      conn: document.querySelector("#conn")?.textContent ?? "",
      source: document.querySelector("#source-line")?.textContent ?? "",
      selection: document.querySelector("#selection-lighting")?.textContent ?? "",
      ag00Class: document.querySelector("[data-key=AG00]")?.className ?? "",
      ag00Zone: document.querySelector("[data-key=AG00]") ? getComputedStyle(document.querySelector("[data-key=AG00]")).getPropertyValue("--zone-color").trim() : "",
      ringClass: document.querySelector("#ring")?.className ?? "",
      session: document.querySelector('[data-session="0"]')?.textContent ?? ""
    })`,
  );
  const shot = await page.send("Page.captureScreenshot", { format: "png" });
  await writeFile(out, Buffer.from(shot.data, "base64"));
  const lines = [
    `conn: ${facts.conn}`,
    `source: ${facts.source}`,
    `selection: ${facts.selection}`,
    `ag00Class: ${facts.ag00Class}`,
    `ag00Zone: ${facts.ag00Zone}`,
    `ringClass: ${facts.ringClass}`,
    `session: ${facts.session}`,
  ];
  await writeFile(report, `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
  page.close();
  browser.close();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (chrome.exitCode === null && chrome.signalCode === null) {
    chrome.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (chrome.exitCode === null && chrome.signalCode === null) {
          chrome.kill("SIGKILL");
        }
        resolve();
      }, 1000);
      chrome.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  await rm(userData, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  }).catch((error) => {
    console.error(`chrome profile cleanup failed: ${error.message}`);
  });
}
