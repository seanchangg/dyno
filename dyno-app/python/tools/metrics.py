"""Metric tracking tool — log timestamped data points for habit tracking, performance monitoring, etc.

Dual-mode storage:
- Local mode: JSONL files in data/metrics/ (original behavior)
- Cloud mode: Supabase agent_metrics table via PostgREST

In cloud mode, all operations use the Supabase database regardless of
STORAGE_MODE — the metrics table is always available in Supabase.
"""

import json
import os
import time
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path
from typing import Optional

from ._common import DATA_DIR, STORAGE_MODE

# ── Local storage helpers ──────────────────────────────────────────────────

METRICS_DIR = DATA_DIR / "metrics"
METRICS_DIR.mkdir(parents=True, exist_ok=True)

# ── Supabase config ────────────────────────────────────────────────────────

_SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


def _use_cloud() -> bool:
    """Check if we should use cloud storage for metrics."""
    return STORAGE_MODE == "cloud" and bool(_SUPABASE_URL) and bool(_SERVICE_ROLE_KEY)


def _rest_url(table: str = "agent_metrics") -> str:
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


def _do_request(url: str, method: str = "GET", data: bytes | None = None,
                headers: dict | None = None) -> tuple[int, str]:
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")


# ── Local JSONL helpers ────────────────────────────────────────────────────

def _get_metric_file(user_id: str, metric_name: str) -> Path:
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in metric_name)
    return METRICS_DIR / f"{user_id}_{safe_name}.jsonl"


def _append_entry(filepath: Path, entry: dict) -> None:
    with filepath.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def _read_entries(filepath: Path, limit: Optional[int] = None, since: Optional[float] = None) -> list[dict]:
    if not filepath.exists():
        return []
    entries = []
    with filepath.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                if since and entry.get("timestamp", 0) < since:
                    continue
                entries.append(entry)
            except json.JSONDecodeError:
                continue
    entries.reverse()
    if limit:
        entries = entries[:limit]
    return entries


# ── Handlers ───────────────────────────────────────────────────────────────

async def handle_track_metric(input_data: dict) -> str:
    user_id = input_data.get("userId", "").strip()
    metric_name = input_data.get("metric_name", "").strip()
    value = input_data.get("value")
    timestamp = input_data.get("timestamp", time.time())
    metadata = input_data.get("metadata", {})

    if not user_id:
        return json.dumps({"success": False, "error": "userId is required"})
    if not metric_name:
        return json.dumps({"success": False, "error": "metric_name is required"})
    if value is None:
        return json.dumps({"success": False, "error": "value is required"})
    try:
        value = float(value)
    except (ValueError, TypeError):
        return json.dumps({"success": False, "error": "value must be numeric"})

    if _use_cloud():
        # Insert into Supabase agent_metrics table
        from datetime import datetime, timezone
        ts = datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()
        row = {
            "user_id": user_id,
            "metric_name": metric_name,
            "value": value,
            "timestamp": ts,
            "metadata": metadata,
        }
        payload = json.dumps([row]).encode()
        status, body = _do_request(
            _rest_url(), "POST", data=payload,
            headers=_headers(prefer="return=representation")
        )
        if status >= 400:
            return json.dumps({"success": False, "error": f"DB error ({status}): {body}"})
        return json.dumps({
            "success": True,
            "metric_name": metric_name,
            "value": value,
            "timestamp": timestamp,
            "storage": "cloud",
        })

    # Local mode: JSONL
    entry = {"timestamp": timestamp, "value": value, "metadata": metadata}
    filepath = _get_metric_file(user_id, metric_name)
    _append_entry(filepath, entry)
    return json.dumps({
        "success": True,
        "metric_name": metric_name,
        "value": value,
        "timestamp": timestamp,
        "file": filepath.name,
    })


