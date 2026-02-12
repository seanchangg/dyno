"""Code execution tools — run code and manage reusable scripts.

Supports one-off execution (execute_code) and persistent scripts that can
be saved, listed, and re-run to avoid burning inference tokens on repetitive
tasks.
"""

import asyncio
import json
import os
import time
from pathlib import Path

from ._common import DATA_DIR

SCRIPTS_DIR = DATA_DIR / "scripts"
SCRIPTS_DIR.mkdir(parents=True, exist_ok=True)

_LANG_CONFIG = {
    "python": {"ext": ".py", "cmd": ["python3"]},
    "bash": {"ext": ".sh", "cmd": ["bash"]},
    "javascript": {"ext": ".js", "cmd": ["node"]},
    "typescript": {"ext": ".ts", "cmd": ["npx", "tsx"]},
}


async def _run_file(filepath: str, timeout: int, args: list[str] | None = None) -> dict:
    """Execute a file and return stdout/stderr/exit_code."""
    ext = Path(filepath).suffix
    cmd = None
    for cfg in _LANG_CONFIG.values():
        if cfg["ext"] == ext:
            cmd = cfg["cmd"]
            break
    if not cmd:
        # Try to infer from shebang or just run with python
        cmd = ["python3"]

    full_cmd = [*cmd, filepath, *(args or [])]

    process = await asyncio.create_subprocess_exec(
        *full_cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(DATA_DIR),
    )

    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(), timeout=timeout
        )
    except asyncio.TimeoutError:
        process.kill()
        return {
            "stdout": "",
            "stderr": f"Execution timed out after {timeout}s",
            "exit_code": -1,
            "success": False,
        }

    return {
        "stdout": stdout.decode("utf-8", errors="replace"),
        "stderr": stderr.decode("utf-8", errors="replace"),
        "exit_code": process.returncode,
        "success": process.returncode == 0,
    }


# ── execute_code: one-off execution ─────────────────────────────────────────

async def handle_execute_code(input_data: dict) -> str:
    """Execute code in a temporary file and return output."""
    code = input_data.get("code", "")
    language = input_data.get("language", "python")
    timeout = input_data.get("timeout", 30)

    if not code:
        return "Error: code is required"

    cfg = _LANG_CONFIG.get(language)
    if not cfg:
        return f"Error: unsupported language '{language}'. Supported: {', '.join(_LANG_CONFIG)}"

    # Write to temp file in scripts dir
    tmp_name = f"_tmp_{int(time.time() * 1000)}{cfg['ext']}"
    tmp_path = SCRIPTS_DIR / tmp_name

    try:
        tmp_path.write_text(code, encoding="utf-8")
        result = await _run_file(str(tmp_path), timeout)
        return json.dumps(result)
    finally:
        try:
            tmp_path.unlink()
        except OSError:
            pass


# ── save_script: persist a reusable script ───────────────────────────────────

async def handle_save_script(input_data: dict) -> str:
    """Save a named script for later re-use."""
    name = input_data.get("name", "").strip()
    code = input_data.get("code", "")
    language = input_data.get("language", "python")
    description = input_data.get("description", "")

    if not name or not code:
        return "Error: name and code are required"

    cfg = _LANG_CONFIG.get(language)
    if not cfg:
        return f"Error: unsupported language '{language}'. Supported: {', '.join(_LANG_CONFIG)}"

    # Sanitize name — alphanumeric, dashes, underscores only
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)
    filename = f"{safe_name}{cfg['ext']}"
    filepath = SCRIPTS_DIR / filename

    # Add a header comment with metadata
    if language == "python":
        header = f'# Script: {name}\n# Description: {description}\n# Language: {language}\n\n'
    elif language == "javascript" or language == "typescript":
        header = f'// Script: {name}\n// Description: {description}\n// Language: {language}\n\n'
    elif language == "bash":
        header = f'#!/bin/bash\n# Script: {name}\n# Description: {description}\n\n'
    else:
        header = ""

    filepath.write_text(header + code, encoding="utf-8")

    # Also save metadata
    meta_path = SCRIPTS_DIR / f"{safe_name}.meta.json"
    meta = {
        "name": name,
        "filename": filename,
        "language": language,
        "description": description,
        "created_at": time.time(),
        "size_bytes": filepath.stat().st_size,
    }
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    return json.dumps({
        "saved": True,
        "name": name,
        "filename": filename,
        "path": str(filepath),
        "size_bytes": meta["size_bytes"],
    })


# ── run_script: execute a saved script ───────────────────────────────────────

