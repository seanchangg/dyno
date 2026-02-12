"""Direct Supabase database tools via PostgREST REST API.

Gives the agent direct CRUD access to all user data tables without
going through the Next.js API layer. Uses urllib (no pip dependency).

Tables: profiles, agent_memories, agent_screenshots, token_usage, widget_layouts
"""

import json
import os
import urllib.request
import urllib.parse
import urllib.error

# Load Supabase credentials from environment variables
_SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

_VALID_TABLES = {"profiles", "agent_memories", "agent_screenshots", "token_usage", "widget_layouts"}


def _rest_url(table: str) -> str:
    return f"{_SUPABASE_URL}/rest/v1/{table}"


def _headers(*, prefer: str | None = None) -> dict[str, str]:
    h = {
        "apikey": _SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        h["Prefer"] = prefer
    return h


def _validate_table(table: str) -> str | None:
    """Return error message if table is invalid, else None."""
    if table not in _VALID_TABLES:
        return f"Error: Invalid table '{table}'. Valid tables: {', '.join(sorted(_VALID_TABLES))}"
    return None


def _build_query_string(filters: dict[str, str] | None, select: str | None,
                        order: str | None, limit: int | None) -> str:
    """Build PostgREST query parameters."""
    params = {}
    if select:
        params["select"] = select
    if order:
        params["order"] = order
    if limit:
        params["limit"] = str(limit)
    if filters:
        params.update(filters)
    return urllib.parse.urlencode(params) if params else ""


def _do_request(url: str, method: str = "GET", data: bytes | None = None,
                headers: dict | None = None) -> tuple[int, str]:
    """Make an HTTP request and return (status_code, body)."""
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")


# ── Tool definitions ──────────────────────────────────────────────────────────

TOOL_DEFS = [
    {
        "name": "db_query",
        "description": (
            "Query a Supabase table using PostgREST filters. "
            "Tables: profiles, agent_memories, agent_screenshots, token_usage, widget_layouts. "
            "Always filter by user_id for user-scoped queries."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "table": {
                    "type": "string",
                    "description": "Table name (e.g. 'agent_memories', 'profiles')"
                },
                "filters": {
                    "type": "object",
                    "description": "PostgREST filters as key-value pairs (e.g. {\"user_id\": \"eq.abc-123\", \"tag\": \"eq.user-prefs\"})"
                },
                "select": {
                    "type": "string",
                    "description": "Columns to select (e.g. 'id,tag,content'). Default: all columns."
                },
                "order": {
                    "type": "string",
                    "description": "Order by column (e.g. 'created_at.desc')"
                },
                "limit": {
                    "type": "integer",
                    "description": "Max rows to return (default: 100)"
                }
            },
            "required": ["table"]
        }
    },
    {
        "name": "db_insert",
        "description": (
            "Insert one or more rows into a Supabase table. "
            "Returns the inserted rows. Always include user_id for user-scoped tables."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "table": {
                    "type": "string",
                    "description": "Table name"
                },
                "rows": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "Array of row objects to insert"
                }
            },
            "required": ["table", "rows"]
        }
    },
    {
        "name": "db_update",
        "description": (
            "Update rows in a Supabase table matching the given filters. "
            "Filters are REQUIRED to prevent accidental full-table updates."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "table": {
                    "type": "string",
                    "description": "Table name"
                },
                "filters": {
                    "type": "object",
                    "description": "PostgREST filters to match rows (REQUIRED, e.g. {\"id\": \"eq.123\"})"
                },
                "data": {
                    "type": "object",
                    "description": "Column values to update"
                }
            },
            "required": ["table", "filters", "data"]
        }
    },
    {
        "name": "db_delete",
        "description": (
            "Delete rows from a Supabase table matching the given filters. "
            "Filters are REQUIRED to prevent accidental full-table deletes."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "table": {
                    "type": "string",
                    "description": "Table name"
                },
                "filters": {
                    "type": "object",
                    "description": "PostgREST filters to match rows (REQUIRED, e.g. {\"id\": \"eq.123\", \"user_id\": \"eq.abc\"})"
                }
            },
            "required": ["table", "filters"]
        }
    },
]

