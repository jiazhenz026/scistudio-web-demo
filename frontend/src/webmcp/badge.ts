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

  // Shared visual: a small pill. Colours are tuned to sit inside the light
  // toolbar rather than float over dark canvas.
  const base = [
    "display:flex",
    "align-items:center",
    "gap:6px",
    "padding:4px 10px",
    "border-radius:999px",
    "font:12px/1 ui-sans-serif,system-ui,-apple-system,sans-serif",
    "background:#f5f1e8",
    "color:#57534e",
    "border:1px solid #e7e5e4",
    "user-select:none",
    "white-space:nowrap",
  ];

  // Preferred home: a slot the Toolbar renders (#webmcp-status-slot). Plain DOM
  // appended into a React-rendered slot the app never re-renders away survives,
  // and it sits in the top toolbar instead of floating over the bottom-right UI.
  const slot = document.getElementById("webmcp-status-slot");
  if (slot) {
    el.style.cssText = base.join(";");
    slot.appendChild(el);
    return el;
  }

  // Fallback (SPA/toolbar not mounted — the badge's original reason to exist):
  // pin to the TOP-right so it does not cover the bottom-right controls.
  el.style.cssText = [
    ...base,
    "position:fixed",
    "top:10px",
    "right:16px",
    "z-index:2147483000",
    "box-shadow:0 2px 10px rgba(0,0,0,.18)",
    "pointer-events:none",
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
