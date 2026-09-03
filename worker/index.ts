/**
 * Cloudflare Worker front door for the SciStudio WebMCP demo.
 *
 * Two jobs, in this order:
 *
 *  1. Admission. The demo runs agent-authored code, so the password is checked
 *     HERE, at the edge, before any container exists. An unauthenticated
 *     request is answered with a login page and never starts compute — the URL
 *     cannot be used to spin up containers, which is the difference between a
 *     bounded demo and an open crypto-miner.
 *
 *  2. Isolation. Each authenticated browser session is pinned to its own
 *     container by a session id in a cookie. Because SciStudio is a
 *     single-tenant runtime (one active project, one MCP context), giving each
 *     visitor a private container is what makes the single-tenant assumption
 *     hold on a multi-user URL — with no change to SciStudio itself.
 *
 * The container trusts this boundary (SCISTUDIO_DEMO_TRUST_UPSTREAM=1) and runs
 * no password of its own, so the user is asked once. Containers have no public
 * address; they are reachable only through this Worker.
 */

import { Container, getContainer } from "@cloudflare/containers";

export class SciStudioContainer extends Container<Env> {
  // The port SciStudio listens on inside the image (see Dockerfile CMD).
  defaultPort = 8000;
  // Reclaim an idle session's container quickly. A short window matters because
  // an open SciStudio tab holds a /ws connection that renews activity, so a
  // walked-away tab keeps billing until the window of true silence elapses;
  // 5m bounds how long that can run.
  sleepAfter = "5m";
  // Outbound is open so the agent can pull from the scientific data APIs the
  // demo chains with (UniProt, Ensembl, RCSB, AlphaFold, Open Targets, …), all
  // of which are HTTPS. A hostname allowlist would need TLS interception, which
  // re-signs the connection and breaks certificate validation for the Python
  // clients in the image — it would block the very fetches it exists to permit.
  //
  // The residual risk of running agent-authored code with a network is instead
  // held by the other layers: the Worker's password gate limits access to
  // holders of the code, each session is its own container so one visitor's
  // code cannot touch another's, the container carries no credentials in its
  // environment, Cloudflare exposes no cloud-metadata endpoint to steal from,
  // and the container is disposable. See DEPLOY.md.
  enableInternet = true;
  envVars = {
    SCISTUDIO_PUBLIC_DEMO: "1",
    SCISTUDIO_DEMO_TRUST_UPSTREAM: "1",
    SCISTUDIO_DEMO_PROJECT: "/data/demo",
  };
}

interface Env {
  SCISTUDIO: DurableObjectNamespace<SciStudioContainer>;
  DEMO_PASSWORD: string;
}

const SESSION_COOKIE = "scistudio_sid";
const AUTH_COOKIE = "scistudio_auth";
const LOGIN_PATH = "/_demo/login";
const STARTING_PATH = "/_demo/starting";

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

