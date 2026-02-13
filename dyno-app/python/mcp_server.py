"""
MCP-compliant JSON-RPC server wrapping existing Python tools.

Runs on ws://localhost:18790 and exposes all TOOL_HANDLERS as
MCP tools accessible by the Gateway's LegacyToolBridge.

Protocol: JSON-RPC 2.0 over WebSocket
- tools/list -> returns available tools with schemas and modes
- tools/call -> executes a tool and returns the result
"""

import asyncio
import json
import os
import sys
from pathlib import Path

import websockets
from websockets.http11 import Response
from websockets.datastructures import Headers
from http import HTTPStatus

# Ensure tools package is importable
sys.path.insert(0, str(Path(__file__).parent))

from tools import AGENT_TOOLS, TOOL_HANDLERS, READ_ONLY_TOOLS, reload_tools

PORT = int(os.getenv("MCP_PORT", "18790"))
HOST = os.getenv("MCP_HOST", "localhost")


def _build_tools_list() -> list[dict]:
    """Build the MCP tools list from loaded Python tools."""
    tools = []
    for tool_def in AGENT_TOOLS:
        tools.append({
            "name": tool_def["name"],
            "description": tool_def.get("description", ""),
            "input_schema": tool_def.get("input_schema", {"type": "object", "properties": {}}),
            "mode": "auto" if tool_def["name"] in READ_ONLY_TOOLS else "manual",
        })
    return tools


async def handle_rpc(websocket):
    """Handle JSON-RPC requests from the Gateway."""
    print(f"[mcp] Client connected from {websocket.remote_address}")

    async for raw in websocket:
        try:
            request = json.loads(raw)
        except json.JSONDecodeError:
            await websocket.send(json.dumps({
                "jsonrpc": "2.0",
                "error": {"code": -32700, "message": "Parse error"},
                "id": None,
            }))
            continue

        req_id = request.get("id")
        method = request.get("method", "")
        params = request.get("params", {})

        try:
            if method == "tools/list":
                # Reload tools to pick up any changes
                reload_tools()
                tools = _build_tools_list()
                await websocket.send(json.dumps({
                    "jsonrpc": "2.0",
                    "result": {"tools": tools},
                    "id": req_id,
                }))

            elif method == "tools/call":
                tool_name = params.get("name", "")
                tool_args = params.get("arguments", {})

                handler = TOOL_HANDLERS.get(tool_name)
                if not handler:
                    await websocket.send(json.dumps({
                        "jsonrpc": "2.0",
                        "error": {
                            "code": -32601,
                            "message": f"Unknown tool: {tool_name}",
                        },
                        "id": req_id,
                    }))
                    continue

                # Execute the tool handler
                try:
                    result = await handler(tool_args)
                    await websocket.send(json.dumps({
                        "jsonrpc": "2.0",
                        "result": result,
                        "id": req_id,
                    }))
                except Exception as e:
                    await websocket.send(json.dumps({
                        "jsonrpc": "2.0",
                        "error": {
                            "code": -32000,
                            "message": f"Tool execution error: {str(e)}",
                        },
                        "id": req_id,
                    }))

            else:
                await websocket.send(json.dumps({
                    "jsonrpc": "2.0",
                    "error": {
                        "code": -32601,
                        "message": f"Method not found: {method}",
                    },
                    "id": req_id,
                }))

        except Exception as e:
            print(f"[mcp] Error handling {method}: {e}")
            await websocket.send(json.dumps({
                "jsonrpc": "2.0",
                "error": {
                    "code": -32603,
                    "message": f"Internal error: {str(e)}",
                },
                "id": req_id,
            }))


def health_check(_connection, request):
    """HTTP health check on the same port."""
    if request.path == "/health":
        reload_tools()
        body = json.dumps({
            "status": "ok",
            "backend": "marty-mcp-server",
            "tools": len(AGENT_TOOLS),
        }).encode()
        return Response(
            HTTPStatus.OK,
            "OK",
            Headers([
                ("Content-Type", "application/json"),
                ("Content-Length", str(len(body))),
                ("Access-Control-Allow-Origin", "*"),
                ("Connection", "close"),
            ]),
            body,
        )
    return None


async def main():
    n = reload_tools()
    print(f"[mcp] Loaded {n} tools")

    async with websockets.serve(
        handle_rpc,
        HOST,
        PORT,
        process_request=health_check,
    ):
        print(f"MCP server running on ws://{HOST}:{PORT}")
        print(f"Health check at http://{HOST}:{PORT}/health")
        await asyncio.Future()  # Run forever


if __name__ == "__main__":
    asyncio.run(main())
