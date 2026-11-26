// The simulated Codex Micro. It stands on the device side of the
// transport seam: it accepts already-framed 64-byte reports, runs the
// real reassembly and RPC accumulation from src/protocol, answers the
// two lighting calls, and emits key events as framed notifications.

import type { DeviceTransport } from "../device/transport.js";
import {
  type AgentKey,
  CHANNEL_RPC,
  type CommandKey,
  decodeReport,
  encodeLine,
  encodeNotification,
  encodeResponse,
  feedRpcLine,
  initialRpcAccumulator,
  isValidRequestId,
  KEY_ACTS,
  METHOD_LIGHTING_CONFIG,
  METHOD_THREADS_LIGHTING,
  NOTIFY_KEYS,
  parseConfigParams,
  parseThreadsParams,
  REPORT_SIZE,
  type RpcRequest,
} from "../protocol/index.js";
import {
  applyLightingConfig,
  applyThreadsLighting,
  initialLedState,
  type LedState,
} from "./ledmodel.js";

/** A key a human can press on the simulated device. */
export type DeviceKey = AgentKey | CommandKey;

/** One report crossing the seam, for the frame log. */
export interface FrameEvent {
  readonly direction: "host-to-device" | "device-to-host";
  readonly report: Uint8Array;
  /** Complete RPC texts whose reassembly this report finished. */
  readonly decoded: readonly string[];
  /** Set when the report itself failed to decode. */
  readonly note?: string;
}

export class SimulatedDevice implements DeviceTransport {
  #connected = true;
  #rpc = initialRpcAccumulator;
  #led: LedState = initialLedState;
  readonly #reportSubscribers = new Set<(report: Uint8Array) => void>();
  readonly #frameSubscribers = new Set<(event: FrameEvent) => void>();
  readonly #lightingSubscribers = new Set<(state: LedState) => void>();

  get connected(): boolean {
    return this.#connected;
  }

  /** The LED state the device currently displays. */
  get lighting(): LedState {
    return this.#led;
  }

  async send(report: Uint8Array): Promise<void> {
    if (!this.#connected) {
      throw new Error("DEVICE_DISCONNECTED");
    }
    if (report.length !== REPORT_SIZE) {
      throw new TypeError(
        `a report must be exactly ${REPORT_SIZE} bytes, got ${report.length}`,
      );
    }
    const copy = Uint8Array.from(report);
    const decodedReport = decodeReport(copy);

    // Host-to-device RPC travels bare (docs/protocol.md §3): no line
    // terminator ever arrives, so this side finds message boundaries by
    // JSON completeness alone. The host escapes the wire text to pure
    // ASCII (§5), so decoding each fragment on its own is safe here.
    const decoded: string[] = [];
    const replies: string[] = [];
    let note: string | undefined;
    if (!decodedReport.ok) {
      note = `decode error: ${decodedReport.reason}`;
    } else if (decodedReport.frame.channel === CHANNEL_RPC) {
      const text = new TextDecoder().decode(decodedReport.frame.payload);
      const [nextRpc, result] = feedRpcLine(this.#rpc, text);
      this.#rpc = nextRpc;
      if (result !== undefined) {
        decoded.push(result.raw);
        if (result.ok && result.message.kind === "request") {
          const reply = this.#handleRequest(result.message);
          if (reply !== undefined) replies.push(reply);
        }
      }
    }

    this.#emitFrame({
      direction: "host-to-device",
      report: copy,
      decoded,
      note,
    });
    for (const reply of replies) {
      this.#transmit(reply);
    }
  }

  onReport(cb: (report: Uint8Array) => void): () => void {
    this.#reportSubscribers.add(cb);
    return () => this.#reportSubscribers.delete(cb);
  }

  /** The simulated device never loses its connection. */
  onConnect(_cb: () => void): () => void {
    return () => {};
  }

  async close(): Promise<void> {
    this.#connected = false;
  }

  /** Subscribes to LED state changes. */
  onLighting(cb: (state: LedState) => void): () => void {
    this.#lightingSubscribers.add(cb);
    return () => this.#lightingSubscribers.delete(cb);
  }

  /** Subscribes to the frame log feed, both directions. */
  onFrame(cb: (event: FrameEvent) => void): () => void {
    this.#frameSubscribers.add(cb);
    return () => this.#frameSubscribers.delete(cb);
  }

  /** A human presses a key. Emits `{key, act: 1}` toward the host. */
  pressKey(key: DeviceKey): void {
    this.#notifyKey(key, KEY_ACTS.press);
  }

  /** A human releases a key. Emits `{key, act: 0}` toward the host. */
  releaseKey(key: DeviceKey): void {
    this.#notifyKey(key, KEY_ACTS.release);
  }

  #notifyKey(key: DeviceKey, act: number): void {
    this.#transmit(encodeNotification(NOTIFY_KEYS, { key, act }));
  }

  /**
   * Handles one request; returns the response text to transmit, or
   * `undefined` for a request the device drops. The firmware rejects
   * ids outside [0, 999); how it answers them is unread, so the
   * simulated device drops such requests without a response.
   */
  #handleRequest(request: RpcRequest): string | undefined {
    if (!isValidRequestId(request.id)) return undefined;
    if (request.method === METHOD_THREADS_LIGHTING) {
      const entries = parseThreadsParams(request.params);
      if (entries === undefined) return invalidParams(request.id);
      this.#setLighting(applyThreadsLighting(this.#led, entries));
      return encodeResponse(request.id, { result: true });
    }
    if (request.method === METHOD_LIGHTING_CONFIG) {
      const config = parseConfigParams(request.params);
      if (config === undefined) return invalidParams(request.id);
      this.#setLighting(applyLightingConfig(this.#led, config));
      return encodeResponse(request.id, { result: true });
    }
    return encodeResponse(request.id, {
      error: { code: -32601, message: "method not found" },
    });
  }

  #setLighting(next: LedState): void {
    this.#led = next;
    for (const cb of this.#lightingSubscribers) cb(next);
  }

  /** Frames one device-to-host line and delivers its reports. */
  #transmit(text: string): void {
    const reports = encodeLine(CHANNEL_RPC, text);
    reports.forEach((report, index) => {
      this.#emitFrame({
        direction: "device-to-host",
        report,
        decoded: index === reports.length - 1 ? [text] : [],
      });
      for (const cb of this.#reportSubscribers) cb(report);
    });
  }

  #emitFrame(event: FrameEvent): void {
    for (const cb of this.#frameSubscribers) cb(event);
  }
}

const invalidParams = (id: number): string =>
  encodeResponse(id, { error: { code: -32602, message: "invalid params" } });
