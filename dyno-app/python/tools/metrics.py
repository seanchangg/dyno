"""Metric tracking tool — log timestamped data points for habit tracking, performance monitoring, etc.

Stores metrics in JSONL format (one JSON object per line) for easy appending and streaming.
Each metric is namespaced by user_id and metric_name, with timestamp, value, and optional metadata.

Design principles:
- Simple, append-only structure (JSONL)
- Fast writes, easy queries
- Supports numeric values and arbitrary metadata
- Can be used for habits, performance metrics, system stats, etc.
"""

import json
import time
from pathlib import Path
from typing import Optional, Any

from ._common import DATA_DIR

METRICS_DIR = DATA_DIR / "metrics"
METRICS_DIR.mkdir(parents=True, exist_ok=True)


def _get_metric_file(user_id: str, metric_name: str) -> Path:
    """Get the JSONL file path for a specific metric."""
    # Sanitize metric_name to be filesystem-safe
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in metric_name)
    return METRICS_DIR / f"{user_id}_{safe_name}.jsonl"


def _append_entry(filepath: Path, entry: dict) -> None:
    """Append a JSON entry to a JSONL file."""
    with filepath.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def _read_entries(filepath: Path, limit: Optional[int] = None, since: Optional[float] = None) -> list[dict]:
    """Read entries from a JSONL file, optionally filtered by timestamp."""
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

    # Return most recent first
    entries.reverse()
    if limit:
        entries = entries[:limit]
    
    return entries


async def handle_track_metric(input_data: dict) -> str:
    """Log a timestamped metric data point.
    
    Args:
        input_data: {
            "userId": str - user ID
            "metric_name": str - name/identifier for this metric
            "value": float - numeric value to track
            "timestamp": float - optional unix timestamp (defaults to now)
            "metadata": dict - optional arbitrary metadata
        }
    """
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

    # Create entry
    entry = {
        "timestamp": timestamp,
        "value": value,
        "metadata": metadata,
    }

    # Append to metric file
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
    """Retrieve tracked metric data points.
    
    Args:
        input_data: {
            "userId": str - user ID
            "metric_name": str - name of metric to retrieve
            "limit": int - max number of recent entries (default: 100)
            "since": float - optional unix timestamp to filter entries after
        }
    """
    user_id = input_data.get("userId", "").strip()
    metric_name = input_data.get("metric_name", "").strip()
    limit = input_data.get("limit", 100)
    since = input_data.get("since")

    if not user_id:
        return json.dumps({"success": False, "error": "userId is required"})
    
    if not metric_name:
        return json.dumps({"success": False, "error": "metric_name is required"})

    filepath = _get_metric_file(user_id, metric_name)
    entries = _read_entries(filepath, limit=limit, since=since)

    # Calculate basic stats
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
    """List all tracked metrics for a user.
    
    Args:
        input_data: {
            "userId": str - user ID
        }
    """
    user_id = input_data.get("userId", "").strip()
    
    if not user_id:
        return json.dumps({"success": False, "error": "userId is required"})

    # Find all metric files for this user
    pattern = f"{user_id}_*.jsonl"
    metric_files = list(METRICS_DIR.glob(pattern))

    metrics = []
    for filepath in sorted(metric_files):
        # Parse metric name from filename
        name_part = filepath.stem.replace(f"{user_id}_", "")
        
        # Get latest entry
        entries = _read_entries(filepath, limit=1)
        latest = entries[0] if entries else None
        
        # Count total entries
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
    """Delete all data for a specific metric.
    
    Args:
        input_data: {
            "userId": str - user ID
            "metric_name": str - name of metric to delete
        }
    """
    user_id = input_data.get("userId", "").strip()
    metric_name = input_data.get("metric_name", "").strip()

    if not user_id:
        return json.dumps({"success": False, "error": "userId is required"})
    
    if not metric_name:
        return json.dumps({"success": False, "error": "metric_name is required"})

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
            "or any quantifiable data you want to track over time. Stores in append-only "
            "JSONL format for fast writes and easy analysis."
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
