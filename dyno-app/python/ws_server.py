"""
WebSocket server bridging AgentCore to the web dashboard.

One persistent WebSocket connection per browser tab.
The connection stays alive across multiple user messages.
Children persist until the connection closes.

Runs on ws://localhost:8765.
Health check at http://localhost:8765/health (same port).
"""

import asyncio
import json
import time
from http import HTTPStatus
from anthropic import Anthropic
import websockets
from websockets.http11 import Response
from websockets.datastructures import Headers
from pathlib import Path as _Path

from agent_core import AgentCore, get_system_prompt, get_base_prompt, TOOL_DESCRIPTIONS_APPENDIX, DEFAULT_MODEL
from tools import AGENT_TOOLS, TOOL_HANDLERS, READ_ONLY_TOOLS, reload_tools
from tools.memories import set_user_id
from session_registry import SessionRegistry

# ─── Permission overrides (persisted by Next.js API, read by Python) ────────

_PERM_OVERRIDES_PATH = _Path(__file__).resolve().parent.parent / "data" / "config" / "tool-permissions.json"


def _load_permission_overrides() -> dict[str, str]:
    """Load tool permission overrides from the shared config file."""
    try:
        return json.loads(_PERM_OVERRIDES_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _effective_tool_mode(tool_name: str, overrides: dict[str, str]) -> str:
    """Compute the effective mode for a tool: override > READ_ONLY_TOOLS > manual."""
    if tool_name in overrides:
        return overrides[tool_name]
    if tool_name in READ_ONLY_TOOLS:
        return "auto"
    return "manual"

# Track active connections and tasks for health reporting
active_connections = 0
active_tasks = 0
server_start_time = 0

# Track active registries for child session counting in health endpoint
_active_registries: set[SessionRegistry] = set()


def _compute_overhead():
    """Compute the character counts of static payload components."""
    base = get_base_prompt()
    system_no_tools = base
    system_with_tools = f"{base}\n\n{TOOL_DESCRIPTIONS_APPENDIX}"
    tools_json = json.dumps(AGENT_TOOLS)
    return {
        "systemChars": len(system_no_tools),
        "systemWithToolsChars": len(system_with_tools),
        "toolDefsChars": len(tools_json),
    }


def health_check(_connection, request):
    """Handle HTTP health requests on the same port as WebSocket."""
    if request.path == "/health":
        reload_tools()
        overhead = _compute_overhead()
        perm_overrides = _load_permission_overrides()
        tools_list = [
            {
                "name": t["name"],
                "description": t.get("description", ""),
                "mode": _effective_tool_mode(t["name"], perm_overrides),
                "overridden": t["name"] in perm_overrides,
            }
            for t in AGENT_TOOLS
        ]
        active_child_sessions = sum(len(r.sessions) for r in _active_registries)
        body = json.dumps({
            "status": "ok",
            "uptime": int(time.time() - server_start_time),
            "activeConnections": active_connections,
            "activeTasks": active_tasks,
            "activeChildSessions": active_child_sessions,
            "overhead": overhead,
            "tools": tools_list,
        }).encode()
        return Response(
            HTTPStatus.OK,
            "OK",
            Headers([
                ("Content-Type", "application/json"),
                ("Content-Length", str(len(body))),
                ("Connection", "close"),
                ("Access-Control-Allow-Origin", "*"),
            ]),
            body,
        )
    return None


def _augment_prompt_with_attachments(prompt: str, attachments: list) -> str:
    """Append an 'Attached Context' section to the prompt if attachments exist."""
    if not attachments:
        return prompt
    lines = ["\n\n## Attached Context"]
    for att in attachments:
        att_type = att.get("type", "")
        if att_type == "file":
            name = att.get("name", "unknown")
            lines.append(f"- Uploaded file: `{name}` (use read_upload tool to read it)")
        elif att_type == "url":
            url = att.get("url", "")
            lines.append(f"- URL: {url} (use fetch_url tool to fetch it)")
    return prompt + "\n".join(lines)


async def _send(websocket, payload: dict):
    """Send a JSON message with sessionId defaulting to 'master'."""
    if "sessionId" not in payload:
        payload["sessionId"] = "master"
    await websocket.send(json.dumps(payload))


# ─── Persistent connection handler ───────────────────────────────────────────


async def handle_session(websocket):
    """Handle a persistent WebSocket connection.

    One connection = one SessionRegistry (shared across all messages).
    The main loop reads all messages and dispatches to handlers.
    Chat/build handlers run as tasks; approve/deny/cancel are routed here.
    """
    global active_connections
    active_connections += 1
    n = reload_tools()
    print(f"[ws] New connection from {websocket.remote_address} (connections: {active_connections}, {n} tools)")

    registry = SessionRegistry()
    _active_registries.add(registry)
    pending_proposals: dict[str, asyncio.Future] = {}
    master_task: asyncio.Task | None = None
    user_id: str | None = None

    try:
        async for raw in websocket:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type")

            # Track user_id from any message
            if msg.get("userId"):
                user_id = msg["userId"]
                set_user_id(user_id)

            if msg_type == "ping":
                await _send(websocket, {
                    "type": "pong",
                    "uptime": int(time.time() - server_start_time),
                    "activeTasks": active_tasks,
                })

            elif msg_type == "chat":
                if master_task and not master_task.done():
                    await _send(websocket, {
                        "type": "error",
                        "message": "Agent is already processing a request.",
                    })
                    continue
                pending_proposals.clear()
                master_task = asyncio.create_task(
                    _run_chat(websocket, msg, registry, pending_proposals, user_id)
                )

            elif msg_type == "start":
                if master_task and not master_task.done():
                    await _send(websocket, {
                        "type": "error",
                        "message": "Agent is already processing.",
                    })
                    continue
                pending_proposals.clear()
                master_task = asyncio.create_task(
                    _run_build(websocket, msg, registry, pending_proposals, user_id)
                )

            elif msg_type == "plan":
                await handle_plan(websocket, msg)

            elif msg_type in ("approve", "deny"):
                proposal_id = msg.get("id")
                future = pending_proposals.pop(proposal_id, None)
                if future and not future.done():
                    future.set_result({
                        "approved": msg_type == "approve",
                        "editedInput": msg.get("editedInput"),
                    })

            elif msg_type == "cancel":
                session_id = msg.get("sessionId", "master")
                if session_id == "master":
                    for f in pending_proposals.values():
                        if not f.done():
                            f.set_result({"approved": False})
                    pending_proposals.clear()
                    if master_task and not master_task.done():
                        master_task.cancel()

            elif msg_type == "child_chat":
                target_id = msg.get("sessionId", "")
                message = msg.get("message", "").strip()
                api_key = msg.get("apiKey", "").strip()
                if not target_id or not message:
                    await _send(websocket, {
                        "type": "error",
                        "sessionId": target_id or "master",
                        "message": "sessionId and message are required",
                    })
                    continue
                entry = registry.get_session(target_id)
                if not entry:
                    await _send(websocket, {
                        "type": "error",
                        "sessionId": target_id,
                        "message": f"Session {target_id} not found",
                    })
                    continue
                if entry.status not in ("completed", "error"):
                    await _send(websocket, {
                        "type": "error",
                        "sessionId": target_id,
                        "message": f"Session {target_id} is {entry.status}, wait for it to finish",
                    })
                    continue
                # Run continuation as a task
                asyncio.create_task(
                    _run_child_chat(websocket, registry, entry, message, api_key or None, user_id)
                )

            elif msg_type == "cancel_session":
                target_id = msg.get("sessionId", "")
                print(f"[child] {target_id} terminated by user")
                registry.terminate_child(target_id)
                entry = registry.get_session(target_id)
                await _send(websocket, {
                    "type": "session_ended",
                    "sessionId": target_id,
                    "status": "terminated",
                    "result": None,
                    "tokensIn": entry.tokens_in if entry else 0,
                    "tokensOut": entry.tokens_out if entry else 0,
                    "model": entry.model if entry else "",
                })

    except websockets.exceptions.ConnectionClosed:
        print("[ws] Connection closed")
        for f in pending_proposals.values():
            if not f.done():
                f.set_result({"approved": False})
    except Exception as e:
        print(f"[ws] Unexpected error: {e}")
    finally:
        # Cancel master if still running
        if master_task and not master_task.done():
            master_task.cancel()
            try:
                await master_task
            except (asyncio.CancelledError, Exception):
                pass
        # Cleanup children
        child_count = len(registry.sessions)
        if child_count > 0:
            print(f"[child] Cleaning up {child_count} child session(s)")
        registry.cleanup()
        _active_registries.discard(registry)
        active_connections -= 1
        print(f"[ws] Session ended (connections: {active_connections})")


# ─── Chat handler (runs as a task) ──────────────────────────────────────────


ACTIVATE_TOOLS_DEF = {
    "name": "activate_tools",
    "description": (
        "Call this tool when you need to perform actions such as reading/writing files, "
        "querying or modifying the database (db_query, db_insert, db_update, db_delete), "
        "installing packages, taking screenshots, fetching URLs, managing memories, "
        "spawning child agents, or controlling the dashboard layout. "
        "This activates your full toolkit for the current task. "
        "Do NOT call this for simple conversation, questions, or explanations — "
        "only when the user's request requires you to interact with the filesystem, "
        "database, external resources, or dashboard."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "description": "Brief reason why tools are needed for this task",
            }
        },
        "required": ["reason"],
    },
}


