"""Shared-password gate for the public WebMCP demo.

The demo keeps SciStudio's runtime intact — an agent can author a block and run
it — so the front door is the whole access control story. See
:mod:`scistudio.public_demo` for why the trade is drawn that way.

Implemented as pure ASGI rather than a Starlette ``BaseHTTPMiddleware`` because
the runtime's realtime channel is a WebSocket at ``/ws``. HTTP middleware never
sees a WebSocket scope, so a gate written that way would leave the live event
stream wide open while the REST surface looked protected.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from urllib.parse import parse_qs

logger = logging.getLogger(__name__)

COOKIE_NAME = "scistudio_demo"

# Paths served without the cookie. Kept to the health check the host polls and
# the login exchange itself — everything else, including the SPA shell, is
# behind the password.
_OPEN_PATHS = frozenset({"/api/version", "/version", "/_demo/login"})

_LOGIN_HTML = """<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SciStudio</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #0f1115; color: #e8eaed;
  }}
  .card {{ width: min(92vw, 380px); }}
  h1 {{ font-size: 1.35rem; margin: 0 0 .35rem; letter-spacing: -.01em; }}
  p {{ margin: 0 0 1.5rem; color: #9aa0a6; font-size: .9rem; }}
  form {{ display: flex; gap: .5rem; }}
  input {{
    flex: 1; padding: .6rem .75rem; border-radius: 8px; font: inherit;
    border: 1px solid #2c3038; background: #171a1f; color: inherit;
  }}
  input:focus {{ outline: 2px solid #4c8dff; outline-offset: -1px; border-color: transparent; }}
  button {{
    padding: .6rem 1rem; border-radius: 8px; border: 0; font: inherit; font-weight: 500;
    background: #4c8dff; color: #0f1115; cursor: pointer;
  }}
  .err {{ color: #ff7b72; font-size: .85rem; margin-top: .85rem; min-height: 1.2em; }}
</style>
<div class="card">
  <h1>SciStudio</h1>
  <p>AI-native workflow runtime for multimodal scientific data.</p>
  <form method="post" action="/_demo/login">
    <input type="password" name="password" placeholder="Access code" autofocus
           autocomplete="current-password" aria-label="Access code">
    <button type="submit">Enter</button>
  </form>
  <div class="err">{error}</div>
</div>
"""


def _expected_cookie(password: str) -> str:
    """Return the cookie value proving knowledge of *password*."""
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def _cookie_value(headers: list[tuple[bytes, bytes]], name: str) -> str | None:
    for key, value in headers:
        if key.lower() != b"cookie":
            continue
        for part in value.decode("latin-1").split(";"):
            k, _, v = part.strip().partition("=")
            if k == name:
                return v
    return None


class DemoAuthMiddleware:
    """Refuse every HTTP and WebSocket request that lacks the demo cookie."""

    def __init__(self, app: object, password: str) -> None:
        self.app = app
        self.password = password
        self.expected = _expected_cookie(password)

    async def __call__(self, scope: dict, receive: object, send: object) -> None:
        if scope.get("type") not in {"http", "websocket"}:
            await self.app(scope, receive, send)  # type: ignore[operator]
            return

        path = scope.get("path", "")
        headers = scope.get("headers") or []

        if scope["type"] == "http" and scope.get("method") == "POST" and path == "/_demo/login":
            await self._login(scope, receive, send)
            return

        if path in _OPEN_PATHS:
            await self.app(scope, receive, send)  # type: ignore[operator]
            return

        presented = _cookie_value(headers, COOKIE_NAME)
        if presented is not None and hmac.compare_digest(presented, self.expected):
            await self.app(scope, receive, send)  # type: ignore[operator]
            return

        if scope["type"] == "websocket":
            # 1008 = policy violation. Sending close before accept keeps the
            # handshake from completing at all.
            await send({"type": "websocket.close", "code": 1008})  # type: ignore[operator]
            return

        # An unauthenticated API call gets 401 JSON, never the login page. A
        # WebMCP tool's execute() fetches these endpoints, and handing it a
        # 200 with an HTML body would surface as an opaque parse failure
        # instead of "your session expired".
        if path.startswith("/api/"):
            await self._send_json_401(send)
            return

        await self._send_login_page(scope, send, error="")

    async def _login(self, scope: dict, receive: object, send: object) -> None:
        body = b""
        while True:
            message = await receive()  # type: ignore[operator]
            body += message.get("body", b"")
            if not message.get("more_body"):
                break

        submitted = parse_qs(body.decode("utf-8", "replace")).get("password", [""])[0]
        if not hmac.compare_digest(submitted, self.password):
            client = scope.get("client")
            logger.warning("demo login refused from %s", client[0] if client else "unknown")
            await self._send_login_page(scope, send, error="Incorrect access code.", status=401)
            return

        secure = "; Secure" if scope.get("scheme") in {"https", "wss"} else ""
        await send(  # type: ignore[operator]
            {
                "type": "http.response.start",
                "status": 303,
                "headers": [
                    (b"location", b"/"),
                    (
                        b"set-cookie",
                        f"{COOKIE_NAME}={self.expected}; Path=/; HttpOnly; SameSite=Lax{secure}; Max-Age=86400".encode(),
                    ),
                ],
            }
        )
        await send({"type": "http.response.body", "body": b""})  # type: ignore[operator]

    async def _send_json_401(self, send: object) -> None:
        body = b'{"detail":"Not authenticated. Reload the page and enter the access code."}'
        await send(  # type: ignore[operator]
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    (b"cache-control", b"no-store"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})  # type: ignore[operator]

    async def _send_login_page(self, scope: dict, send: object, error: str, status: int = 200) -> None:
        html = _LOGIN_HTML.format(error=error).encode("utf-8")
        await send(  # type: ignore[operator]
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"text/html; charset=utf-8"),
                    (b"content-length", str(len(html)).encode()),
                    (b"cache-control", b"no-store"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": html})  # type: ignore[operator]
