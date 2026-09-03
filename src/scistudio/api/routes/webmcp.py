"""HTTP bridge that puts SciStudio's MCP tools behind ``document.modelContext``.

The Python MCP server is unchanged and keeps serving local agents over its
socket. WebMCP tools live in the browser, so the SPA needs the same catalogue
over HTTP: this router lists the tools and forwards calls to the same FastMCP
instance the socket transport uses. One tool definition, two front doors.

``get_started`` is synthesised here rather than added to the MCP server. It
answers "what is this site" for an agent that arrived with no idea what
SciStudio is — a question a local agent never has to ask, because its harness
was configured for this project on purpose. It stays short and routes onward to
``get_doc``, so the agent pulls the contract pages it actually needs instead of
carrying 500 lines of reference into every conversation.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/webmcp", tags=["webmcp"])

GET_STARTED = "get_started"

_GET_STARTED_TEXT = """\
# SciStudio

An AI-native workflow runtime for multimodal scientific data. A workflow is a
typed directed graph: **blocks** declare input and output **ports** with
declared data types, and the runtime refuses to connect ports whose types do
not agree. Every run persists its outputs as **artifacts** with **lineage**, so
any result can be traced back to the exact graph and inputs that produced it.

## What you can do here

You are talking to a live SciStudio instance, not a description of one.

- **Read** the current graph, block configs, run status, produced data and its
  lineage.
- **Edit** the graph — add blocks, wire ports, change configuration.
- **Author** new blocks. `scaffold_block` writes a real Python block into the
  project; `run_block_tests` executes it. This is the part that matters: when
  no existing block does what the scientist asked, write one.
- **Run** workflows and individual blocks, then inspect what came out.
- **Plot** results through the plot contract.

The user sees every change in the SciStudio UI as you make it, and can edit
alongside you. Prefer small, visible steps over one large silent one.

## Before you author anything

Block and plot code must satisfy a contract. Do not guess it — read it. The
pages live in this project's `docs/`:

- `get_doc(path="block-contract.md")` — before writing a block class
- `get_doc(path="data-types.md")` — before constructing or reading a DataObject
- `get_doc(path="workflow-schema.md")` — before editing workflow YAML
- `get_doc(path="plot-contract.md")` — before writing a plot
- `get_doc(path="public-api.md")` — the public/private import boundary
- `search_docs(query="...")` — when you do not know which page answers a question

## Suggested first move

Call `get_active_workflow_context` to see the project, the open workflow and
what state it is in. Then `list_blocks` to see what capability already exists
before you consider authoring more.
"""


class ToolCallRequest(BaseModel):
    """One WebMCP tool invocation forwarded from the browser."""

    name: str = Field(..., description="Tool name as listed by GET /api/webmcp/tools")
    arguments: dict[str, Any] = Field(default_factory=dict)


def _get_started_spec() -> dict[str, Any]:
    return {
        "name": GET_STARTED,
        "description": (
            "Read this first. Explains what SciStudio is, what you can do with the "
            "other tools, and which contract page to read before authoring blocks, "
            "plots or workflow YAML."
        ),
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "category": "orientation",
        "mutation": "read",
    }


@router.get("/tools")
async def list_webmcp_tools() -> dict[str, Any]:
    """Return the tool catalogue the SPA registers with ``registerTool()``."""
    from scistudio.ai.agent.mcp.server import mcp

    tools: list[dict[str, Any]] = [_get_started_spec()]
    for entry in await mcp.list_tools():
        tags = set(entry.tags or set())
        tools.append(
            {
                "name": entry.name,
                "description": entry.description or "",
                "inputSchema": entry.parameters,
                # Carried through so the SPA can group tools and so a caller can
                # tell a read from a write without parsing the description.
                "category": next(
                    (t.split(":", 1)[1] for t in tags if t.startswith("category:")),
                    "uncategorised",
                ),
                "mutation": "write" if "write" in tags else "read",
            }
        )
    return {"tools": tools}


@router.post("/call")
async def call_webmcp_tool(request: ToolCallRequest) -> dict[str, Any]:
    """Execute one tool and return an MCP-shaped ``content`` payload."""
    from scistudio.ai.agent.mcp.server import _serialise_result, mcp

    if request.name == GET_STARTED:
        return {"content": [{"type": "text", "text": _GET_STARTED_TEXT}]}

    known = {t.name for t in await mcp.list_tools()}
    if request.name not in known:
        raise HTTPException(status_code=404, detail=f"unknown tool '{request.name}'")

    try:
        result = await mcp.call_tool(request.name, request.arguments)
    except Exception as exc:
        # Surfaced to the agent as text rather than as a 500: a failed tool call
        # is information it can act on (fix the arguments, read the contract),
        # and an HTTP error would reach it as a dead end.
        logger.warning("webmcp tool %s failed: %s: %s", request.name, type(exc).__name__, exc)
        return {
            "content": [{"type": "text", "text": f"{type(exc).__name__}: {exc}"}],
            "isError": True,
        }

    import json

    return {"content": [{"type": "text", "text": json.dumps(_serialise_result(result), default=str)}]}
