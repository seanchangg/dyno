"""Upload reading tool: read_upload.

Dual-mode: reads from local filesystem or Supabase Storage
depending on STORAGE_MODE setting.
"""

import json
import time

from ._common import UPLOADS_DIR, UPLOADS_BUCKET, STORAGE_MODE, safe_path

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
]

READ_ONLY = {"read_upload"}


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


HANDLERS = {
    "read_upload": handle_read_upload,
}
