export type ProbeRecord = {
  at: number;
  event: string;
  detail: Record<string, unknown>;
};

declare module "claude-code" {
  interface PluginState {
    "glancepad-probe": { records: ProbeRecord[] };
  }
}
