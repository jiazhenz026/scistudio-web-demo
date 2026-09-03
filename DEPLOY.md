# Deploying the SciStudio WebMCP demo

Two deployment shapes are supported. The Cloudflare one is the intended target
for the WebMCP demo because it gives each visitor an isolated runtime; the
Render one is a simpler single-container fallback.

## Cloudflare Worker + Containers (one container per session)

Each authenticated browser session gets its own container. An unauthenticated
request never starts one. Containers run with outbound network disabled.

### Prerequisites

- A Cloudflare account on the **Workers Paid** plan ($5/mo — Containers require
  it).
- **Docker running locally.** `wrangler deploy` builds the image and pushes it;
  the image must be `linux/amd64`, so on an Apple Silicon Mac the build runs
  under emulation (slower, but works).
- `scistudio.io` (or a subdomain) on Cloudflare, for the custom route.

### Deploy

```bash
# from the repo root
npm install

# the shared access code handed to the judges — a Worker secret, never in git
npx wrangler secret put DEMO_PASSWORD

# builds the Dockerfile, pushes the image, provisions the Durable Object +
# container. First deploy takes several minutes; wait before the first request.
npx wrangler deploy
```

Then, in the Cloudflare dashboard, add a custom domain/route pointing your
hostname (e.g. `demo.scistudio.io`) at the `scistudio-web` Worker.

### Verify after deploy

1. Open the URL — you should get the login page, and **no** container should
   start (check the Workers logs / container metrics).
2. Enter the access code — you land in SciStudio with the demo project open.
3. The corner badge reads `WebMCP · N tools`.
4. **Confirm outbound is closed** — in the app, have the agent run a CodeBlock
   that attempts `urllib.request.urlopen("http://169.254.169.254/")`; it must
   fail. This is the one check worth doing by hand, because it is the finding
   that would change the security posture if it were wrong.

### Knobs (`wrangler.jsonc`)

- `max_instances` — concurrent sessions. Raise for more simultaneous judges.
- `instance_type` — `standard-1` (4 GiB) by default; `basic` (1 GiB) is cheaper
  if the demo workloads stay small.
- `sleepAfter` (in `worker/index.ts`) — idle time before a session's container
  is reclaimed.

## Render (single container, in-app password)

A single shared container. Simpler, but every visitor drives the same runtime —
fine for a solo walkthrough, not for concurrent users.

Connect the repo as a Render **Blueprint** (`render.yaml` builds the same
Dockerfile) and set `SCISTUDIO_DEMO_PASSWORD` in the dashboard. Here the app
gates itself with the in-app password middleware, since there is no Worker in
front.

## The security model, in one place

The demo runs agent-authored code by design — that is what it exists to show.
The exposure is contained, not removed:

- **Admission** — a shared password. On Cloudflare it is checked at the Worker
  before any container starts; on Render it is the in-app gate.
- **Isolation** — on Cloudflare, one container per session; a visitor's code
  cannot touch another's.
- **No egress** — `enableInternet=false` closes outbound network, so a container
  cannot reach cloud metadata, be used as a jump host, or exfiltrate.
- **No secrets** — the container's environment holds nothing of value; the only
  secret is the low-value demo password, and on Cloudflare it lives in the
  Worker, not the container.
- **Non-root, disposable** — the container runs as a non-root user with the
  source tree deleted after install and only the demo project writable; a
  restart resets it.
- **Withheld routers** — the interactive PTY, the package installer, and git
  operations are removed (`src/scistudio/public_demo.py`); the demo uses none.
