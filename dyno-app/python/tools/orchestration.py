"""Child agent orchestration & dashboard layout — tool definitions.

All handlers are provided as context_handlers by ws_server.py (they need
access to the live SessionRegistry and WebSocket). This module only defines
the tool schemas so they appear in AGENT_TOOLS.
"""

TOOL_DEFS = [
    # ── Spawning & messaging ─────────────────────────────────────────────
    {
        "name": "spawn_agent",
        "description": (
            "Spawn a child agent to handle a sub-task independently. "
            "Choose model based on task complexity: "
            "claude-haiku-4-5-20251001 for simple/fast tasks, "
            "claude-sonnet-4-5-20250929 for moderate tasks, "
            "claude-opus-4-6 for complex reasoning. "
            "Returns immediately with a session ID. The child runs in the background."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "The task/prompt for the child agent"
                },
                "model": {
                    "type": "string",
                    "description": "Model to use (default: claude-sonnet-4-5-20250929)",
                    "default": "claude-sonnet-4-5-20250929"
                }
            },
            "required": ["prompt"]
        }
    },
    {
        "name": "send_to_session",
        "description": (
            "Send a follow-up message to a completed child session, continuing "
            "its conversation. The child must be in 'completed' status."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "The child session ID to message"
                },
                "message": {
                    "type": "string",
                    "description": "Follow-up message/prompt for the child"
                }
            },
            "required": ["session_id", "message"]
        }
    },
    # ── Monitoring ────────────────────────────────────────────────────────
    {
        "name": "list_children",
        "description": (
            "List all child agent sessions with their status, model, token usage, "
            "and a preview of their prompt. Useful for monitoring progress."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "status_filter": {
                    "type": "string",
                    "enum": ["all", "running", "completed", "error", "terminated"],
                    "description": "Filter by status (default: all)",
                    "default": "all"
                }
            }
        }
    },
    {
        "name": "get_session_status",
        "description": (
            "Get detailed status of a specific child session including its result, "
            "token usage, and model."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "Session ID to check"
                }
            },
            "required": ["session_id"]
        }
    },
    {
        "name": "get_child_details",
        "description": (
            "Get full details of a child session including its result text. "
            "Use after a child completes to read what it produced."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "Session ID to inspect"
                }
            },
            "required": ["session_id"]
        }
    },
    # ── Control ───────────────────────────────────────────────────────────
    {
        "name": "terminate_child",
        "description": (
            "Force-terminate a running child session. Use when a child is stuck, "
            "taking too long, or no longer needed."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "Session ID to terminate"
                }
            },
            "required": ["session_id"]
        }
    },
    # ── Dashboard layout ──────────────────────────────────────────────────
    {
        "name": "get_dashboard_layout",
        "description": (
            "Get the current dashboard layout — returns all widgets with their IDs, "
            "types, grid positions (x, y), sizes (w, h), and props. Use this before "
            "moving, removing, or rearranging widgets so you know what exists and "
            "where everything is. The dashboard is a 12-column grid with 60px row height."
        ),
        "input_schema": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "ui_action",
        "description": (
            "Mutate the dashboard layout. Use get_dashboard_layout first to see "
            "current widgets and their IDs.\n\n"
            "Actions:\n"
            "- add: Create a new widget. Requires widgetType. Optional: position, size, props, sessionId.\n"
            "- remove: Delete a widget by its widgetId.\n"
            "- update: Change a widget's props (e.g. title, dataSource). Merges with existing props.\n"
            "- move: Reposition a widget on the grid. Requires position {x, y}.\n"
            "- resize: Change a widget's dimensions. Requires size {w, h}.\n"
            "- reset: Restore the default layout (widgetId can be 'default').\n\n"
            "Grid: 12 columns, rows are 60px tall, 16px gaps.\n\n"
            "Widget types and their default/min sizes:\n"
            "- chat: 7x8 (min 4x4, max 12x20) — agent conversation\n"
            "- stat-card: 3x2 (min 2x2, max 6x4) — metrics display. Props: {title, dataSource}. "
            "dataSource options: 'agent-status', 'sessions', 'token-usage', 'cost'\n"
            "- memory-table: 7x5 (min 4x3, max 12x12) — memory viewer\n"
            "- screenshot-gallery: 5x5 (min 3x3, max 12x12) — screenshot browser\n"
            "- markdown: 4x4 (min 2x2, max 12x20) — render markdown. Props: {content}\n"
            "- code-block: 6x4 (min 3x2, max 12x16) — display code. Props: {code, language}\n"
            "- image: 4x4 (min 2x2, max 12x12) — display image. Props: {src, alt}\n"
            "- table: 6x4 (min 3x2, max 12x16) — tabular data. Props: {columns, rows}\n"
            "- html: 6x5 (min 2x2, max 12x20) — render arbitrary HTML/JS in sandboxed iframe. "
            "Props: {html} for inline HTML, or {src} for a URL (e.g. /api/widget-html/chart.html). "
            "Bot can write HTML files to data/widgets/ then reference them here.\n"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["add", "remove", "update", "move", "resize", "reset"],
                    "description": "Action to perform on the dashboard"
                },
                "widgetId": {
                    "type": "string",
                    "description": (
                        "Target widget ID. Use get_dashboard_layout to see existing IDs. "
                        "For 'add', use a unique descriptive ID like 'my-notes' or 'task-list'. "
                        "For 'clear'/'reset', use any value (e.g. 'all' or 'default')."
                    )
                },
                "widgetType": {
                    "type": "string",
                    "enum": [
                        "chat", "stat-card", "memory-table", "screenshot-gallery",
                        "markdown", "code-block", "image", "table", "html"
                    ],
                    "description": "Widget type (required for 'add')"
                },
                "position": {
                    "type": "object",
                    "properties": {
                        "x": {"type": "integer", "description": "Column (0-11)"},
                        "y": {"type": "integer", "description": "Row"}
                    },
                    "description": "Grid position (for 'add' and 'move')"
                },
                "size": {
                    "type": "object",
                    "properties": {
                        "w": {"type": "integer", "description": "Width in columns (1-12)"},
                        "h": {"type": "integer", "description": "Height in rows"}
                    },
                    "description": "Grid size (for 'add' and 'resize')"
                },
                "props": {
                    "type": "object",
                    "description": "Widget-specific properties (for 'add' and 'update')"
                },
                "sessionId": {
                    "type": "string",
                    "description": "Session ID to link to (for chat widgets)"
                }
            },
            "required": ["action", "widgetId"]
        }
    },
]

# No HANDLERS — all orchestration handlers are context_handlers from ws_server.py
HANDLERS = {}

# Read-only tools that can be auto-executed without user approval
READ_ONLY = {"list_children", "get_session_status", "get_child_details", "get_dashboard_layout"}
