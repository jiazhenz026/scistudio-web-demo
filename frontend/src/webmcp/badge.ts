/**
 * WebMCP status state, surfaced as a small pill in the top toolbar.
 *
 * `register.ts` calls `setWebmcpStatus` as it probes and registers tools. The
 * value is held here and broadcast on a window event; the toolbar's
 * `WebmcpStatusButton` renders it. This is a tiny event bus rather than a
 * Zustand slice on purpose: the webmcp module stays independent of the app
 * store, and a status set *before* the button mounts is still readable via
 * `getWebmcpStatus()` when it does.
 *
 * (Previously this rendered a fixed-position DOM pill directly. That floated
 * over toolbar controls — notably the Learning Center entry — when it fell back
 * to a fixed position, so it now lives inside the toolbar as a real element.)
 */

export type WebmcpState = "pending" | "ok" | "unavailable" | "error";

export const WEBMCP_COLORS: Record<WebmcpState, string> = {
  pending: "#9aa0a6",
  ok: "#3fb950",
  unavailable: "#9aa0a6",
  error: "#ff7b72",
};

export interface WebmcpStatus {
  state: WebmcpState;
  label: string;
  detail?: string;
}

export const WEBMCP_STATUS_EVENT = "webmcp:status";

let current: WebmcpStatus = { state: "pending", label: "WebMCP · checking…" };

/** The latest status, for a button reading it on mount. */
export function getWebmcpStatus(): WebmcpStatus {
  return current;
}

/** Update the status and notify the toolbar button. `detail` becomes the tooltip. */
export function setWebmcpStatus(state: WebmcpState, label: string, detail?: string): void {
  current = { state, label, detail };
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<WebmcpStatus>(WEBMCP_STATUS_EVENT, { detail: current }));
  }
}
