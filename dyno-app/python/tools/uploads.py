"""Upload tools: read_upload, list_uploads.

Dual-mode: reads from local filesystem or Supabase Storage
depending on STORAGE_MODE setting.
"""

import json
import os
import time
import urllib.request
import urllib.parse
import urllib.error

from ._common import UPLOADS_DIR, UPLOADS_BUCKET, STORAGE_MODE, FRONTEND_URL, safe_path, service_headers

TOOL_DEFS = [
    {
        "name": "read_upload",
        "description": "Read a user-uploaded file. Returns text content for text files, or metadata for binary files.",
        "input_schema": {
            "type": "object",
            "properties": {
                "filename": {
                    "type": "string",
                    "description": "Name of the uploaded file to read"
                }
            },
            "required": ["filename"]
        }
    },
    {
        "name": "list_uploads",
        "description": (
            "List all files in the user's Document Vault. "
            "Returns filename, size, and upload date for each file. "
            "Always pass the userId from the system prompt."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "userId": {
                    "type": "string",
                    "description": "The user's ID (provided in the system prompt)"
                }
            },
            "required": ["userId"]
        }
    },
]

READ_ONLY = {"read_upload", "list_uploads"}


async def handle_read_upload(input_data: dict) -> str:
    filename = input_data["filename"]

    # Cloud mode
    if STORAGE_MODE == "cloud":
        user_id = input_data.get("userId", "")
        if not user_id:
            return "Error: userId is required for cloud storage operations"
        try:
            from . import storage_client
            data = storage_client.read_file(UPLOADS_BUCKET, user_id, filename)
            try:
                content = data.decode("utf-8")
                if len(content) > 10000:
                    return content[:10000] + f"\n\n... (truncated, {len(content)} total chars)"
                return content
            except UnicodeDecodeError:
                return f"Binary file: {filename} ({len(data)} bytes)"
        except RuntimeError as e:
            return f"Error: {e}"

    # Local mode
    resolved = safe_path(filename, base=UPLOADS_DIR)
    if not resolved.exists():
        return f"Error: Uploaded file not found: {filename}"

    try:
        content = resolved.read_text(encoding="utf-8")
        if len(content) > 10000:
            return content[:10000] + f"\n\n... (truncated, {len(content)} total chars)"
        return content
    except UnicodeDecodeError:
        stat = resolved.stat()
        return f"Binary file: {filename} ({stat.st_size} bytes, modified {time.ctime(stat.st_mtime)})"


def _format_size(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size / (1024 * 1024):.1f} MB"


async def handle_list_uploads(input_data: dict) -> str:
    user_id = input_data.get("userId", "")
    if not user_id:
        return "Error: userId is required"

    try:
        url = f"{FRONTEND_URL}/api/uploads?userId={urllib.parse.quote(user_id)}"
        list_req = urllib.request.Request(url, headers=service_headers())
        with urllib.request.urlopen(list_req, timeout=10) as resp:
            files = json.loads(resp.read())

        if not files:
            return "No files in the Document Vault. The user can upload files at /vault."

        lines = []
        for f in files:
            name = f.get("filename", "?")
            size = _format_size(f.get("size", 0))
            lines.append(f"  {name} ({size})")

        return f"{len(files)} file(s) in Vault:\n" + "\n".join(lines)
    except Exception as e:
        return f"Error listing uploads: {str(e)}"


HANDLERS = {
    "read_upload": handle_read_upload,
    "list_uploads": handle_list_uploads,
}
