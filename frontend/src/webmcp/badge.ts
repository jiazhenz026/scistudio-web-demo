/**
 * On-page WebMCP status indicator.
 *
 * The demo's target environment is ChatGPT's built-in browser, which is an
 * Electron shell with no DevTools. Without a visible indicator there is no way
 * to tell "the agent can see 37 tools" from "the page registered nothing" —
 * and those look identical until the agent fails to do anything.
 *
 * It doubles as demo evidence: a viewer can see the tool count on screen
 * rather than being asked to take it on faith.
 *
 * Plain DOM rather than a React component so it does not depend on the app
 * tree mounting — if the SPA itself fails, the badge still reports why.
 */

const ID = "webmcp-status";

type State = "pending" | "ok" | "unavailable" | "error";

const COLORS: Record<State, string> = {
  pending: "#9aa0a6",
  ok: "#3fb950",
  unavailable: "#9aa0a6",
  error: "#ff7b72",
};

function element(): HTMLElement {
  let el = document.getElementById(ID);
  if (el) return el;

  el = document.createElement("div");
  el.id = ID;
  el.style.cssText = [
    "position:fixed",
    "right:12px",
    "bottom:12px",
    "z-index:2147483000",
    "display:flex",
    "align-items:center",
    "gap:7px",
    "padding:6px 11px",
    "border-radius:999px",
    "font:12px/1 ui-sans-serif,system-ui,-apple-system,sans-serif",
    "background:rgba(20,22,27,.92)",
    "color:#e8eaed",
    "border:1px solid rgba(255,255,255,.10)",
    "box-shadow:0 2px 10px rgba(0,0,0,.28)",
    "pointer-events:none",
    "user-select:none",
    "backdrop-filter:blur(6px)",
  ].join(";");
  document.body.appendChild(el);
  return el;
}

/** Render the badge. `detail` becomes the tooltip. */
export function setWebmcpStatus(state: State, label: string, detail?: string): void {
  const el = element();
  el.title = detail ?? label;
  el.innerHTML = "";

  const dot = document.createElement("span");
  dot.style.cssText = `width:7px;height:7px;border-radius:50%;flex:none;background:${COLORS[state]}`;
  const text = document.createElement("span");
  text.textContent = label;

  el.append(dot, text);
}
