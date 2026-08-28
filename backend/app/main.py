"""NotProdReady — FastAPI application entry point."""
from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.analyses import router as analyses_router

app = FastAPI(
    title="NotProdReady API",
    description="NorthRiver Bank release readiness analysis backend.",
    version="0.1.0",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# Allow the Vite dev server (and any configured origin) during local development.
_CORS_ORIGINS = os.environ.get(
    "NOTPRODREADY_CORS_ORIGINS",
    "http://localhost:5173,http://localhost:4173",
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
