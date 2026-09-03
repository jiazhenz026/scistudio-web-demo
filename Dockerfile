# SciStudio public WebMCP demo image.
#
# The runtime is intact on purpose: the demo exists to show an agent authoring
# and running real analysis code, so CodeBlock, drop-in scanning and the
# scaffold tools all stay live. Access control is the password gate in
# src/scistudio/api/demo_auth.py, and the container is what contains the code
# the demo is meant to run:
#   - non-root, so only /data and /tmp are writable;
#   - the source tree is deleted after install, so there is nothing to patch;
#   - no credentials in the image. SCISTUDIO_DEMO_PASSWORD is injected by the
#     host at runtime and is the only secret, deliberately low-value.
#
# Outbound network access is the host's to restrict, not this file's. Verify
# the cloud metadata endpoint is unreachable from inside a running container
# before announcing the URL.

# ---------------------------------------------------------------------------
# Stage 1 — build the SPA. Its output lands in src/scistudio/api/static/ in
# stage 2, which pyproject already ships as package data.
# ---------------------------------------------------------------------------
FROM node:22-slim AS frontend

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci --no-audit --no-fund
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# ---------------------------------------------------------------------------
# Stage 2 — the runtime.
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    SCISTUDIO_PUBLIC_DEMO=1 \
    SCISTUDIO_DEMO_PROJECT=/data/demo \
    SCISTUDIO_LOG_LEVEL=INFO

WORKDIR /src
COPY pyproject.toml README.md ./
COPY src/ ./src/
COPY --from=frontend /build/frontend/dist/ ./src/scistudio/api/static/

# Plain install, never editable: an editable install would leave the source
# tree on sys.path and writable-adjacent, which defeats the read-only rootfs.
RUN pip install --no-cache-dir .

# The single project the demo serves, baked into the image so a restart resets
# it. provision.py copies the agent contract pages into its docs/, without
# which get_doc and search_docs answer "no docs/ directory is visible".
COPY demo/ /opt/demo/
RUN scistudio init /data/demo \
 && python /opt/demo/provision.py /data/demo \
 && rm -rf /src

# Non-root: /data is the only writable path. Runs, scaffolded blocks and
# materialised artifacts all land there.
RUN useradd --create-home --uid 10001 scistudio \
 && chown -R scistudio:scistudio /data
USER scistudio
WORKDIR /data

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,os;urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8000')+'/api/version').read()"

# PORT is supplied by the host (Cloudflare Containers, Render, Fly all set it).
CMD ["sh", "-c", "exec scistudio serve --host 0.0.0.0 --port ${PORT:-8000}"]
