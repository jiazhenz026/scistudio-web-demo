"""Public-demo hardening switch for the internet-facing WebMCP deployment.

SciStudio is built as a local-first desktop runtime: it executes user Python,
spawns external applications, opens a PTY, installs packages, and treats the
project directory as trusted input.  Every one of those is correct on a
scientist's laptop and catastrophic on a public URL.

This module is the single place that decides whether the process is running as
the public WebMCP demo.  When :func:`is_public_demo` is true the app factory,
the block scanner, and the route guards below refuse the capabilities that
would hand a visitor arbitrary code execution.

The switch is deliberately fail-closed in one direction only: an operator must
opt *in* to the hardened mode, because the desktop app and the test suite both
need the full runtime.  The deployment sets ``SCISTUDIO_PUBLIC_DEMO=1``.

Threat model
------------

The chain that matters most is not any single endpoint, it is the composition:

1. ``PUT /api/projects/{id}/file`` writes a ``.py`` into the project.
2. Tier-1 drop-in scanning imports every ``.py`` under the project as a
   module, in the server process.
3. ``POST /api/blocks/reload`` triggers that scan on demand.

Any one of those is reasonable for a trusted local project.  Together they are
a remote code execution primitive, so the hardened mode breaks all three links
rather than relying on a single choke point.
"""

from __future__ import annotations

import os

PUBLIC_DEMO_ENV = "SCISTUDIO_PUBLIC_DEMO"
"""Environment variable that opts the process into hardened public-demo mode."""

DEMO_PROJECT_ENV = "SCISTUDIO_DEMO_PROJECT"
"""Absolute path of the single project the public demo is allowed to serve."""


def is_public_demo() -> bool:
    """Return whether this process runs as the hardened public WebMCP demo."""
    return os.environ.get(PUBLIC_DEMO_ENV, "").strip().lower() in {"1", "true", "yes", "on"}


# Routers withheld from the public demo, with the reason each one is unsafe on
# an internet-facing origin.  Keyed by the attribute name used in the app
# factory so the two lists cannot drift apart silently.
BLOCKED_ROUTERS: dict[str, str] = {
    "ai_pty": "WebSocket PTY — a shell on the host, reachable by any visitor.",
    "packages": "POST /local installs a package into the running interpreter.",
    "filesystem": "Browses, stats and reveals arbitrary host paths.",
    "git_routes": "commit/merge/cherry-pick mutate the deployment's working tree.",
    "work_import": "Spawns an agent session against host state.",
    "lint": "Runs ruff as a subprocess on caller-supplied source.",
    "ai": "Holds provider credentials and bills outbound model calls.",
    "user_library": "Writes outside every project root, into user-scoped dirs.",
}

# Block types withheld from the palette and the registry.  These are the
# execution primitives; without them the remaining blocks only move typed data
# between vetted, in-process implementations.
BLOCKED_BLOCK_CLASSES: frozenset[str] = frozenset(
    {
        "CodeBlock",  # arbitrary Python / R / shell / MATLAB / notebook execution
        "AppBlock",  # spawns and supervises external processes
        "AIBlock",  # outbound provider calls on the deployment's credentials
    }
)


# Write endpoints refused in the public demo, as (method, path prefix) pairs.
#
# ``PUT /api/projects/{id}/file`` is the write half of the RCE chain described
# in the module docstring; ``POST /api/blocks/reload`` is its trigger. The
# project create/update/delete verbs go with them because the demo serves one
# fixed project and a visitor has no business replacing it.
#
# Matching is by method plus path prefix rather than by route name so a new
# endpoint added under one of these prefixes is refused by default instead of
# being exposed until someone remembers to list it.
BLOCKED_WRITE_ROUTES: tuple[tuple[str, str], ...] = (
    ("POST", "/api/projects"),
    ("PUT", "/api/projects"),
    ("PATCH", "/api/projects"),
    ("DELETE", "/api/projects"),
    ("POST", "/api/blocks/reload"),
)


def is_blocked_write(method: str, path: str) -> bool:
    """Return whether *method* + *path* is refused in public-demo mode."""
    method = method.upper()
    return any(method == m and path.startswith(prefix) for m, prefix in BLOCKED_WRITE_ROUTES)