READ_ONLY = {"db_query"}


# ── Handlers ──────────────────────────────────────────────────────────────────

async def handle_db_query(input_data: dict) -> str:
    table = input_data.get("table", "")
    err = _validate_table(table)
    if err:
        return err

    if not _SUPABASE_URL or not _SERVICE_ROLE_KEY:
        return "Error: Supabase credentials not configured in .env.local"

    filters = input_data.get("filters")
    select = input_data.get("select")
    order = input_data.get("order")
    limit = input_data.get("limit", 100)

    qs = _build_query_string(filters, select, order, limit)
    url = _rest_url(table) + ("?" + qs if qs else "")

    status, body = _do_request(url, "GET", headers=_headers())
    if status >= 400:
        return f"Error ({status}): {body}"

    try:
        rows = json.loads(body)
        return json.dumps({"rows": rows, "count": len(rows)})
    except json.JSONDecodeError:
        return body


async def handle_db_insert(input_data: dict) -> str:
    table = input_data.get("table", "")
    err = _validate_table(table)
    if err:
        return err

    if not _SUPABASE_URL or not _SERVICE_ROLE_KEY:
        return "Error: Supabase credentials not configured in .env.local"

    rows = input_data.get("rows", [])
    if not rows:
        return "Error: rows array is required and must not be empty"

    data = json.dumps(rows).encode()
    url = _rest_url(table)
    status, body = _do_request(url, "POST", data=data,
                                headers=_headers(prefer="return=representation"))
    if status >= 400:
        return f"Error ({status}): {body}"

    try:
        inserted = json.loads(body)
        return json.dumps({"inserted": len(inserted), "rows": inserted})
    except json.JSONDecodeError:
        return f"Inserted (status {status})"


async def handle_db_update(input_data: dict) -> str:
    table = input_data.get("table", "")
    err = _validate_table(table)
    if err:
        return err

    if not _SUPABASE_URL or not _SERVICE_ROLE_KEY:
        return "Error: Supabase credentials not configured in .env.local"

    filters = input_data.get("filters")
    if not filters:
        return "Error: filters are required to prevent accidental full-table updates"

    update_data = input_data.get("data", {})
    if not update_data:
        return "Error: data object is required"

    qs = _build_query_string(filters, None, None, None)
    url = _rest_url(table) + ("?" + qs if qs else "")
    payload = json.dumps(update_data).encode()

    status, body = _do_request(url, "PATCH", data=payload,
                                headers=_headers(prefer="return=representation"))
    if status >= 400:
        return f"Error ({status}): {body}"

    try:
        updated = json.loads(body)
        return json.dumps({"updated": len(updated), "rows": updated})
    except json.JSONDecodeError:
        return f"Updated (status {status})"


async def handle_db_delete(input_data: dict) -> str:
    table = input_data.get("table", "")
    err = _validate_table(table)
    if err:
        return err

    if not _SUPABASE_URL or not _SERVICE_ROLE_KEY:
        return "Error: Supabase credentials not configured in .env.local"

    filters = input_data.get("filters")
    if not filters:
        return "Error: filters are required to prevent accidental full-table deletes"

    qs = _build_query_string(filters, None, None, None)
    url = _rest_url(table) + ("?" + qs if qs else "")

    status, body = _do_request(url, "DELETE", headers=_headers(prefer="return=representation"))
    if status >= 400:
        return f"Error ({status}): {body}"

    try:
        deleted = json.loads(body)
        return json.dumps({"deleted": len(deleted), "rows": deleted})
    except json.JSONDecodeError:
        return f"Deleted (status {status})"


HANDLERS = {
    "db_query": handle_db_query,
    "db_insert": handle_db_insert,
    "db_update": handle_db_update,
    "db_delete": handle_db_delete,
}
