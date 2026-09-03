"""Deployment switch for the internet-facing SciStudio WebMCP demo.

The demo exists to show that an agent can author real analysis code inside
SciStudio — write a block, run it, build a workflow — so it deliberately keeps
the runtime intact. CodeBlock, AppBlock, drop-in scanning, project file writes
and the scaffold/test MCP tools all stay live. Removing them would remove the
claim the demo is making.

That means this deployment executes agent-authored code by design. The access
control is therefore a shared password at the front door, not a feature-by-
feature amputation behind it. See :mod:`scistudio.api.demo_auth`.

What the password buys
----------------------

It narrows the audience from "every scanner on the internet" to "whoever was
given the password", which for a hackathon submission is the judges. That is
what makes leaving the runtime intact a defensible trade rather than a reckless
one.

What it does not buy
--------------------

Anyone through the door can execute code in the container. The residual
exposure is handled at the container boundary, not here:

* no credentials anywhere in the environment — an attacker who reads
  ``/proc/self/environ`` finds nothing worth having;
* non-root, read-only root filesystem apart from the demo project;
* resource caps and a periodic reset.

Outbound network access is the part the host does not let us close. Confirm the
cloud metadata endpoint is unreachable from inside the container before the
deployment is announced — that is the one finding that would change this
design.
"""

from __future__ import annotations

import os

PUBLIC_DEMO_ENV = "SCISTUDIO_PUBLIC_DEMO"
"""Environment variable that opts the process into the public demo deployment."""

DEMO_PROJECT_ENV = "SCISTUDIO_DEMO_PROJECT"
"""Absolute path of the single project the public demo serves."""

DEMO_PASSWORD_ENV = "SCISTUDIO_DEMO_PASSWORD"
"""Shared password for the demo. Absent means the demo refuses to serve."""


def is_public_demo() -> bool:
    """Return whether this process runs as the public WebMCP demo."""
    return os.environ.get(PUBLIC_DEMO_ENV, "").strip().lower() in {"1", "true", "yes", "on"}


def demo_password() -> str:
    """Return the configured demo password, or an empty string if unset."""
    return os.environ.get(DEMO_PASSWORD_ENV, "").strip()


# Routers withheld from the demo. The list is short on purpose: each entry is
# something the demo has no use for, so withholding it costs nothing and
# removes a distinct class of trouble. Anything the demo actually exercises
# stays, protected by the password rather than by removal.
BLOCKED_ROUTERS: dict[str, str] = {
    "ai_pty": (
        "A PTY over WebSocket. The demo drives SciStudio through WebMCP tools, "
        "so an interactive shell adds no capability the demo needs and a great "
        "deal it does not."
    ),
    "packages": (
        "Installs packages into the running interpreter. That mutates the "
        "runtime underneath the demo and pulls code from outside the image, "
        "neither of which the demo requires."
    ),
    "git_routes": (
        "Commit/merge/cherry-pick against the deployment's working tree. The "
        "demo project is disposable and reset on restart; version control over "
        "it is meaningless here."
    ),
}
