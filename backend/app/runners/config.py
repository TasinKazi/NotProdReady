"""BobShellRunner configuration — all values read from environment variables.

NOTPRODREADY_BOB_MODE                mock | shell            (default: mock)
NOTPRODREADY_BOB_EXECUTABLE          path to bob binary      (default: bob)
NOTPRODREADY_BOB_MAX_COST            float, Bobcoins         (default: 0.50)
NOTPRODREADY_BOB_MAX_TURNS           int                     (default: 30)
NOTPRODREADY_BOB_TIMEOUT             int, seconds            (default: 300)
NOTPRODREADY_BOB_FINALIZE_MAX_COST   float, Bobcoins         (default: 0.25)
  This is an INCREMENTAL budget added on top of what the primary run already
  spent.  The finalization command receives --max-cost (primary_cost + budget)
  so Bob is not immediately blocked by its own prior spend.
NOTPRODREADY_BOB_FINALIZE_MAX_TURNS  int                     (default: 1)
NOTPRODREADY_BOB_REMEDIATE_MAX_COST  float, Bobcoins         (default: 1.00)
  Incremental budget added to primary session_costs for the remediation turn.
NOTPRODREADY_BOB_REMEDIATE_MAX_TURNS int                     (default: 20)
"""
from __future__ import annotations

import os


class BobShellConfig:
    """Reads Bob Shell runner settings from environment variables.

    Conservative defaults are intentional — do not raise limits without
    explicit configuration.
    """

    @property
    def executable(self) -> str:
        """Path or name of the Bob Shell binary."""
        return os.environ.get("NOTPRODREADY_BOB_EXECUTABLE", "bob")

    @property
    def max_cost(self) -> float:
        """Maximum analysis cost in Bobcoins."""
        raw = os.environ.get("NOTPRODREADY_BOB_MAX_COST", "0.50")
        try:
            val = float(raw)
        except ValueError:
            val = 0.50
        return val

    @property
    def max_turns(self) -> int:
        """Maximum number of agent turns Bob may take."""
        raw = os.environ.get("NOTPRODREADY_BOB_MAX_TURNS", "30")
        try:
            val = int(raw)
        except ValueError:
            val = 30
        return val

    @property
    def timeout_seconds(self) -> int:
        """Wall-clock timeout for the entire Bob process, in seconds."""
        raw = os.environ.get("NOTPRODREADY_BOB_TIMEOUT", "300")
        try:
            val = int(raw)
        except ValueError:
            val = 300
        return val


    @property
    def finalize_max_cost(self) -> float:
        """Incremental cost budget for the finalization fallback, in Bobcoins.

        This is added to the primary run's spend to produce the --max-cost
        ceiling passed to the resume command.  It is NOT the total ceiling for
        the resumed task — Bob would immediately hit a limit if the total were
        set below what the primary run already spent.
        """
        raw = os.environ.get("NOTPRODREADY_BOB_FINALIZE_MAX_COST", "0.25")
        try:
            val = float(raw)
        except ValueError:
            val = 0.25
        return val

    @property
    def finalize_max_turns(self) -> int:
        """Maximum turns for the finalization fallback (should stay at 1)."""
        raw = os.environ.get("NOTPRODREADY_BOB_FINALIZE_MAX_TURNS", "1")
        try:
            val = int(raw)
        except ValueError:
            val = 1
        return val


    @property
    def remediate_max_cost(self) -> float:
        """Incremental cost budget for the remediation turn, in Bobcoins."""
        raw = os.environ.get("NOTPRODREADY_BOB_REMEDIATE_MAX_COST", "1.00")
        try:
            val = float(raw)
        except ValueError:
            val = 1.00
        return val

    @property
    def remediate_max_turns(self) -> int:
        """Maximum turns for the remediation turn."""
        raw = os.environ.get("NOTPRODREADY_BOB_REMEDIATE_MAX_TURNS", "20")
        try:
            val = int(raw)
        except ValueError:
            val = 20
        return val


# Singleton used by the runner
bob_shell_config = BobShellConfig()
