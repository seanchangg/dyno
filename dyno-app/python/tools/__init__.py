"""
Tool definitions and handlers for the Marty Agent.

Each skill module in this directory exposes:
  TOOL_DEFS  — list of Anthropic tool schemas
  HANDLERS   — dict of {name: async handler}
  READ_ONLY  — set of tool names safe for auto-execution

This package dynamically discovers and loads all skill modules.
Call reload_tools() to pick up new or modified skills at runtime
without restarting the server.
"""

import importlib
import sys
from pathlib import Path

from ._common import DATA_DIR, TOOLS_DIR, SCREENSHOTS_DIR, UPLOADS_DIR, SCRIPTS_DIR, safe_path

_TOOLS_DIR = Path(__file__).parent
_SKIP = {"__init__", "_common"}

AGENT_TOOLS: list[dict] = []
TOOL_HANDLERS: dict[str, object] = {}
READ_ONLY_TOOLS: set[str] = set()


def reload_tools() -> int:
    """Discover and (re)load all skill modules in the tools/ directory.

    Returns the number of tools loaded. Safe to call repeatedly —
    picks up new files, reloads modified ones, and removes tools
    from deleted modules.
    """
    new_tools: list[dict] = []
    new_handlers: dict[str, object] = {}
    new_read_only: set[str] = set()

    for py_file in sorted(_TOOLS_DIR.glob("*.py")):
        if py_file.stem in _SKIP or py_file.stem.startswith("_"):
            continue

        module_name = f"tools.{py_file.stem}"

        try:
            if module_name in sys.modules:
                mod = importlib.reload(sys.modules[module_name])
            else:
                mod = importlib.import_module(module_name)

            if hasattr(mod, "TOOL_DEFS"):
                new_tools.extend(mod.TOOL_DEFS)
            if hasattr(mod, "HANDLERS"):
                new_handlers.update(mod.HANDLERS)
            if hasattr(mod, "READ_ONLY"):
                new_read_only.update(mod.READ_ONLY)
        except Exception as e:
            # Don't crash the server if a skill has errors — log and skip
            print(f"[tools] Error loading {py_file.name}: {e}")

    AGENT_TOOLS.clear()
    AGENT_TOOLS.extend(new_tools)
    TOOL_HANDLERS.clear()
    TOOL_HANDLERS.update(new_handlers)
    READ_ONLY_TOOLS.clear()
    READ_ONLY_TOOLS.update(new_read_only)

    return len(AGENT_TOOLS)


# Initial load
reload_tools()

__all__ = [
    "AGENT_TOOLS",
    "TOOL_HANDLERS",
    "READ_ONLY_TOOLS",
    "reload_tools",
    "DATA_DIR",
    "TOOLS_DIR",
    "SCREENSHOTS_DIR",
    "UPLOADS_DIR",
    "SCRIPTS_DIR",
    "safe_path",
]
