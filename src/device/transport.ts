// The transport seam (ADR-0001). It sits below the framing on purpose:
// implementations exchange already-framed 64-byte reports, so the real
// framing and reassembly code runs against the simulator, the tests,
// and real hardware alike. Only the transport differs.

/**
 * A byte-level connection to a device, real or simulated.
 */
export interface DeviceTransport {
  /** Sends exactly one 64-byte report. Rejects when disconnected. */
  send(report: Uint8Array): Promise<void>;
  /** Subscribes to incoming reports. Returns an unsubscribe function. */
  onReport(cb: (report: Uint8Array) => void): () => void;
  /**
   * Subscribes to connections: the first one and each one after a
   * loss. What the device shows after a loss is unknown, so the host
   * sends its full state again. A transport that never loses its
   * device never calls back.
   */
  onConnect(cb: () => void): () => void;
  /** Releases the connection. Later sends reject. */
  close(): Promise<void>;
  readonly connected: boolean;
}