async def _run_chat(websocket, data, registry, pending_proposals, user_id):
    """Handle a chat message with automatic tool activation.

    Runs as a task. The main loop routes approve/deny/cancel to pending_proposals.

    Phase 1 (lightweight): Claude gets conversation history + activate_tools gate.
    If Claude responds with text, we're done. If it calls activate_tools → Phase 2.

    Phase 2 (full): AgentCore agentic loop with all tools + proposals.
    """
    global active_tasks
    active_tasks += 1
    try:
        await _run_chat_inner(websocket, data, registry, pending_proposals, user_id)
    finally:
        active_tasks -= 1


async def _run_chat_inner(websocket, data, registry, pending_proposals, user_id):
    prompt = data.get("prompt", "").strip()
    api_key = data.get("apiKey", "").strip()
    history = data.get("history", [])
    model = data.get("model")
    include_system_context = data.get("includeSystemContext", True)
    memory_context = data.get("memoryContext", "").strip()
    screenshot_urls = data.get("screenshotUrls", [])

    if not prompt or not api_key:
        await _send(websocket, {"type": "error", "message": "prompt and apiKey are required"})
        return

    if user_id:
        set_user_id(user_id)

    if memory_context:
        prompt = f"## User's Selected Memories\n{memory_context}\n\n---\n\n{prompt}"

    system_prompt = ""
    if include_system_context:
        system_prompt = get_base_prompt()
    if user_id:
        system_prompt += f"\n\nThe current user's ID is: {user_id}"

    chat_history = [{"role": m["role"], "content": m["content"]} for m in history]

    # Build user message content — include screenshot image blocks if provided
    if screenshot_urls:
        user_content = []
        user_content.append({"type": "text", "text": "## User's Selected Screenshots\nThe following screenshots are attached for visual context:\n"})
        for url in screenshot_urls:
            user_content.append({"type": "image", "source": {"type": "url", "url": url}})
        user_content.append({"type": "text", "text": prompt})
        messages = chat_history + [{"role": "user", "content": user_content}]
    else:
        messages = chat_history + [{"role": "user", "content": prompt}]

    print(f"[chat] Phase 1: {prompt[:80]}...")

    client = Anthropic(api_key=api_key)

    try:
        phase1_kwargs = dict(
            model=model or DEFAULT_MODEL,
            max_tokens=8192,
            messages=messages,
            tools=[ACTIVATE_TOOLS_DEF],
        )
        if system_prompt:
            phase1_kwargs["system"] = system_prompt

        response = await asyncio.to_thread(
            client.messages.create,
            **phase1_kwargs,
        )
    except asyncio.CancelledError:
        print("[chat] Cancelled during Phase 1")
        return
    except Exception as e:
        await _send(websocket, {"type": "error", "message": str(e)})
        return

    phase1_in = response.usage.input_tokens if response.usage else 0
    phase1_out = response.usage.output_tokens if response.usage else 0

    tool_use = None
    text_parts: list[str] = []
    for block in response.content:
        if block.type == "tool_use" and block.name == "activate_tools":
            tool_use = block
        elif block.type == "text":
            text_parts.append(block.text)

    if not tool_use:
        text = "".join(text_parts) or "No response."
        await _send(websocket, {
            "type": "chat_response",
            "response": text,
            "tokensIn": phase1_in,
            "tokensOut": phase1_out,
        })
        return

    # ── Phase 2: Full agentic loop with all tools ──
    reason = tool_use.input.get("reason", "")
    print(f"[chat] Phase 2 activated: {reason}")

    await _send(websocket, {
        "type": "thinking",
        "text": f"Activating tools: {reason}",
    })

    full_system = f"{system_prompt}\n\n{TOOL_DESCRIPTIONS_APPENDIX}" if system_prompt else get_system_prompt()

    context_handlers = _make_orchestration_handlers(registry, websocket, api_key, user_id)
    core = AgentCore(
        api_key=api_key,
        model=model,
        session_id="master",
        context_handlers=context_handlers,
        permission_overrides=_load_permission_overrides(),
    )

    # Build Phase 2 history: chat_history + Phase 1's assistant response (with
    # activate_tools call) + the tool result, so Claude has full context of what
    # it already reasoned about without re-processing the prompt from scratch.
    phase2_history = list(chat_history)

    # Serialize Phase 1 assistant response
    p1_assistant_content = []
    for block in response.content:
        if block.type == "text":
            p1_assistant_content.append({"type": "text", "text": block.text})
        elif block.type == "tool_use":
            p1_assistant_content.append({
                "type": "tool_use",
                "id": block.id,
                "name": block.name,
                "input": block.input,
            })
    if p1_assistant_content:
        phase2_history.append({"role": "assistant", "content": p1_assistant_content})
        # Add the activate_tools result so the conversation is well-formed
        phase2_history.append({"role": "user", "content": [
            {
                "type": "tool_result",
                "tool_use_id": tool_use.id,
                "content": f"Tools activated. Reason: {reason}",
            }
        ]})

    async def on_event(event_type: str, payload: dict):
        payload["sessionId"] = "master"

        if event_type == "proposal":
            future = asyncio.get_event_loop().create_future()
            pending_proposals[payload["id"]] = future
            await _send(websocket, {"type": "proposal", **payload})
            decision = await future
            return decision
        elif event_type == "done":
            await _send(websocket, {
                "type": "chat_response",
                "sessionId": "master",
                "response": payload.get("summary", "Done."),
                "tokensIn": payload.get("tokensIn", 0) + phase1_in,
                "tokensOut": payload.get("tokensOut", 0) + phase1_out,
            })
        else:
            await _send(websocket, {"type": event_type, **payload})
        return None

    try:
        await core.run_build(
            prompt,
            on_event,
            history=phase2_history,
            system_prompt=full_system,
        )
    except asyncio.CancelledError:
        print("[chat] Master cancelled")
        try:
            await _send(websocket, {
                "type": "chat_response",
                "sessionId": "master",
                "response": "Cancelled.",
                "tokensIn": core.total_tokens_in + phase1_in,
                "tokensOut": core.total_tokens_out + phase1_out,
            })
        except Exception:
            pass
    except websockets.exceptions.ConnectionClosed:
        print("[chat] Connection closed during chat")
    except Exception as e:
        print(f"[chat] Error: {e}")
        try:
            await _send(websocket, {"type": "error", "message": str(e)})
        except Exception:
            pass


