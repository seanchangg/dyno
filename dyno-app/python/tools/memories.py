"""Memory tools: save, recall, list, and delete sticky-note memories via Supabase.

Memories are stored in the cloud (Supabase) and retrieved on-demand,
so they don't bloat the system prompt.
"""

import json
import urllib.request
import urllib.parse
import urllib.error

API_BASE = "http://localhost:3000/api/memories"

# Set by ws_server before each session — the authenticated user's ID
_current_user_id: str | None = None


def set_user_id(user_id: str):
    """Called by the server to set the user context for memory operations."""
    global _current_user_id
    _current_user_id = user_id


def _get_user_id(input_data: dict | None = None) -> str:
    """Get user ID from tool input (preferred) or module-level fallback."""
    if input_data and input_data.get("userId"):
        return input_data["userId"]
    return _current_user_id or ""


TOOL_DEFS = [
    {
        "name": "save_memory",
        "description": (
            "Save a memory to persist across sessions. "
            "If a memory with the same tag exists, it will be updated. "
            "Always pass the userId from the system prompt."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "userId": {
                    "type": "string",
                    "description": "The user's ID (provided in the system prompt)"
                },
                "tag": {
                    "type": "string",
                    "description": "Label for this memory"
                },
                "content": {
                    "type": "string",
                    "description": "The content to remember"
                }
            },
            "required": ["userId", "tag", "content"]
        }
    },
    {
        "name": "recall_memories",
        "description": (
            "Search and retrieve saved memories. "
            "Use with no arguments to list all memories, "
            "with 'tag' to get a specific one, or with 'query' to search content. "
            "Always pass the userId from the system prompt."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "userId": {
                    "type": "string",
                    "description": "The user's ID (provided in the system prompt)"
                },
                "tag": {
                    "type": "string",
                    "description": "Filter by exact tag name"
                },
                "query": {
                    "type": "string",
                    "description": "Search term to find in memory content"
                }
            },
            "required": ["userId"]
        }
    },
    {
        "name": "delete_memory",
        "description": (
            "Delete a memory by its tag. Use when information is outdated or no longer needed. "
            "Always pass the userId from the system prompt."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "userId": {
                    "type": "string",
                    "description": "The user's ID (provided in the system prompt)"
                },
                "tag": {
                    "type": "string",
                    "description": "Tag of the memory to delete"
                }
            },
            "required": ["userId", "tag"]
        }
    },
]

AUTO_APPROVED = {"recall_memories", "save_memory"}
READ_ONLY = AUTO_APPROVED  # alias used by tools/__init__.py


async def handle_save_memory(input_data: dict) -> str:
    user_id = _get_user_id(input_data)
    tag = input_data.get("tag", "").strip()
    content = input_data.get("content", "").strip()

    if not tag or not content:
        return "Error: tag and content are required"

    payload = json.dumps({"userId": user_id, "tag": tag, "content": content}).encode()
    req = urllib.request.Request(
        API_BASE,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            action = result.get("action", "saved")
            return f"Memory '{tag}' {action} successfully."
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return f"Error saving memory: {body}"
    except Exception as e:
        return f"Error saving memory: {str(e)}"


async def handle_recall_memories(input_data: dict) -> str:
    user_id = _get_user_id(input_data)
    tag = input_data.get("tag")
    query = input_data.get("query")

    params = {"userId": user_id}
    if tag:
        params["tag"] = tag
    if query:
        params["q"] = query

    url = f"{API_BASE}?{urllib.parse.urlencode(params)}"

    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            result = json.loads(resp.read())
            memories = result.get("memories", [])

            if not memories:
                if tag:
                    return f"No memory found with tag '{tag}'."
                if query:
                    return f"No memories matching '{query}'."
                return "No memories saved yet."

            lines = []
            for m in memories:
                lines.append(f"[{m['tag']}] {m['content']}")
            return "\n---\n".join(lines)
    except Exception as e:
        return f"Error recalling memories: {str(e)}"


async def handle_delete_memory(input_data: dict) -> str:
    user_id = _get_user_id(input_data)
    tag = input_data.get("tag", "").strip()

    if not tag:
        return "Error: tag is required"

    params = urllib.parse.urlencode({"userId": user_id, "tag": tag})
    url = f"{API_BASE}?{params}"

    req = urllib.request.Request(url, method="DELETE")

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return f"Memory '{tag}' deleted."
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return f"Error deleting memory: {body}"
    except Exception as e:
        return f"Error deleting memory: {str(e)}"


HANDLERS = {
    "save_memory": handle_save_memory,
    "recall_memories": handle_recall_memories,
    "delete_memory": handle_delete_memory,
}
