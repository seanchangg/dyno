"""File operation tools: read_file, list_files, write_file, modify_file.

These operate on the bot's source directory (python/) and data directory (data/),
allowing the agent to read and modify its own code and manage its data files.
"""

import os
from ._common import TOOLS_DIR, DATA_DIR, ALLOWED_BASES, EXCLUDED_DIRS, safe_path

TOOL_DEFS = [
    {
        "name": "read_file",
        "description": "Read a file in the bot's source directory (python/) or data directory (data/). Use paths like 'python/agent_core.py', 'python/tools/web.py', 'data/context/claude.md', 'data/config/agent.json'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "filename": {
                    "type": "string",
                    "description": "Path starting with 'python/' or 'data/' (e.g. 'python/agent_core.py', 'data/context/claude.md')"
                }
            },
            "required": ["filename"]
        }
    },
    {
        "name": "list_files",
        "description": "List files in the bot's source directory (python/) or data directory (data/).",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Directory to list, starting with 'python/' or 'data/' (e.g. 'python/tools', 'data/context'). Defaults to listing both roots."
                }
            },
            "required": []
        }
    },
    {
        "name": "write_file",
        "description": "Write a new file or overwrite an existing file in python/ or data/. Can create new tool skills in python/tools/.",
        "input_schema": {
            "type": "object",
            "properties": {
                "filename": {
                    "type": "string",
                    "description": "Path starting with 'python/' or 'data/' (e.g. 'python/tools/new_skill.py', 'data/config/settings.json')"
                },
                "content": {
                    "type": "string",
                    "description": "Full content to write to the file"
                }
            },
            "required": ["filename", "content"]
        }
    },
    {
        "name": "modify_file",
        "description": "Modify an existing file by replacing a specific string with a new string. Works in python/ and data/.",
        "input_schema": {
            "type": "object",
            "properties": {
                "filename": {
                    "type": "string",
                    "description": "Path starting with 'python/' or 'data/' (e.g. 'python/tools/web.py', 'data/context/claude.md')"
                },
                "old_string": {
                    "type": "string",
                    "description": "The exact string to find and replace"
                },
                "new_string": {
                    "type": "string",
                    "description": "The replacement string"
                }
            },
            "required": ["filename", "old_string", "new_string"]
        }
    },
]

READ_ONLY = {"read_file", "list_files"}

# Map prefix to base directory
_PREFIX_MAP = {
    "python/": TOOLS_DIR,
    "data/": DATA_DIR,
}


def _resolve_path(filename: str) -> "tuple[__import__('pathlib').Path, str]":
    """Resolve a prefixed filename to a safe absolute path.

    Returns (resolved_path, base_relative_path).
    Accepts paths like 'python/tools/web.py' or 'data/context/claude.md'.
    Also accepts legacy unprefixed paths (resolved against python/).
    """
    for prefix, base in _PREFIX_MAP.items():
        if filename.startswith(prefix):
            relative = filename[len(prefix):]
            return safe_path(relative, base=base), filename

    # Legacy: unprefixed paths resolve against python/
    return safe_path(filename, base=TOOLS_DIR), filename


async def handle_read_file(input_data: dict) -> str:
    filename = input_data["filename"]
    try:
        path, _ = _resolve_path(filename)
    except ValueError as e:
        return f"Error: {e}"
    if not path.exists():
        return f"Error: File not found: {filename}"
    return path.read_text(encoding="utf-8")


async def handle_list_files(input_data: dict) -> str:
    subdir = input_data.get("path", "")

    # If no path given, list both roots
    if not subdir:
        lines = ["## python/"]
        lines.extend(_list_dir(TOOLS_DIR, TOOLS_DIR, "python"))
        lines.append("\n## data/")
        lines.extend(_list_dir(DATA_DIR, DATA_DIR, "data"))
        return "\n".join(lines)

    try:
        path, _ = _resolve_path(subdir.rstrip("/") + "/placeholder")
        target = path.parent
    except ValueError as e:
        return f"Error: {e}"

    if not target.is_dir():
        return f"Error: Not a directory: {subdir}"

    # Determine the display prefix
    display_prefix = subdir.rstrip("/")
    base = TOOLS_DIR if str(target).startswith(str(TOOLS_DIR)) else DATA_DIR

    files = _list_dir(target, base, "python" if base == TOOLS_DIR else "data")
    if not files:
        return f"Empty directory: {subdir}"
    return "\n".join(files)


def _list_dir(target: "Path", base: "Path", prefix: str) -> list[str]:
    """List directory contents, skipping excluded dirs and hidden files."""
    from pathlib import Path
    files = []
    for f in sorted(target.iterdir()):
        if f.name.startswith(".") or f.name in EXCLUDED_DIRS:
            continue
        rel = os.path.relpath(f, base)
        display = f"{prefix}/{rel}"
        if f.is_dir():
            files.append(f"{display}/")
        elif f.is_file():
            size = f.stat().st_size
            files.append(f"{display} ({size} bytes)")
    return files


async def handle_write_file(input_data: dict) -> str:
    filename = input_data["filename"]
    content = input_data["content"]
    try:
        path, _ = _resolve_path(filename)
    except ValueError as e:
        return f"Error: {e}"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return f"Written {len(content)} bytes to {filename}"


async def handle_modify_file(input_data: dict) -> str:
    filename = input_data["filename"]
    old_string = input_data["old_string"]
    new_string = input_data["new_string"]
    try:
        path, _ = _resolve_path(filename)
    except ValueError as e:
        return f"Error: {e}"
    if not path.exists():
        return f"Error: File not found: {filename}"
    content = path.read_text(encoding="utf-8")
    if old_string not in content:
        return f"Error: old_string not found in {filename}"
    count = content.count(old_string)
    content = content.replace(old_string, new_string)
    path.write_text(content, encoding="utf-8")
    return f"Replaced {count} occurrence(s) in {filename}"


HANDLERS = {
    "read_file": handle_read_file,
    "list_files": handle_list_files,
    "write_file": handle_write_file,
    "modify_file": handle_modify_file,
}
