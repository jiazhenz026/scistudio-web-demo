# SciStudio public WebMCP demo image.
#
# Two things make this image different from a local SciStudio install:
#   - SCISTUDIO_PUBLIC_DEMO=1 withholds the execution primitives. See
#     src/scistudio/public_demo.py for what that covers and why.
#   - Nothing in the image is writable by the runtime user except the demo
#     project, so a bug that escapes the application-level refusals still has
#     nowhere to persist anything.

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
RUN pip install --no-cache-dir . \
 && rm -rf /src

# The demo project is the only writable path. Runs materialise artifacts here.
RUN useradd --create-home --uid 10001 scistudio \
 && mkdir -p /data/demo \
 && chown -R scistudio:scistudio /data
USER scistudio
WORKDIR /data

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,os;urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8000')+'/api/version').read()"

# PORT is supplied by the host (Cloudflare Containers, Render, Fly all set it).
CMD ["sh", "-c", "exec scistudio serve --host 0.0.0.0 --port ${PORT:-8000}"]