async def handle_get_metrics(input_data: dict) -> str:
    user_id = input_data.get("userId", "").strip()
    metric_name = input_data.get("metric_name", "").strip()
    limit = input_data.get("limit", 100)
    since = input_data.get("since")

    if not user_id:
        return json.dumps({"success": False, "error": "userId is required"})
    if not metric_name:
        return json.dumps({"success": False, "error": "metric_name is required"})

    if _use_cloud():
        # Query from Supabase
        params = {
            "user_id": f"eq.{user_id}",
            "metric_name": f"eq.{metric_name}",
            "order": "timestamp.desc",
            "limit": str(limit),
        }
        if since:
            from datetime import datetime, timezone
            since_ts = datetime.fromtimestamp(since, tz=timezone.utc).isoformat()
            params["timestamp"] = f"gte.{since_ts}"

        qs = urllib.parse.urlencode(params)
        url = f"{_rest_url()}?{qs}"
        status, body = _do_request(url, "GET", headers=_headers())
        if status >= 400:
            return json.dumps({"success": False, "error": f"DB error ({status}): {body}"})

        rows = json.loads(body)
        entries = [
            {"timestamp": r.get("timestamp"), "value": float(r["value"]), "metadata": r.get("metadata", {})}
            for r in rows
        ]

        if entries:
            values = [e["value"] for e in entries]
            stats = {
                "count": len(values),
                "latest": values[0],
                "min": min(values),
                "max": max(values),
                "mean": sum(values) / len(values),
            }
        else:
            stats = None

        return json.dumps({
            "success": True,
            "metric_name": metric_name,
            "entries": entries,
            "stats": stats,
        }, indent=2)

    # Local mode: JSONL
    filepath = _get_metric_file(user_id, metric_name)
    entries = _read_entries(filepath, limit=limit, since=since)

    if entries:
        values = [e["value"] for e in entries]
        stats = {
            "count": len(values),
            "latest": values[0],
            "min": min(values),
            "max": max(values),
            "mean": sum(values) / len(values),
        }
    else:
        stats = None

    return json.dumps({
        "success": True,
        "metric_name": metric_name,
        "entries": entries,
        "stats": stats,
    }, indent=2)


async def handle_list_metrics(input_data: dict) -> str:
    user_id = input_data.get("userId", "").strip()
    if not user_id:
        return json.dumps({"success": False, "error": "userId is required"})

    if _use_cloud():
        # Get distinct metric names with latest value and count
        # Use a query that gets all metrics for the user, then aggregate in Python
        params = {
            "user_id": f"eq.{user_id}",
            "select": "metric_name,value,timestamp",
            "order": "timestamp.desc",
            "limit": "10000",
        }
        qs = urllib.parse.urlencode(params)
        url = f"{_rest_url()}?{qs}"
        status, body = _do_request(url, "GET", headers=_headers())
        if status >= 400:
            return json.dumps({"success": False, "error": f"DB error ({status}): {body}"})

        rows = json.loads(body)
        # Group by metric_name
        metrics_map: dict[str, dict] = {}
        for r in rows:
            name = r["metric_name"]
            if name not in metrics_map:
                metrics_map[name] = {
                    "metric_name": name,
                    "count": 0,
                    "latest": {"timestamp": r["timestamp"], "value": float(r["value"])},
                }
            metrics_map[name]["count"] += 1

        return json.dumps({
            "success": True,
            "metrics": list(metrics_map.values()),
        }, indent=2)

    # Local mode: JSONL
    pattern = f"{user_id}_*.jsonl"
    metric_files = list(METRICS_DIR.glob(pattern))
    metrics = []
    for filepath in sorted(metric_files):
        name_part = filepath.stem.replace(f"{user_id}_", "")
        entries = _read_entries(filepath, limit=1)
        latest = entries[0] if entries else None
        with filepath.open("r", encoding="utf-8") as f:
            count = sum(1 for line in f if line.strip())
        metrics.append({
            "metric_name": name_part,
            "count": count,
            "latest": latest,
            "file": filepath.name,
        })

    return json.dumps({
        "success": True,
        "metrics": metrics,
    }, indent=2)


