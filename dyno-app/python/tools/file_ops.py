"""File operation tools: read_file, list_files, write_file, modify_file.

Dual-mode operation:
- STORAGE_MODE=local: operates on local filesystem (python/ and data/ dirs)
- STORAGE_MODE=cloud: operates on Supabase Storage (workspace bucket)

In cloud mode, users work in workspace/ — they can read/write data files and
.md skill files there. The agent reads its own tools from python/ locally,
but user files go to the cloud.
"""

import json
import os
from ._common import (
    TOOLS_DIR, DATA_DIR, ALLOWED_BASES, EXCLUDED_DIRS, safe_path,
    STORAGE_MODE, WORKSPACE_BUCKET, WIDGETS_BUCKET,
)

# ── Cloud write guards ────────────────────────────────────────────────────────

def _cloud_write_blocked(filename: str) -> str | None:
    """In cloud mode, check if a write should be blocked.

    Returns an error message string if blocked, None if allowed.
    """
    if STORAGE_MODE != "cloud":
        return None

    # Block writes to source code (python/) in cloud mode
    if filename.startswith("python/"):
        return (
            "Error: Writing to python/ is disabled in cloud mode. "
            "Agent source code is read-only in cloud deployments."
        )

    # Block writes to workspace/skills/*.md — must use skill_manager tools
    if filename.startswith("workspace/") and "/skills/" in filename and filename.endswith(".md"):
        return (
            "Error: Cannot write skill files directly. "
            "Use create_skill or update_skill instead."
        )

    # In cloud mode, only workspace/ paths are writable
    if not filename.startswith("workspace/"):
        return (
            "Error: In cloud mode, only workspace/ paths are writable. "
            f"Cannot write to: {filename}"
        )

    return None