# ─── Build handler (runs as a task) ──────────────────────────────────────────


async def _run_build(websocket, data, registry, pending_proposals, user_id):
    """Handle a build request as a task."""
    global active_tasks
    active_tasks += 1
    try:
        await _run_build_inner(websocket, data, registry, pending_proposals, user_id)
    finally:
        active_tasks -= 1


async def _run_build_inner(websocket, data, registry, pending_proposals, user_id):
    prompt = data.get("prompt", "").strip()
    api_key = data.get("apiKey", "").strip()
    model = data.get("model")
    attachments = data.get("attachments", [])
    if not prompt:
        await _send(websocket, {"type": "error", "message": "prompt is required"})
        return
    if not api_key:
        await _send(websocket, {"type": "error", "message": "apiKey is required"})
        return

    prompt = _augment_prompt_with_attachments(prompt, attachments)

    # Load persisted permission overrides from shared config file
    permission_overrides = _load_permission_overrides()

    if permission_overrides:
        print(f"[ws] Starting build with {len(permission_overrides)} permission override(s): {prompt[:80]}...")
    else:
        print(f"[ws] Starting build: {prompt[:80]}...")

    context_handlers = _make_orchestration_handlers(registry, websocket, api_key, user_id)
    core = AgentCore(
        api_key=api_key,
        model=model,
        session_id="master",
        context_handlers=context_handlers,
        permission_overrides=permission_overrides,
    )
    build_system = None
    if user_id:
        build_system = get_system_prompt() + f"\n\nThe current user's ID is: {user_id}"

    async def on_event(event_type: str, payload: dict):
        payload["sessionId"] = "master"

        if event_type == "proposal":
            future = asyncio.get_event_loop().create_future()
            pending_proposals[payload["id"]] = future
            await _send(websocket, {"type": "proposal", **payload})
            decision = await future
            return decision
        else:
            await _send(websocket, {"type": event_type, **payload})
            return None

    try:
        await core.run_build(prompt, on_event, system_prompt=build_system)
    except asyncio.CancelledError:
        print("[ws] Build cancelled")
    except websockets.exceptions.ConnectionClosed:
        print("[ws] Connection closed during build")
    except Exception as e:
        print(f"[ws] Build error: {e}")
        try:
            await _send(websocket, {"type": "error", "message": str(e)})
        except Exception:
            pass


