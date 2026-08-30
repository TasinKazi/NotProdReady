"""NotProdReady — FastAPI application entry point."""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.analyses import router as analyses_router
from app.api.remediation import router as remediation_router

# ── Local environment file ────────────────────────────────────────────────────
# Load backend/.env.local when present (local development only).
# override=False: values already set in the OS environment always win,
# so production deployments that supply env vars directly are unaffected.
_ENV_LOCAL = Path(__file__).resolve().parent.parent / ".env.local"
try:
    from dotenv import load_dotenv as _load_dotenv
    _load_dotenv(dotenv_path=_ENV_LOCAL, override=False)
except ImportError:
    pass  # python-dotenv not installed — fine in production if vars are set directly.

app = FastAPI(
    title="NotProdReady API",
    description="NorthRiver Bank release readiness analysis backend.",
    version="0.1.0",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# Allow the Vite dev server (and any configured origin) during local development.
_CORS_ORIGINS = os.environ.get(
    "NOTPRODREADY_CORS_ORIGINS",
    ",".join([
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:4173",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:5175",
    ]),
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _CORS_ORIGINS],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ────────────────────────────────────────────────────────────────────


@app.get("/health", tags=["health"])
async def health() -> dict:
    return {"status": "ok"}


# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(analyses_router)
app.include_router(remediation_router)

# ── Bob integration status ────────────────────────────────────────────────────
# Printed once at import time (i.e. when uvicorn loads the app module).
# Never prints the key value — only SET / not configured.
_bob_mode = os.environ.get("NOTPRODREADY_BOB_MODE", "mock").lower()
if os.environ.get("BOB_API_KEY") and _bob_mode == "shell":
    print("Bob integration: configured")
else:
    print("Bob integration: not configured")