TOOL_DEFS = [
    {
        "name": "read_file",
        "description": (
            "Read a file. In local mode, use paths like 'python/tools/web.py' or "
            "'data/context/claude.md'. In cloud mode, user files are under 'workspace/' "
            "(e.g. 'workspace/skills/my-skill.md', 'workspace/data/config.json')."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "filename": {
                    "type": "string",
                    "description": "Path to read (e.g. 'workspace/data/config.json', 'python/tools/web.py', 'data/context/claude.md')"
                }
            },
            "required": ["filename"]
        }
    },
    {
        "name": "list_files",
        "description": (
            "List files. In local mode, lists python/ and data/ directories. "
            "In cloud mode, lists files under 'workspace/' in cloud storage."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Directory to list (e.g. 'workspace/', 'workspace/skills/', 'python/tools', 'data/context'). Defaults to listing roots."
                }
            },
            "required": []
        }
    },
    {
        "name": "write_file",
        "description": (
            "Write a new file or overwrite an existing file. In cloud mode, write to "
            "'workspace/' paths (e.g. 'workspace/data/config.json', "
            "'workspace/widgets/chart.html'). python/ is read-only in cloud mode. "
            "For skill files, use create_skill/update_skill instead. "
            "In local mode, write to python/ or data/."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "filename": {
                    "type": "string",
                    "description": "Path to write (e.g. 'workspace/skills/my-skill.md', 'python/tools/new_skill.py')"
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
        "description": (
            "Modify an existing file by replacing a specific string with a new string. "
            "In cloud mode, only workspace/ paths are writable (python/ is read-only). "
            "For skill files, use update_skill instead. "
            "In local mode, works with python/ and data/ paths too."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "filename": {
                    "type": "string",
                    "description": "Path to modify (e.g. 'workspace/data/config.json', 'python/tools/web.py')"
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

# Map prefix to base directory (local mode)
_PREFIX_MAP = {
    "python/": TOOLS_DIR,
    "data/": DATA_DIR,
}


def _is_cloud_path(filename: str) -> bool:
    """Check if this path should use cloud storage."""
    return STORAGE_MODE == "cloud" and filename.startswith("workspace/")


def _cloud_path(filename: str) -> str:
    """Strip 'workspace/' prefix to get the storage path."""
    return filename[len("workspace/"):]


def _get_cloud_bucket(filename: str) -> str:
    """Determine which bucket to use based on path.

    workspace/widgets/* -> widgets bucket
    everything else -> workspace bucket
    """
    cloud_path = _cloud_path(filename)
    if cloud_path.startswith("widgets/"):
        return WIDGETS_BUCKET
    return WORKSPACE_BUCKET


def _resolve_path(filename: str) -> "tuple[__import__('pathlib').Path, str]":
    """Resolve a prefixed filename to a safe absolute path (local mode only).

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

    # Cloud mode for workspace/ paths
    if _is_cloud_path(filename):
        user_id = input_data.get("userId", "")
        if not user_id:
            return "Error: userId is required for cloud storage operations"
        try:
            from . import storage_client
            bucket = _get_cloud_bucket(filename)
            cloud_path = _cloud_path(filename)
            # Strip bucket-specific prefix if using widgets bucket
            if bucket == WIDGETS_BUCKET and cloud_path.startswith("widgets/"):
                cloud_path = cloud_path[len("widgets/"):]
            data = storage_client.read_file(bucket, user_id, cloud_path)
            return data.decode("utf-8")
        except RuntimeError as e:
            return f"Error: {e}"
        except UnicodeDecodeError:
            return f"Error: File is binary, cannot display as text: {filename}"

    # Local mode
    try:
        path, _ = _resolve_path(filename)
    except ValueError as e:
        return f"Error: {e}"
    if not path.exists():
        return f"Error: File not found: {filename}"
    return path.read_text(encoding="utf-8")


async def handle_list_files(input_data: dict) -> str:
    subdir = input_data.get("path", "")

    # Cloud mode for workspace/ paths
    if STORAGE_MODE == "cloud" and (not subdir or subdir.startswith("workspace")):
        user_id = input_data.get("userId", "")
        if not user_id:
            return "Error: userId is required for cloud storage operations"
        try:
            from . import storage_client
            prefix = _cloud_path(subdir) if subdir.startswith("workspace/") else ""
            files = storage_client.list_files(WORKSPACE_BUCKET, user_id, prefix)
            if not files:
                return "No files found in workspace."
            lines = ["## workspace/"]
            for f in files:
                name = f.get("name", "")
                metadata = f.get("metadata", {})
                size = metadata.get("size", 0) if metadata else 0
                if name:
                    lines.append(f"workspace/{name} ({size} bytes)")
            return "\n".join(lines)
        except RuntimeError as e:
            return f"Error: {e}"

    # Local mode
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

    # Cloud write guards
    blocked = _cloud_write_blocked(filename)
    if blocked:
        return blocked

    # Cloud mode for workspace/ paths
    if _is_cloud_path(filename):
        user_id = input_data.get("userId", "")
        if not user_id:
            return "Error: userId is required for cloud storage operations"
        try:
            from . import storage_client
            bucket = _get_cloud_bucket(filename)
            cloud_path = _cloud_path(filename)
            if bucket == WIDGETS_BUCKET and cloud_path.startswith("widgets/"):
                cloud_path = cloud_path[len("widgets/"):]

            # Determine content type
            content_type = "text/plain"
            if filename.endswith(".html"):
                content_type = "text/html"
            elif filename.endswith(".json"):
                content_type = "application/json"
            elif filename.endswith(".md"):
                content_type = "text/markdown"
            elif filename.endswith(".py"):
                content_type = "text/x-python"

            storage_client.upload_file(
                bucket, user_id, cloud_path,
                content.encode("utf-8"), content_type
            )
            return f"Written {len(content)} bytes to {filename}"
        except RuntimeError as e:
            return f"Error: {e}"

    # Local mode
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

    # Cloud write guards
    blocked = _cloud_write_blocked(filename)
    if blocked:
        return blocked

    # Cloud mode for workspace/ paths
    if _is_cloud_path(filename):
        user_id = input_data.get("userId", "")
        if not user_id:
            return "Error: userId is required for cloud storage operations"
        try:
            from . import storage_client
            bucket = _get_cloud_bucket(filename)
            cloud_path = _cloud_path(filename)
            if bucket == WIDGETS_BUCKET and cloud_path.startswith("widgets/"):
                cloud_path = cloud_path[len("widgets/"):]

            # Read current content
            data = storage_client.read_file(bucket, user_id, cloud_path)
            content = data.decode("utf-8")

            if old_string not in content:
                return f"Error: old_string not found in {filename}"

            count = content.count(old_string)
            content = content.replace(old_string, new_string)

            # Determine content type
            content_type = "text/plain"
            if filename.endswith(".html"):
                content_type = "text/html"
            elif filename.endswith(".json"):
                content_type = "application/json"
            elif filename.endswith(".md"):
                content_type = "text/markdown"

            storage_client.upload_file(
                bucket, user_id, cloud_path,
                content.encode("utf-8"), content_type
            )
            return f"Replaced {count} occurrence(s) in {filename}"
        except RuntimeError as e:
            return f"Error: {e}"

    # Local mode
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
