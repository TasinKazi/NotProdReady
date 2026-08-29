"""NotProdReady — development server entry point.

Usage
-----
    python backend/run_server.py

Windows note
------------
asyncio.create_subprocess_exec (used by BobShellRunner) requires the
ProactorEventLoop on Windows (Python 3.8+).  SelectorEventLoop — the
default on Windows — does not support subprocess pipes and raises
NotImplementedError at runtime.

This script switches to ProactorEventLoop before Uvicorn starts so that
BobShellRunner works correctly on Windows without any environment changes.
On Linux / macOS the call is a no-op.
"""
from __future__ import annotations

import asyncio
import sys


def _apply_windows_event_loop_policy() -> None:
    """Install ProactorEventLoop on Windows so subprocess pipes work."""
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())


if __name__ == "__main__":
    _apply_windows_event_loop_policy()

    import os
    import uvicorn

    # reload=True spawns a reloader subprocess whose worker process does NOT
    # inherit the ProactorEventLoop policy set above.  On Windows this causes
    # asyncio.create_subprocess_exec to raise NotImplementedError inside the
    # reloader worker, breaking BobShellRunner in shell mode.
    #
    # Safe default: reload only when NOT in shell mode.
    # For shell-mode development, run with:
    #   NOTPRODREADY_BOB_MODE=shell python backend/run_server.py
    # and live-reload is intentionally disabled so the subprocess policy holds.
    shell_mode = os.environ.get("NOTPRODREADY_BOB_MODE", "mock").lower() == "shell"
    use_reload = not shell_mode

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=use_reload,
        reload_dirs=["app"] if use_reload else None,
    )
