// The transport for a physical keypad. It keeps one DeviceTransport
// alive across unplug and replug: it looks for the keypad on a timer,
// opens it, polls it for reports, and drops it when an operation
// fails. The OS access sits behind HidBackend, so the tests need no
// keypad (ADR-0003).

import { REPORT_SIZE } from "../protocol/index.js";
import type { DeviceTransport } from "./transport.js";

/** One open HID interface. */
export interface HidHandle {
  /**
   * Returns the next report that waits, or `undefined` when none
   * waits. Never blocks. Throws when the device is gone.
   */
  read(): Uint8Array | undefined;
  /** Writes one report. Rejects when the write fails. */
  write(report: Uint8Array): Promise<void>;
  close(): void;
}

export interface HidBackend {
  /**
   * Opens the keypad. Returns `undefined` when no keypad is present.
   * Throws when a keypad is present but the open fails, for example
   * without permission.
   */
  open(): HidHandle | undefined;
}

export type HidStatus =
  | { readonly kind: "connected" }
  | { readonly kind: "disconnected"; readonly reason: string }
  | { readonly kind: "open-failed"; readonly reason: string };

export interface HidTransportOptions {
  /** Gap between read polls. Default 10 ms. */
  readonly pollMs?: number;
  /** Gap between attempts to find the keypad. Default 1000 ms. */
  readonly retryMs?: number;
}

// One poll takes at most this many reports, so a flood cannot hold
// the event loop.
const READS_PER_POLL = 64;

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class HidTransport implements DeviceTransport {
  readonly #backend: HidBackend;
  readonly #pollMs: number;
  readonly #retryMs: number;
  #handle: HidHandle | undefined;
  #closed = false;
  #openTimer: NodeJS.Timeout | undefined;
  #pollTimer: NodeJS.Timeout | undefined;
  #lastOpenFailure: string | undefined;
  readonly #reportSubscribers = new Set<(report: Uint8Array) => void>();
  readonly #connectSubscribers = new Set<() => void>();
  readonly #statusSubscribers = new Set<(status: HidStatus) => void>();

  /**
   * The first attempt to open runs on a timer, not in the
   * constructor. A subscriber added right after construction
   * therefore sees the first connection.
   */
  constructor(backend: HidBackend, options: HidTransportOptions = {}) {
    this.#backend = backend;
    this.#pollMs = options.pollMs ?? 10;
    this.#retryMs = options.retryMs ?? 1000;
    this.#openTimer = setTimeout(() => this.#tryOpen(), 0);
  }

  get connected(): boolean {
    return this.#handle !== undefined;
  }

  async send(report: Uint8Array): Promise<void> {
    if (report.length !== REPORT_SIZE) {
      throw new TypeError(
        `a report must be exactly ${REPORT_SIZE} bytes, got ${report.length}`,
      );
    }
    const handle = this.#handle;
    if (handle === undefined) throw new Error("DEVICE_DISCONNECTED");
    try {
      await handle.write(report);
    } catch (error) {
      // The state of the device is now unknown. Drop the handle: the
      // next connection tells the host to send its full state again.
      this.#drop(handle, `write failed: ${reasonOf(error)}`);
      throw new Error("WRITE_FAILED", { cause: error });
    }
  }

  onReport(cb: (report: Uint8Array) => void): () => void {
    this.#reportSubscribers.add(cb);
    return () => this.#reportSubscribers.delete(cb);
  }

  onConnect(cb: () => void): () => void {
    this.#connectSubscribers.add(cb);
    return () => this.#connectSubscribers.delete(cb);
  }

  /** Subscribes to connection changes, for the log. */
  onStatus(cb: (status: HidStatus) => void): () => void {
    this.#statusSubscribers.add(cb);
    return () => this.#statusSubscribers.delete(cb);
  }

  async close(): Promise<void> {
    this.#closed = true;
    clearTimeout(this.#openTimer);
    clearInterval(this.#pollTimer);
    this.#handle?.close();
    this.#handle = undefined;
  }

  #emitStatus(status: HidStatus): void {
    for (const cb of this.#statusSubscribers) cb(status);
  }

  #tryOpen(): void {
    if (this.#closed) return;
    let handle: HidHandle | undefined;
    try {
      handle = this.#backend.open();
    } catch (error) {
      // A keypad is present but does not open. The usual causes are
      // a missing udev rule and a node that udev has not tagged yet.
      // Report a reason one time, then try again in silence.
      const reason = reasonOf(error);
      if (reason !== this.#lastOpenFailure) {
        this.#lastOpenFailure = reason;
        this.#emitStatus({ kind: "open-failed", reason });
      }
    }
    if (handle === undefined) {
      this.#openTimer = setTimeout(() => this.#tryOpen(), this.#retryMs);
      return;
    }
    this.#lastOpenFailure = undefined;
    this.#handle = handle;
    this.#pollTimer = setInterval(() => this.#poll(handle), this.#pollMs);
    this.#emitStatus({ kind: "connected" });
    for (const cb of this.#connectSubscribers) cb();
  }

  #poll(handle: HidHandle): void {
    for (let count = 0; count < READS_PER_POLL; count++) {
      let report: Uint8Array | undefined;
      try {
        report = handle.read();
      } catch (error) {
        this.#drop(handle, `read failed: ${reasonOf(error)}`);
        return;
      }
      if (report === undefined) return;
      // A subscriber that throws must not look like a failed read.
      for (const cb of this.#reportSubscribers) cb(report);
    }
  }

  /** Releases a failed handle and starts to look for the keypad. */
  #drop(handle: HidHandle, reason: string): void {
    if (this.#handle !== handle) return;
    this.#handle = undefined;
    clearInterval(this.#pollTimer);
    try {
      handle.close();
    } catch {
      // The node is already gone.
    }
    this.#emitStatus({ kind: "disconnected", reason });
    if (!this.#closed) {
      this.#openTimer = setTimeout(() => this.#tryOpen(), this.#retryMs);
    }
  }
}
