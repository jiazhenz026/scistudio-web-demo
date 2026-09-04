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
  // Reclaim a session's container after 30m of true inactivity. An open tab's
  // /ws traffic renews this, so a workflow that runs while the user watches
  // keeps the container warm; the window is generous so a long run the user
  // stepped away from is not reclaimed mid-flight. Cost stays bounded by
  // max_instances, and access is password-gated to judges.
  sleepAfter = "30m";
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
// Mints a fresh session id and bounces back through the interstitial. The
// escape hatch for a wedged container: the interstitial navigates here after a
// long unsuccessful wait, and a fresh sid means a fresh container — the same
// recovery a visitor used to get only by clearing site data by hand.
const RESET_PATH = "/_demo/reset";

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
 * A cookie with no Max-Age — the browser drops it when the session ends (all
 * windows closed). The session id is stored this way on purpose: a reopened
 * browser then starts a fresh container instead of returning to a possibly-cold
 * or wedged one, and because the auth cookie persists, the visitor is not asked
 * for the access code again. Within a live session the sid still sticks, so an
 * open tab keeps its container.
 */
function sessionCookie(name: string, value: string): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Secure`;
}

/** Whether this is a top-level document navigation (an address-bar / reload / link
 *  load), as opposed to an XHR/fetch/asset request the SPA fires. Document loads
 *  must never be held open through a cold start — that is the spinner-hang. */
function isDocumentNavigation(request: Request): boolean {
  if (request.method !== "GET") return false;
  if (request.headers.get("sec-fetch-dest") === "document") return true;
  return (request.headers.get("accept") ?? "").includes("text/html");
}

/**
 * Proxy a request to the session's container, tolerating a stopped container.
 *
 * A container stops on idle (sleepAfter), when Cloudflare reclaims it, or if the
 * process inside crashes. The next request should cold-start it, but the raw
 * container.fetch() can throw "the container is not running" — especially when
 * the SPA fires a burst of requests into a cold container at once. An uncaught
 * throw here becomes a 500 in the browser. So: on that error, explicitly start
 * the container, wait for its port, and retry a few times with backoff.
 */
// A stopped instance surfaces two different ways, and both must self-heal:
//   1. container.fetch() THROWS "the container is not running…".
//   2. Cloudflare RETURNS (does not throw) a 5xx whose body is
//      "Error proxying request to container: The container is not running,
//      consider calling start()". This one bypassed the catch entirely and
//      leaked to the client — notably the ChatGPT WebMCP session, whose
//      per-session container instance had been reclaimed while a browser tab
//      on a different session stayed healthy.
const COLD_CONTAINER = /not running|consider calling start|is not ready|starting|error proxying/i;

async function fetchContainer(
  container: DurableObjectStub<SciStudioContainer>,
  request: Request,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await container.fetch(request.clone());
      // Case 2: a returned 5xx carrying the proxy/cold-start signature. Peek a
      // clone so the original body stays intact for the non-cold 5xx we pass
      // through untouched (a genuine application 500 must still reach the SPA).
      if (response.status >= 500) {
        const body = await response.clone().text().catch(() => "");
        if (COLD_CONTAINER.test(body)) {
          lastError = body;
          try {
            await container.startAndWaitForPorts();
          } catch {
            // Best-effort; the retry below is what recovers.
          }
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
          continue;
        }
      }
      return response;
    } catch (error) {
      lastError = error;
      // Case 1: a thrown cold-container error. Any other throw is a real fault.
      if (!COLD_CONTAINER.test(String(error))) {
        throw error;
      }
      // Kick a start (idempotent if already starting) and wait before retrying.
      try {
        await container.startAndWaitForPorts();
      } catch {
        // Start is best-effort here; the retry below is what actually recovers.
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  // Out of retries: a readable 503 the SPA can handle, not an opaque 500.
  return new Response(
    JSON.stringify({ detail: "The demo runtime is starting. Please retry in a moment." }),
    { status: 503, headers: { "content-type": "application/json", "retry-after": "5" } },
  );
}

/**
 * One fast attempt that classifies a cold/stopped container instead of holding
 * the connection open through a cold start.
 *
 * Document navigations use this: a cold revisit is answered with the loading
 * interstitial (which gives the wait a face and polls the container up) rather
 * than a spinner on a request held open for the whole ~minute boot. XHR/asset
 * requests keep using the retrying ``fetchContainer`` — the SPA tolerates a
 * brief hold and retries a 503 on its own.
 */
async function fetchContainerOnce(
  container: DurableObjectStub<SciStudioContainer>,
  request: Request,
): Promise<{ response: Response } | { cold: true }> {
  try {
    const response = await container.fetch(request.clone());
    if (response.status >= 500) {
      const body = await response.clone().text().catch(() => "");
      if (COLD_CONTAINER.test(body)) return { cold: true };
    }
    return { response };
  } catch (error) {
    if (COLD_CONTAINER.test(String(error))) return { cold: true };
    throw error;
  }
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
    // Past ~75s the container is not merely cold, it is wedged (a crashed or
    // orphaned instance the sid is pinned to). Rotate to a fresh session once —
    // sessionStorage guards against a reset loop — so the visitor recovers
    // automatically instead of clearing site data by hand.
    if (elapsed > 75000 && !sessionStorage.getItem('scistudio_reset')) {
      try { sessionStorage.setItem('scistudio_reset', '1'); } catch (_) {}
      location.replace('${RESET_PATH}');
      return;
    }
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
          // Session-scoped: a reopened browser starts a fresh container (the
          // auth cookie still spares the visitor the access code). See
          // sessionCookie().
          ["set-cookie", sessionCookie(SESSION_COOKIE, sid)],
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

    // Wedged-session escape hatch: mint a fresh session id (a fresh container)
    // and bounce back through the interstitial. Reached only from the
    // interstitial's own long-wait fallback, so a visitor recovers from a
    // crashed/orphaned container without clearing site data by hand.
    if (url.pathname === RESET_PATH) {
      const fresh = crypto.randomUUID();
      return new Response(null, {
        status: 303,
        headers: [
          ["location", STARTING_PATH],
          ["set-cookie", sessionCookie(SESSION_COOKIE, fresh)],
        ],
      });
    }

    // Authenticated. Pin to this session's container, minting a session id if
    // the cookie was lost (e.g. after the auth cookie outlived the session one).
    let sid = readCookie(request, SESSION_COOKIE);
    let setSid: string | null = null;
    if (!sid) {
      sid = crypto.randomUUID();
      setSid = sessionCookie(SESSION_COOKIE, sid);
    }

    const container = getContainer(env.SCISTUDIO, sid);

    // Document navigations must not be held open through a cold start — that
    // held-open request is the spinner-hang a returning visitor sees. Try once:
    // if the container is warm, serve it; if it is cold or stopped, send the
    // loading interstitial, which starts it with a face on the wait and, if it
    // never comes up, rotates to a fresh session. XHR/asset requests keep the
    // retrying path below (the SPA tolerates a brief hold and retries a 503).
    if (isDocumentNavigation(request)) {
      const once = await fetchContainerOnce(container, request);
      if ("cold" in once) {
        const headers: [string, string][] = [["location", STARTING_PATH]];
        if (setSid) headers.push(["set-cookie", setSid]);
        return new Response(null, { status: 303, headers });
      }
      if (setSid) {
        const headers = new Headers(once.response.headers);
        headers.append("set-cookie", setSid);
        return new Response(once.response.body, {
          status: once.response.status,
          statusText: once.response.statusText,
          headers,
        });
      }
      return once.response;
    }

    const response = await fetchContainer(container, request);

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
