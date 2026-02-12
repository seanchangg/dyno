"""Advanced memory management — append, edit, and organize memories.

Uses the same Next.js API as memories.py for memory CRUD operations.
"""

import json
import os
import urllib.request
import urllib.parse
import urllib.error

from ._common import FRONTEND_URL

API_BASE = FRONTEND_URL + "/api/memories"

TOOL_DEFS = [
    {
        "name": "append_memory",
        "description": "Append content to an existing memory without overwriting. If the memory doesn't exist, creates it. Useful for building lists or accumulating information over time.",
        "input_schema": {
            "type": "object",
            "properties": {
                "userId": {
                    "type": "string",
                    "description": "User ID (from system prompt)"
                },
                "tag": {
                    "type": "string",
                    "description": "Memory tag to append to"
                },
                "content": {
                    "type": "string",
                    "description": "Content to append"
                },
                "separator": {
                    "type": "string",
                    "description": "Separator between old and new content (default: newline)",
                    "default": "\n"
                }
            },
            "required": ["userId", "tag", "content"]
        }
    },
    {
        "name": "edit_memory",
        "description": "Edit a memory by replacing text within it. Updates the existing memory without changing the tag.",
        "input_schema": {
            "type": "object",
            "properties": {
                "userId": {
                    "type": "string",
                    "description": "User ID (from system prompt)"
                },
                "tag": {
                    "type": "string",
                    "description": "Memory tag to edit"
                },
                "old_text": {
                    "type": "string",
                    "description": "Text to find and replace"
                },
                "new_text": {
                    "type": "string",
                    "description": "Replacement text"
                }
            },
            "required": ["userId", "tag", "old_text", "new_text"]
        }
    },
    {
        "name": "list_memory_tags",
        "description": "List all memory tags for quick reference. Returns just the tags, not the full content.",
        "input_schema": {
            "type": "object",
            "properties": {
                "userId": {
                    "type": "string",
                    "description": "User ID (from system prompt)"
                }
            },
            "required": ["userId"]
        }
    }
]


def _fetch_memory(user_id: str, tag: str) -> dict | None:
    """Fetch a single memory by tag via the API. Returns None if not found."""
    params = urllib.parse.urlencode({"userId": user_id, "tag": tag})
    url = f"{API_BASE}?{params}"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            result = json.loads(resp.read())
            memories = result.get("memories", [])
            return memories[0] if memories else None
    except Exception:
        return None


def _save_memory(user_id: str, tag: str, content: str) -> dict:
    """Create or update a memory via the API."""
    payload = json.dumps({"userId": user_id, "tag": tag, "content": content}).encode()
    req = urllib.request.Request(
        API_BASE,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


async def append_memory(input_data: dict) -> str:
    """Append to an existing memory or create if it doesn't exist."""
    user_id = input_data.get("userId", "")
    tag = input_data.get("tag", "").strip()
    content = input_data.get("content", "").strip()
    separator = input_data.get("separator", "\n")

    if not tag or not content:
        return "Error: tag and content are required"

    try:
        existing = _fetch_memory(user_id, tag)

        if existing:
            new_content = existing["content"] + separator + content
            _save_memory(user_id, tag, new_content)
            return f"Memory '{tag}' appended successfully."
        else:
            _save_memory(user_id, tag, content)
            return f"Memory '{tag}' created successfully."
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return f"Error appending memory: {body}"
    except Exception as e:
        return f"Error appending memory: {str(e)}"


async def edit_memory(input_data: dict) -> str:
    """Edit a memory by replacing text within it."""
    user_id = input_data.get("userId", "")
    tag = input_data.get("tag", "").strip()
    old_text = input_data.get("old_text", "")
    new_text = input_data.get("new_text", "")

    if not tag or not old_text:
        return "Error: tag and old_text are required"

    try:
        existing = _fetch_memory(user_id, tag)

        if not existing:
            return f"No memory found with tag '{tag}'"

        old_content = existing["content"]
        if old_text not in old_content:
            return f"Text '{old_text}' not found in memory '{tag}'"

        new_content = old_content.replace(old_text, new_text)
        _save_memory(user_id, tag, new_content)
        return f"Memory '{tag}' edited successfully."
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return f"Error editing memory: {body}"
    except Exception as e:
        return f"Error editing memory: {str(e)}"


async def list_memory_tags(input_data: dict) -> str:
    """List all memory tags."""
    user_id = input_data.get("userId", "")

    try:
        params = urllib.parse.urlencode({"userId": user_id})
        url = f"{API_BASE}?{params}"

        with urllib.request.urlopen(url, timeout=10) as resp:
            result = json.loads(resp.read())
            memories = result.get("memories", [])
            tags = [m["tag"] for m in memories]

            if not tags:
                return "No memories saved yet."
            return "Memory tags: " + ", ".join(tags)
    except Exception as e:
        return f"Error listing memory tags: {str(e)}"


HANDLERS = {
    "append_memory": append_memory,
    "edit_memory": edit_memory,
    "list_memory_tags": list_memory_tags,
}

READ_ONLY = {"append_memory", "edit_memory", "list_memory_tags"}