async def handle_run_script(input_data: dict) -> str:
    """Run a previously saved script by name."""
    name = input_data.get("name", "").strip()
    args = input_data.get("args", [])
    timeout = input_data.get("timeout", 30)

    if not name:
        return "Error: name is required"

    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)

    # Find the script file (check all extensions)
    found = None
    for cfg in _LANG_CONFIG.values():
        candidate = SCRIPTS_DIR / f"{safe_name}{cfg['ext']}"
        if candidate.exists():
            found = candidate
            break

    if not found:
        return f"Error: script '{name}' not found. Use list_scripts to see available scripts."

    result = await _run_file(str(found), timeout, args)
    result["script"] = name
    return json.dumps(result)


# ── list_scripts: show saved scripts ─────────────────────────────────────────

async def handle_list_scripts(input_data: dict) -> str:
    """List all saved scripts with metadata."""
    scripts = []

    for meta_file in sorted(SCRIPTS_DIR.glob("*.meta.json")):
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
            scripts.append(meta)
        except (json.JSONDecodeError, OSError):
            continue

    if not scripts:
        return "No saved scripts yet. Use save_script to create one."

    lines = ["Saved scripts:\n"]
    for s in scripts:
        lines.append(f"  {s['name']} ({s['language']}) — {s.get('description', 'no description')}")
        lines.append(f"    File: {s['filename']} ({s.get('size_bytes', '?')} bytes)")
    return "\n".join(lines)


# ── delete_script: remove a saved script ─────────────────────────────────────

async def handle_delete_script(input_data: dict) -> str:
    """Delete a saved script by name."""
    name = input_data.get("name", "").strip()
    if not name:
        return "Error: name is required"

    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)
    deleted = []

    # Remove script file (any extension)
    for cfg in _LANG_CONFIG.values():
        candidate = SCRIPTS_DIR / f"{safe_name}{cfg['ext']}"
        if candidate.exists():
            candidate.unlink()
            deleted.append(candidate.name)

    # Remove metadata
    meta_path = SCRIPTS_DIR / f"{safe_name}.meta.json"
    if meta_path.exists():
        meta_path.unlink()
        deleted.append(meta_path.name)

    if not deleted:
        return f"Error: script '{name}' not found"

    return f"Deleted script '{name}' ({', '.join(deleted)})"


# ── Tool definitions ────────────────────────────────────────────────────────

TOOL_DEFS = [
    {
        "name": "execute_code",
        "description": (
            "Execute code (Python, JavaScript, TypeScript, or Bash) in a temporary file. "
            "Returns stdout, stderr, and exit code. Good for one-off calculations, "
            "data processing, or testing snippets. Code runs from the data/ directory."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "description": "The code to execute"
                },
                "language": {
                    "type": "string",
                    "enum": ["python", "bash", "javascript", "typescript"],
                    "description": "Language/runtime (default: python)",
                    "default": "python"
                },
                "timeout": {
                    "type": "integer",
                    "description": "Timeout in seconds (default: 30, max: 120)",
                    "default": 30
                }
            },
            "required": ["code"]
        }
    },
    {
        "name": "save_script",
        "description": (
            "Save a named, reusable script for later execution. Use this for "
            "repetitive tasks (data formatting, API calls, file processing) to "
            "avoid re-generating code each time. Scripts persist across sessions."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Script name (alphanumeric, dashes, underscores)"
                },
                "code": {
                    "type": "string",
                    "description": "The script source code"
                },
                "language": {
                    "type": "string",
                    "enum": ["python", "bash", "javascript", "typescript"],
                    "description": "Language (default: python)",
                    "default": "python"
                },
                "description": {
                    "type": "string",
                    "description": "What this script does (for reference)"
                }
            },
            "required": ["name", "code"]
        }
    },
    {
        "name": "run_script",
        "description": (
            "Run a previously saved script by name. Optionally pass command-line "
            "arguments. Much cheaper than regenerating code — use this for "
            "repetitive operations."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Name of the saved script to run"
                },
                "args": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Command-line arguments to pass to the script"
                },
                "timeout": {
                    "type": "integer",
                    "description": "Timeout in seconds (default: 30)",
                    "default": 30
                }
            },
            "required": ["name"]
        }
    },
    {
        "name": "list_scripts",
        "description": "List all saved reusable scripts with their descriptions and metadata.",
        "input_schema": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "delete_script",
        "description": "Delete a saved script by name.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Name of the script to delete"
                }
            },
            "required": ["name"]
        }
    },
]

HANDLERS = {
    "execute_code": handle_execute_code,
    "save_script": handle_save_script,
    "run_script": handle_run_script,
    "list_scripts": handle_list_scripts,
    "delete_script": handle_delete_script,
}

READ_ONLY = {"execute_code", "run_script", "list_scripts"}