# ─── Child chat handler (user talking to a child) ────────────────────────────


async def _run_child_chat(websocket, registry, entry, message, api_key, user_id):
    """Continue a completed child session with a user follow-up message."""
    global active_tasks
    active_tasks += 1
    session_id = entry.session_id

    print(f"[child] {session_id} user follow-up: {message[:80]}...")

    child_system = get_system_prompt()
    if user_id:
        child_system += f"\n\nThe current user's ID is: {user_id}"

    async def child_on_event(event_type: str, payload: dict):
        payload["sessionId"] = session_id
        payload["model"] = entry.model
        try:
            await _send(websocket, {"type": event_type, **payload})
        except Exception:
            pass
        return None

    entry.status = "running"

    # Notify frontend the child is active again
    store_update = {
        "type": "session_status",
        "sessionId": session_id,
        "status": "running",
    }
    try:
        await _send(websocket, store_update)
    except Exception:
        pass

    try:
        # If api_key was provided, update the child's client
        if api_key:
            entry.agent_core.client = Anthropic(api_key=api_key)

        await entry.agent_core.run_build(
            message,
            child_on_event,
            history=entry.agent_core.messages,
            system_prompt=child_system,
        )
        entry.status = "completed"
        for msg in reversed(entry.agent_core.messages):
            if msg.get("role") == "assistant":
                content = msg.get("content", "")
                if isinstance(content, list):
                    texts = [b.get("text", "") for b in content if b.get("type") == "text"]
                    entry.result = " ".join(texts)[:500]
                elif isinstance(content, str):
                    entry.result = content[:500]
                break
    except asyncio.CancelledError:
        entry.status = "terminated"
    except Exception as e:
        entry.status = "error"
        entry.result = str(e)
        try:
            await _send(websocket, {
                "type": "error",
                "sessionId": session_id,
                "message": f"Child {session_id} error: {str(e)}",
            })
        except Exception:
            pass
    finally:
        active_tasks -= 1
        # Send status update — NOT session_ended (the child stays alive for more follow-ups)
        try:
            await _send(websocket, {
                "type": "session_status",
                "sessionId": session_id,
                "status": entry.status,
            })
        except Exception:
            pass
        print(f"[child] {session_id} follow-up ended: {entry.status}")