/** Proof-of-password cookie value: a hash of the password, so it reveals nothing. */
async function authToken(password: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string compare, so a wrong cookie leaks no timing signal. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function loginPage(error = ""): Response {
  const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SciStudio</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    background:#0f1115; color:#e8eaed; }
  .card { width:min(92vw,380px); }
  h1 { font-size:1.35rem; margin:0 0 .35rem; letter-spacing:-.01em; }
  p { margin:0 0 1.5rem; color:#9aa0a6; font-size:.9rem; }
  form { display:flex; gap:.5rem; }
  input { flex:1; padding:.6rem .75rem; border-radius:8px; font:inherit;
    border:1px solid #2c3038; background:#171a1f; color:inherit; }
  input:focus { outline:2px solid #4c8dff; outline-offset:-1px; border-color:transparent; }
  button { padding:.6rem 1rem; border-radius:8px; border:0; font:inherit; font-weight:500;
    background:#4c8dff; color:#0f1115; cursor:pointer; }
  .err { color:#ff7b72; font-size:.85rem; margin-top:.85rem; min-height:1.2em; }
</style>
<div class="card">
  <h1>SciStudio</h1>
  <p>Scientific data workbench with your AI partner.</p>
  <form method="post" action="${LOGIN_PATH}">
    <input type="password" name="password" placeholder="Access code" autofocus
           autocomplete="current-password" aria-label="Access code">
    <button type="submit">Enter</button>
  </form>
  <div class="err">${error}</div>
</div>`;
  return new Response(html, {
    status: error ? 401 : 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}

/**
 * Interstitial shown right after login while the session's container cold-starts.
 *
 * Served by the Worker itself, so it appears instantly without waiting on a
 * container. It then polls /api/version — the first such request is what
 * triggers and waits out the cold start — and navigates into the app once the
 * container answers. Without this the browser sits on a blank page for the few
 * seconds a first request is held open, which reads as a hang.
 */
function startingPage(): Response {
  const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Starting SciStudio…</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    background:#0f1115; color:#e8eaed; }
  .wrap { text-align:center; padding:2rem; }
  .orbit { width:64px; height:64px; margin:0 auto 1.6rem; position:relative; }
  .orbit span { position:absolute; inset:0; border-radius:50%;
    border:2px solid transparent; border-top-color:#4c8dff; animation:spin 1s linear infinite; }
  .orbit span:nth-child(2) { inset:9px; border-top-color:#7fb0ff; animation-duration:1.5s; opacity:.7; }
  .orbit span:nth-child(3) { inset:18px; border-top-color:#a9caff; animation-duration:2s; opacity:.5; }
  @keyframes spin { to { transform:rotate(360deg); } }
  h1 { font-size:1.05rem; font-weight:600; margin:0 0 .4rem; letter-spacing:-.01em; }
  p { margin:0; color:#9aa0a6; font-size:.85rem; }
  .dots::after { content:''; animation:dots 1.4s steps(4,end) infinite; }
  @keyframes dots { 0%{content:''} 25%{content:'·'} 50%{content:'· ·'} 75%{content:'· · ·'} }
</style>
<div class="wrap">
  <div class="orbit"><span></span><span></span><span></span></div>
  <h1>Starting your private SciStudio session<span class="dots"></span></h1>
  <p id="msg">Provisioning an isolated runtime — the first load can take up to a minute.</p>
</div>
<script>
  // Enter the app only when the container actually answers with a real 200.
  // During the cold start the edge returns 500s (the container's port is not
  // up yet), so anything that is not an ok JSON response means "keep waiting".
  // Never navigate to / on a timeout — that would just drop the user onto the
  // same 500. Instead keep polling and, past a minute, reassure.
  const started = Date.now();
  const msg = document.getElementById('msg');
  async function poll() {
    try {
      const r = await fetch('/api/version', { credentials: 'same-origin', cache: 'no-store' });
      if (r.ok) { location.replace('/'); return; }
    } catch (_) { /* container not up yet */ }
    const elapsed = Date.now() - started;
    if (elapsed > 60000) {
      msg.textContent = 'Still starting — a fresh runtime is booting the scientific stack. Hang tight.';
    }
    setTimeout(poll, 1500);
  }
  poll();
</script>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const expected = await authToken(env.DEMO_PASSWORD);

    // The login exchange is handled at the edge — a correct password mints the
    // auth cookie and a fresh session id, then redirects into a private
    // container. Neither branch touches a container.
    if (url.pathname === LOGIN_PATH && request.method === "POST") {
      const form = await request.formData();
      const submitted = String(form.get("password") ?? "");
      if (!timingSafeEqual(submitted, env.DEMO_PASSWORD)) {
        return loginPage("Incorrect access code.");
      }
      const sid = crypto.randomUUID();
      return new Response(null, {
        status: 303,
        headers: [
          // Land on the loading interstitial, not the app: the app's first
          // request cold-starts the container, and the interstitial gives that
          // wait a face instead of a blank page.
          ["location", STARTING_PATH],
          ["set-cookie", cookie(AUTH_COOKIE, expected, 86400)],
          ["set-cookie", cookie(SESSION_COOKIE, sid, 86400)],
        ],
      });
    }

    // Everything else requires the auth cookie. Without it: the login page, and
    // crucially, no container.
    const presented = readCookie(request, AUTH_COOKIE);
    if (!presented || !timingSafeEqual(presented, expected)) {
      return loginPage();
    }

    // The loading interstitial is served by the Worker, never the container —
    // that is the whole point, it must appear before the container is up.
    if (url.pathname === STARTING_PATH) {
      return startingPage();
    }

    // Authenticated. Pin to this session's container, minting a session id if
    // the cookie was lost (e.g. after the auth cookie outlived the session one).
    let sid = readCookie(request, SESSION_COOKIE);
    let setSid: string | null = null;
    if (!sid) {
      sid = crypto.randomUUID();
      setSid = cookie(SESSION_COOKIE, sid, 86400);
    }

    const container = getContainer(env.SCISTUDIO, sid);
    const response = await container.fetch(request);

    if (setSid) {
      const headers = new Headers(response.headers);
      headers.append("set-cookie", setSid);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  },
};
