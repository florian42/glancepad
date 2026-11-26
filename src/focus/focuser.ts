// The window-focus seam. One implementation exists per window system.
// A terminal session reports a process id. A Claude Desktop session
// reports its host session id also, because one app window contains
// all its sessions. See research/session-window-handle.md and
// research/claude-desktop-sessions.md.

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
  /**
   * Selects one session in the Claude Desktop app and brings the app
   * window to the front. `pid` is the session process when known; it
   * finds the app window. Never rejects.
   */
  focusDesktopSession(
    hostSessionId: string,
    pid: number | undefined,
  ): Promise<FocusResult>;
}
