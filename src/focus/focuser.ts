// The window-focus seam. One implementation exists per window system.
// The handle is a process id, because that is what a session can
// report about itself: see research/session-window-handle.md.

export type FocusResult =
  | { readonly focused: true; readonly window: string }
  | { readonly focused: false; readonly reason: string };

export interface WindowFocuser {
  /**
   * Brings the window that contains process `pid` to the front. The
   * process can be the window owner or one of its descendants. Never
   * rejects: a failure comes back as `{focused: false}`.
   */
  focusProcess(pid: number): Promise<FocusResult>;
}