async def handle_delete_metric(input_data: dict) -> str:
    user_id = input_data.get("userId", "").strip()
    metric_name = input_data.get("metric_name", "").strip()

    if not user_id:
        return json.dumps({"success": False, "error": "userId is required"})
    if not metric_name:
        return json.dumps({"success": False, "error": "metric_name is required"})

    if _use_cloud():
        # Delete all entries for this metric from Supabase
        params = {
            "user_id": f"eq.{user_id}",
            "metric_name": f"eq.{metric_name}",
        }
        qs = urllib.parse.urlencode(params)
        url = f"{_rest_url()}?{qs}"
        status, body = _do_request(url, "DELETE", headers=_headers(prefer="return=representation"))
        if status >= 400:
            return json.dumps({"success": False, "error": f"DB error ({status}): {body}"})

        deleted = json.loads(body)
        return json.dumps({
            "success": True,
            "metric_name": metric_name,
            "deleted": True,
            "count": len(deleted),
        })

    # Local mode: JSONL
    filepath = _get_metric_file(user_id, metric_name)
    if not filepath.exists():
        return json.dumps({
            "success": False,
            "error": f"Metric '{metric_name}' not found",
        })
    filepath.unlink()
    return json.dumps({
        "success": True,
        "metric_name": metric_name,
        "deleted": True,
    })


# ── Tool definitions ────────────────────────────────────────────────────────

TOOL_DEFS = [
    {
        "name": "track_metric",
        "description": (
            "Log a timestamped numeric metric data point. Use for habit tracking "
            "(e.g. workouts, sleep hours), performance monitoring (e.g. benchmark times), "
            "or any quantifiable data you want to track over time."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "userId": {
                    "type": "string",
                    "description": "User ID (from system prompt)"
                },
                "metric_name": {
                    "type": "string",
                    "description": "Name/identifier for this metric (e.g. 'workout_duration', 'benchmark_ms')"
                },
                "value": {
                    "type": "number",
                    "description": "Numeric value to track"
                },
                "timestamp": {
                    "type": "number",
                    "description": "Optional unix timestamp (defaults to now)"
                },
                "metadata": {
                    "type": "object",
                    "description": "Optional arbitrary metadata (e.g. tags, notes, context)"
                }
            },
            "required": ["userId", "metric_name", "value"]
        }
    },
    {
        "name": "get_metrics",
        "description": (
            "Retrieve tracked metric data points. Returns recent entries with basic "
            "statistics (count, latest, min, max, mean). Use to review trends or "
            "analyze tracked data."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "userId": {
                    "type": "string",
                    "description": "User ID (from system prompt)"
                },
                "metric_name": {
                    "type": "string",
                    "description": "Name of metric to retrieve"
                },
                "limit": {
                    "type": "integer",
                    "description": "Max number of recent entries to return (default: 100)",
                    "default": 100
                },
                "since": {
                    "type": "number",
                    "description": "Optional unix timestamp - only return entries after this time"
                }
            },
            "required": ["userId", "metric_name"]
        }
    },
    {
        "name": "list_metrics",
        "description": (
            "List all tracked metrics for a user with summary info (count, latest value). "
            "Use to see what's being tracked."
        ),
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
    },
    {
        "name": "delete_metric",
        "description": (
            "Delete all data for a specific metric. Use when a metric is no longer "
            "needed or you want to start fresh."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "userId": {
                    "type": "string",
                    "description": "User ID (from system prompt)"
                },
                "metric_name": {
                    "type": "string",
                    "description": "Name of metric to delete"
                }
            },
            "required": ["userId", "metric_name"]
        }
    }
]

HANDLERS = {
    "track_metric": handle_track_metric,
    "get_metrics": handle_get_metrics,
    "list_metrics": handle_list_metrics,
    "delete_metric": handle_delete_metric,
}

READ_ONLY = {"get_metrics", "list_metrics"}