# ─── Orchestration tool handlers ─────────────────────────────────────────────


def _make_orchestration_handlers(
    registry: SessionRegistry,
    websocket,
    api_key: str,
    user_id: str | None,
) -> dict:
    """Create closure-based orchestration tool handlers for a connection."""

    async def handle_spawn_agent(tool_input: dict) -> str:
        model = tool_input.get("model", "claude-sonnet-4-5-20250929")
        prompt = tool_input.get("prompt", "")
        custom_id = tool_input.get("session_id")

        if not prompt:
            return "Error: prompt is required"

        print(f"[child] Spawning child (model={model}): {prompt[:80]}...")

        # Build system prompt for child (no orchestration tools)
        child_system = get_system_prompt()
        if user_id:
            child_system += f"\n\nThe current user's ID is: {user_id}"

        # Build child tools list (standard tools only, no orchestration)
        from tools.orchestration import TOOL_DEFS as ORCH_DEFS
        orch_names = {d["name"] for d in ORCH_DEFS}
        child_tools = [t for t in AGENT_TOOLS if t["name"] not in orch_names]

        async def child_on_event(event_type: str, payload: dict):
            """Route child events through the master WS, tagged with child sessionId."""
            payload["sessionId"] = session_id
            payload["model"] = model
            try:
                await _send(websocket, {"type": event_type, **payload})
            except Exception:
                pass
            return None

        try:
            session_id = registry.create_child(
                api_key=api_key,
                model=model,
                prompt=prompt,
                on_event=child_on_event,
                tools_override=child_tools,
                system_prompt=child_system,
            )

            if custom_id:
                # If they wanted a custom ID, we still use the generated one
                pass

            print(f"[child] {session_id} created (model={model})")

            # Notify frontend about new session
            await _send(websocket, {
                "type": "session_created",
                "sessionId": session_id,
                "model": model,
                "prompt": prompt[:200],
            })

            # Set up a callback to notify when child completes
            async def watch_child():
                entry = registry.get_session(session_id)
                if entry and not entry.task.done():
                    try:
                        await entry.task
                    except (asyncio.CancelledError, Exception):
                        pass
                entry = registry.get_session(session_id)
                if entry:
                    result_preview = (entry.result or "")[:100]
                    print(f"[child] {session_id} ended: status={entry.status}, tokens={entry.tokens_in}/{entry.tokens_out}, result={result_preview!r}")
                    try:
                        await _send(websocket, {
                            "type": "session_ended",
                            "sessionId": session_id,
                            "status": entry.status,
                            "result": entry.result,
                            "tokensIn": entry.tokens_in,
                            "tokensOut": entry.tokens_out,
                            "model": entry.model,
                        })
                    except Exception:
                        pass

            asyncio.create_task(watch_child())

            return json.dumps({
                "sessionId": session_id,
                "status": "running",
                "model": model,
            })
        except RuntimeError as e:
            return f"Error: {str(e)}"

    async def handle_ui_action(tool_input: dict) -> str:
        action = tool_input.get("action", "")
        widget_id = tool_input.get("widgetId", "")

        if not action or not widget_id:
            return "Error: action and widgetId are required"

        # Forward as ui_mutation event to frontend
        await _send(websocket, {
            "type": "ui_mutation",
            "sessionId": "master",
            "action": action,
            "widgetId": widget_id,
            "widgetType": tool_input.get("widgetType"),
            "position": tool_input.get("position"),
            "size": tool_input.get("size"),
            "props": tool_input.get("props"),
        })

        return json.dumps({"status": "ok", "action": action, "widgetId": widget_id})

    async def handle_send_to_session(tool_input: dict) -> str:
        session_id = tool_input.get("session_id", "")
        message = tool_input.get("message", "")

        if not session_id or not message:
            return "Error: session_id and message are required"

        entry = registry.get_session(session_id)
        if not entry:
            return f"Error: session {session_id} not found"

        if entry.status != "completed":
            return f"Error: session {session_id} is {entry.status}, not completed"

        # Continue the conversation on the child's AgentCore
        child_system = get_system_prompt()
        if user_id:
            child_system += f"\n\nThe current user's ID is: {user_id}"

        async def child_on_event(event_type: str, payload: dict):
            payload["sessionId"] = session_id
            payload["model"] = entry.model
            try:
                await _send(websocket, {"type": event_type, **payload})
            except Exception:
                pass
            return None

        entry.status = "running"

        from tools.orchestration import TOOL_DEFS as ORCH_DEFS
        orch_names = {d["name"] for d in ORCH_DEFS}
        child_tools = [t for t in AGENT_TOOLS if t["name"] not in orch_names]

        async def run_continuation():
            try:
                await entry.agent_core.run_build(
                    message,
                    child_on_event,
                    history=entry.agent_core.messages,
                    system_prompt=child_system,
                )
                entry.status = "completed"
                for msg in reversed(entry.agent_core.messages):
                    if msg.get("role") == "assistant":
                        content = msg.get("content", "")
                        if isinstance(content, list):
                            texts = [b.get("text", "") for b in content if b.get("type") == "text"]
                            entry.result = " ".join(texts)[:500]
                        elif isinstance(content, str):
                            entry.result = content[:500]
                        break
            except Exception as e:
                entry.status = "error"
                entry.result = str(e)
            finally:
                try:
                    await _send(websocket, {
                        "type": "session_ended",
                        "sessionId": session_id,
                        "status": entry.status,
                        "result": entry.result,
                        "tokensIn": entry.agent_core.total_tokens_in,
                        "tokensOut": entry.agent_core.total_tokens_out,
                        "model": entry.model,
                    })
                except Exception:
                    pass

        entry.task = asyncio.create_task(run_continuation())

        return json.dumps({
            "sessionId": session_id,
            "status": "running",
        })

    async def handle_get_session_status(tool_input: dict) -> str:
        session_id = tool_input.get("session_id", "")

        if not session_id:
            return "Error: session_id is required"

        entry = registry.get_session(session_id)
        if not entry:
            return json.dumps({"error": f"session {session_id} not found"})

        return json.dumps({
            "sessionId": entry.session_id,
            "status": entry.status,
            "model": entry.model,
            "tokensIn": entry.tokens_in,
            "tokensOut": entry.tokens_out,
            "result": entry.result,
            "prompt": entry.prompt[:200],
        })

    async def handle_list_children(tool_input: dict) -> str:
        status_filter = tool_input.get("status_filter", "all")
        sessions = registry.list_sessions()

        if status_filter != "all":
            sessions = [s for s in sessions if s.get("status") == status_filter]

        if not sessions:
            return json.dumps({"sessions": [], "count": 0, "filter": status_filter})

        return json.dumps({
            "sessions": sessions,
            "count": len(sessions),
            "filter": status_filter,
        })

    async def handle_get_child_details(tool_input: dict) -> str:
        session_id = tool_input.get("session_id", "")
        if not session_id:
            return "Error: session_id is required"

        entry = registry.get_session(session_id)
        if not entry:
            return json.dumps({"error": f"Session {session_id} not found"})

        return json.dumps({
            "sessionId": entry.session_id,
            "status": entry.status,
            "model": entry.model,
            "prompt": entry.prompt,
            "result": entry.result,
            "tokensIn": entry.tokens_in,
            "tokensOut": entry.tokens_out,
            "createdAt": entry.created_at,
        })

    async def handle_terminate_child(tool_input: dict) -> str:
        session_id = tool_input.get("session_id", "")
        if not session_id:
            return "Error: session_id is required"

        entry = registry.get_session(session_id)
        if not entry:
            return json.dumps({"error": f"Session {session_id} not found"})

        if entry.status in ("completed", "terminated", "error"):
            return json.dumps({
                "error": f"Session {session_id} is already {entry.status}",
            })

        registry.terminate_child(session_id)

        try:
            await _send(websocket, {
                "type": "session_ended",
                "sessionId": session_id,
                "status": "terminated",
                "result": None,
                "tokensIn": entry.tokens_in,
                "tokensOut": entry.tokens_out,
                "model": entry.model,
            })
        except Exception:
            pass

        return json.dumps({
            "sessionId": session_id,
            "status": "terminated",
        })

    async def handle_get_dashboard_layout(tool_input: dict) -> str:
        """Fetch the current dashboard layout from the Next.js API."""
        import urllib.request
        import urllib.error

        try:
            req = urllib.request.Request(
                "http://localhost:3000/api/layout",
                headers={"Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))

            widgets = data.get("widgets", [])
            if not widgets:
                return json.dumps({
                    "widgets": [],
                    "count": 0,
                    "note": "Dashboard is empty. Use ui_action with action='reset' to restore defaults.",
                })

            # Summarize each widget clearly
            summary = []
            for w in widgets:
                entry = {
                    "id": w.get("id"),
                    "type": w.get("type"),
                    "position": {"x": w.get("x", 0), "y": w.get("y", 0)},
                    "size": {"w": w.get("w", 4), "h": w.get("h", 4)},
                }
                if w.get("props"):
                    entry["props"] = w["props"]
                if w.get("sessionId"):
                    entry["sessionId"] = w["sessionId"]
                summary.append(entry)

            return json.dumps({
                "widgets": summary,
                "count": len(summary),
                "grid": {"columns": 12, "rowHeight": 60, "gap": 16},
            })
        except urllib.error.URLError as e:
            return json.dumps({"error": f"Could not reach dashboard API: {e}"})
        except Exception as e:
            return json.dumps({"error": str(e)})

    return {
        "spawn_agent": handle_spawn_agent,
        "ui_action": handle_ui_action,
        "send_to_session": handle_send_to_session,
        "get_session_status": handle_get_session_status,
        "list_children": handle_list_children,
        "get_child_details": handle_get_child_details,
        "terminate_child": handle_terminate_child,
        "get_dashboard_layout": handle_get_dashboard_layout,
    }


# ─── Plan handler ────────────────────────────────────────────────────────────


PLAN_SYSTEM_PROMPT = """\
You are a build planner for Dyno, an autonomous AI agent that can read and modify its own source code and data.

Your file scope:
- python/ — your source code (agent_core.py, ws_server.py, tools/*.py)
- data/ — your data (context/, config/, scripts/, screenshots/, uploads/, logs/)

You have access to these tools:
- read_file / list_files: read files in python/ or data/ (auto)
- write_file / modify_file: create or edit files in python/ or data/ (auto)
- db_query: SELECT from Supabase tables (auto)
- db_insert: INSERT rows (auto)
- db_update: UPDATE rows with filters (auto)
- db_delete: DELETE rows with filters (requires approval)
- take_screenshot / fetch_url / read_upload: media tools (auto)
- web_search / browse_web: web browsing (auto)
- install_package: npm install (requires approval)
- execute_code / save_script / run_script / list_scripts: code execution (auto)
- save_memory / recall_memories / append_memory / edit_memory / list_memory_tags: memory (auto)
- spawn_agent / list_children / get_session_status / get_child_details / send_to_session / terminate_child: orchestration
- get_dashboard_layout / ui_action: dashboard control

Database tables: profiles, agent_memories, agent_screenshots, token_usage, widget_layouts.

Given a user's build request, analyze it and return a JSON build plan.

Respond with ONLY valid JSON matching this schema:
{
  "summary": "One-sentence description of what will be built",
  "steps": [
    {"tool": "tool_name", "target": "filename or package", "description": "what this step does"}
  ],
  "files": ["list of files that will be created or modified"],
  "packages": ["list of npm packages to install, if any"],
  "estimatedIterations": <number of agent loop iterations needed>,
  "estimatedInputTokens": <total input tokens across all iterations, accounting for growing context>,
  "estimatedOutputTokens": <total output tokens across all iterations>,
  "complexity": "trivial | simple | moderate | complex | ambitious",
  "reasoning": "Brief explanation of why this complexity level and token estimate"
}

Be accurate with token estimates. Consider:
- System prompt + tool definitions = ~800 tokens overhead per call
- Each iteration resends the full conversation history (growing context)
- write_file for a typical code file = ~300-800 output tokens
- A simple single-file task = 2-3 iterations, ~3k-6k total tokens
- A moderate multi-file task = 4-7 iterations, ~10k-25k total tokens
- A complex task = 8-15 iterations, ~30k-60k total tokens
"""

# Sonnet pricing: $3/M input, $15/M output
COST_PER_INPUT_TOKEN = 3 / 1_000_000
COST_PER_OUTPUT_TOKEN = 15 / 1_000_000


async def handle_plan(websocket, data):
    """Analyze a build request and return a structured plan with cost estimate."""
    prompt = data.get("prompt", "").strip()
    api_key = data.get("apiKey", "").strip()
    model = data.get("model")
    attachments = data.get("attachments", [])

    if not prompt or not api_key:
        await _send(websocket, {
            "type": "error",
            "message": "prompt and apiKey are required",
        })
        return

    prompt = _augment_prompt_with_attachments(prompt, attachments)

    print(f"[plan] Analyzing: {prompt[:80]}...")

    client = Anthropic(api_key=api_key)

    try:
        response = await asyncio.to_thread(
            client.messages.create,
            model=model or DEFAULT_MODEL,
            max_tokens=1024,
            system=PLAN_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )

        text = "".join(
            b.text for b in response.content if b.type == "text"
        ).strip()

        plan_tokens_in = response.usage.input_tokens if response.usage else 0
        plan_tokens_out = response.usage.output_tokens if response.usage else 0

        try:
            plan = json.loads(text)
        except json.JSONDecodeError:
            import re
            match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
            if match:
                plan = json.loads(match.group(1))
            else:
                plan = {"error": "Failed to parse plan", "raw": text[:500]}

        est_input = int(plan.get("estimatedInputTokens", 0))
        est_output = int(plan.get("estimatedOutputTokens", 0))
        estimated_cost = (
            est_input * COST_PER_INPUT_TOKEN +
            est_output * COST_PER_OUTPUT_TOKEN
        )
        plan["estimatedCost"] = str(round(estimated_cost, 5))

        plan_cost = (
            plan_tokens_in * COST_PER_INPUT_TOKEN +
            plan_tokens_out * COST_PER_OUTPUT_TOKEN
        )

        await _send(websocket, {
            "type": "plan_result",
            "plan": plan,
            "planTokensIn": plan_tokens_in,
            "planTokensOut": plan_tokens_out,
            "planCost": round(plan_cost, 5),
        })

    except Exception as e:
        await _send(websocket, {"type": "error", "message": str(e)})


# ─── Main ────────────────────────────────────────────────────────────────────


async def main():
    global server_start_time
    server_start_time = time.time()

    async with websockets.serve(
        handle_session,
        "localhost",
        8765,
        process_request=health_check,
    ):
        print("Agent bot server running on ws://localhost:8765")
        print("Health check at http://localhost:8765/health")
        await asyncio.Future()  # Run forever


if __name__ == "__main__":
    asyncio.run(main())
