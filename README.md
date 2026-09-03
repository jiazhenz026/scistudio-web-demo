<div align="center">

# SciStudio-web

**An interactive workflow orchestration system for multimodal scientific data analysis — reachable directly from an AI agent's browser through [WebMCP](https://github.com/webmachinelearning/webmcp).**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-green.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-blue.svg)](https://www.python.org/downloads/)
[![WebMCP](https://img.shields.io/badge/WebMCP-document.modelContext-8A2BE2.svg)](https://github.com/webmachinelearning/webmcp)

</div>

---

## What this is

SciStudio-web is an interactive workflow orchestration system for multimodal
scientific data analysis. It starts from spatial multi-omics and is
progressively expanding to other data modalities.

A workflow is a typed directed graph: **blocks** declare input and output
**ports** with declared data types, the runtime refuses to connect ports whose
types disagree, and every run persists its outputs as **artifacts** with
**lineage** — so any result traces back to the exact graph and inputs that
produced it.

What is different here is **who drives it**. This deployment registers
SciStudio's tools with the browser through
[WebMCP](https://github.com/webmachinelearning/webmcp), so an AI agent — ChatGPT
in its built-in browser, or Chrome with the WebMCP origin trial enabled — reads
the current workflow, edits the graph, authors new blocks, runs them, and plots
the results, all against the same runtime a local user drives. The scientist
watches the graph change in the UI as the agent works, and can edit alongside it.

This repository is a WebMCP-focused, hardened redeploy of
[SciStudio](https://github.com/jiazhenz026/SciStudio). It is the entry for the
[WebMCP Challenge](https://webmcp.devpost.com/).

## How the WebMCP integration works

SciStudio already exposes its capabilities as an MCP tool server for local
agents over a socket. A browser agent cannot reach that socket, so this repo
bridges the **same** tool catalogue over HTTP and registers it in the page:

```
ChatGPT / Chrome agent
        │  document.modelContext.registerTool(...)      ← src/scistudio/api/static (the SPA)
        ▼
  GET  /api/webmcp/tools   ─┐
  POST /api/webmcp/call     ├─ src/scistudio/api/routes/webmcp.py
        │                   ┘
        ▼
  the same FastMCP instance the local socket transport serves
        │
        ▼
  SciStudio workflow runtime
```

- **`src/scistudio/api/routes/webmcp.py`** — lists the catalogue and forwards
  each call to the one FastMCP instance. A tool added to the Python server
  appears in the browser with no frontend change, so the two surfaces cannot
  drift.
- **`frontend/src/webmcp/`** — fetches that catalogue and calls
  `registerTool()` for each entry. It probes both `document.modelContext`
  (Chrome 150+, ChatGPT desktop) and `navigator.modelContext` (Chrome 149),
  since both are live in the origin trial. A small on-page badge reports how
  many tools registered, so the integration is verifiable without DevTools.
- **`about_scistudio`** — a synthesised tool that returns the authoritative
  description of the product and routes the agent to the contract pages it must
  read before authoring blocks, plots, or workflow YAML.

## Run it against ChatGPT

1. Open the deployed URL in the **ChatGPT desktop app's built-in browser**
   (site tools are on for GPT-5.6 Sol / Terra), or in **Chrome 149+** with
   `chrome://flags/#enable-webmcp-testing` enabled and the browser relaunched.
2. Enter the access code (this deployment is password-gated — see below).
3. Confirm the badge in the corner reads **`WebMCP · N tools`**.
4. Ask the agent to describe the workflow, add a block, or author a new one.

## Deploy

The image is a two-stage Docker build (SPA under Node, runtime under Python),
served by a container that runs as non-root with the project directory as its
only writable path.

```bash
docker build -t scistudio-web .
docker run -p 8000:8000 \
  -e SCISTUDIO_PUBLIC_DEMO=1 \
  -e SCISTUDIO_DEMO_PASSWORD=your-access-code \
  scistudio-web
```

`render.yaml` is a one-service blueprint for [Render](https://render.com): point
it at this repo and set `SCISTUDIO_DEMO_PASSWORD` in the dashboard.

### Public-deployment hardening

SciStudio is a local-first runtime that executes user code by design — that is
the point of the demo, an agent authoring and running a real analysis block. On
a public URL that capability is contained rather than removed:

- **A password gate** (`src/scistudio/api/demo_auth.py`) — pure ASGI, so it
  covers the `/ws` WebSocket, not only the REST surface. The app refuses to
  start without `SCISTUDIO_DEMO_PASSWORD`, so a misconfigured deploy fails
  closed.
- **The container is the boundary** — non-root, the installed wheel with its
  source tree deleted, and an environment holding no credentials beyond the
  low-value demo password.
- **Three routers withheld** (`src/scistudio/public_demo.py`) — an interactive
  PTY, the package installer, and git operations, none of which the demo uses.

Everything the demo actually exercises — writing blocks, running workflows,
executing agent-authored code — stays live behind the password.

## License

Apache License 2.0. See [LICENSE](LICENSE). SciStudio-web is a redeploy of
[SciStudio](https://github.com/jiazhenz026/SciStudio).
