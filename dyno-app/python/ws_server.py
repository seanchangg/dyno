"""
WebSocket server bridging AgentCore to the web dashboard.

One WebSocket connection = one build session.
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
from agent_core import AgentCore, get_system_prompt, get_base_prompt, TOOL_DESCRIPTIONS_APPENDIX, DEFAULT_MODEL
from tools import AGENT_TOOLS, TOOL_HANDLERS, READ_ONLY_TOOLS, reload_tools
from tools.memories import set_user_id

# Track active sessions for health reporting
active_sessions = 0
server_start_time = 0


def _compute_overhead():
    """Compute the character counts of static payload components.

    These are used by the frontend to accurately estimate input tokens
    before sending a request.
    """
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
        # Reload tools so the list reflects any newly created skills
        reload_tools()
        overhead = _compute_overhead()
        tools_list = [
            {
                "name": t["name"],
                "description": t.get("description", ""),
                "mode": "auto" if t["name"] in READ_ONLY_TOOLS else "manual",
            }
            for t in AGENT_TOOLS
        ]
        body = json.dumps({
            "status": "ok",
            "uptime": int(time.time() - server_start_time),
            "activeSessions": active_sessions,
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
    # Return None to proceed with normal WebSocket handshake
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


async def handle_session(websocket):
    """Handle a single build session over WebSocket."""
    global active_sessions
    active_sessions += 1
    # Hot-reload tools so newly created skills are available
    n = reload_tools()
    print(f"[ws] New connection from {websocket.remote_address} (active: {active_sessions}, {n} tools)")

    try:
        # Wait for the first message
        raw = await websocket.recv()
        data = json.loads(raw)

        msg_type = data.get("type")

        # Set user ID for memory tools (if provided)
        user_id = data.get("userId")
        if user_id:
            set_user_id(user_id)

        # Handle ping — quick health check over WS
        if msg_type == "ping":
            await websocket.send(json.dumps({
                "type": "pong",
                "uptime": int(time.time() - server_start_time),
                "activeSessions": active_sessions,
            }))
            return

        # Handle chat — simple Claude call, no tools
        if msg_type == "chat":
            await handle_chat(websocket, data)
            return

        # Handle plan — Claude analyzes the task and returns a structured plan
        if msg_type == "plan":
            await handle_plan(websocket, data)
            return

        if msg_type != "start":
            await websocket.send(json.dumps({
                "type": "error",
                "message": "Expected 'start' message",
            }))
            return

        prompt = data.get("prompt", "").strip()
        api_key = data.get("apiKey", "").strip()
        model = data.get("model")
        attachments = data.get("attachments", [])

        if not prompt:
            await websocket.send(json.dumps({
                "type": "error",
                "message": "prompt is required",
            }))
            return

        if not api_key:
            await websocket.send(json.dumps({
                "type": "error",
                "message": "apiKey is required",
            }))
            return

        # Augment prompt with attachment context
        prompt = _augment_prompt_with_attachments(prompt, attachments)

        print(f"[ws] Starting build: {prompt[:80]}...")

        core = AgentCore(api_key=api_key, model=model)
        # Inject user ID into system prompt so memory tools work in builds
        build_system = None
        if user_id:
            build_system = get_system_prompt() + f"\n\nThe current user's ID is: {user_id}"
        pending_proposals: dict[str, asyncio.Future] = {}
        cancelled = False

        async def on_event(event_type: str, payload: dict):
            """
            Callback from AgentCore.
            For proposals: sends to client and waits for approve/deny.
            For everything else: sends to client and returns.
            """
            nonlocal cancelled
            if cancelled:
                return None

            if event_type == "proposal":
                # Create a future that will be resolved when user responds
                future = asyncio.get_event_loop().create_future()
                pending_proposals[payload["id"]] = future
                await websocket.send(json.dumps({"type": "proposal", **payload}))
                # Block until the user approves or denies
                decision = await future
                return decision
            else:
                await websocket.send(json.dumps({"type": event_type, **payload}))
                return None

        async def listen_for_decisions():
            """Background task: listen for approve/deny/cancel messages."""
            nonlocal cancelled
            try:
                async for raw_msg in websocket:
                    msg = json.loads(raw_msg)
                    msg_type = msg.get("type")

                    if msg_type == "cancel":
                        cancelled = True
                        # Resolve all pending proposals as denied
                        for _, future in pending_proposals.items():
                            if not future.done():
                                future.set_result({"approved": False})
                        pending_proposals.clear()
                        return

                    if msg_type in ("approve", "deny"):
                        proposal_id = msg.get("id")
                        future = pending_proposals.pop(proposal_id, None)
                        if future and not future.done():
                            future.set_result({
                                "approved": msg_type == "approve",
                                "editedInput": msg.get("editedInput"),
                            })
            except websockets.exceptions.ConnectionClosed:
                cancelled = True
                for future in pending_proposals.values():
                    if not future.done():
                        future.set_result({"approved": False})

        # Run the listener in the background
        listener = asyncio.create_task(listen_for_decisions())

        try:
            await core.run_build(prompt, on_event, system_prompt=build_system)
        except websockets.exceptions.ConnectionClosed:
            print("[ws] Connection closed during build")
        except Exception as e:
            print(f"[ws] Build error: {e}")
            try:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": str(e),
                }))
            except Exception:
                pass
        finally:
            listener.cancel()
            try:
                await listener
            except asyncio.CancelledError:
                pass

    except websockets.exceptions.ConnectionClosed:
        print("[ws] Connection closed before start")
    except json.JSONDecodeError:
        print("[ws] Invalid JSON received")
    except Exception as e:
        print(f"[ws] Unexpected error: {e}")
    finally:
        active_sessions -= 1
        print(f"[ws] Session ended (active: {active_sessions})")


PLAN_SYSTEM_PROMPT = """\
You are a build planner for Dyno, an AI agent that can read and modify its own source code in the python/ directory.

Your source layout:
- agent_core.py — agentic loop
- ws_server.py — WebSocket server
- tools/ — skill modules (file_ops.py, packages.py, screenshots.py, uploads.py, web.py)
- tools/__init__.py — aggregates all skills
- tools/_common.py — shared constants

You have access to these tools:
- read_file: read a file in python/ (auto, no approval needed)
- list_files: list files in python/ or a subdirectory (auto, no approval needed)
- take_screenshot: capture a webpage as PNG (auto, no approval needed)
- read_upload: read a user-uploaded file (auto, no approval needed)
- fetch_url: fetch content from a URL (auto, no approval needed)
- write_file: create/overwrite a file in python/ (requires user approval)
- modify_file: replace a string in a file in python/ (requires user approval)
- install_package: npm install a package (requires user approval)

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
        await websocket.send(json.dumps({
            "type": "error",
            "message": "prompt and apiKey are required",
        }))
        return

    # Augment prompt with attachment context
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

        # Parse the JSON plan from Claude's response
        try:
            plan = json.loads(text)
        except json.JSONDecodeError:
            # Try to extract JSON from markdown code block
            import re
            match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
            if match:
                plan = json.loads(match.group(1))
            else:
                plan = {"error": "Failed to parse plan", "raw": text[:500]}

        # Calculate estimated cost from Claude's token estimates
        est_input = int(plan.get("estimatedInputTokens", 0))
        est_output = int(plan.get("estimatedOutputTokens", 0))
        estimated_cost = (
            est_input * COST_PER_INPUT_TOKEN +
            est_output * COST_PER_OUTPUT_TOKEN
        )
        plan["estimatedCost"] = str(round(estimated_cost, 5))

        # Include planning phase cost
        plan_cost = (
            plan_tokens_in * COST_PER_INPUT_TOKEN +
            plan_tokens_out * COST_PER_OUTPUT_TOKEN
        )

        await websocket.send(json.dumps({
            "type": "plan_result",
            "plan": plan,
            "planTokensIn": plan_tokens_in,
            "planTokensOut": plan_tokens_out,
            "planCost": round(plan_cost, 5),
        }))

    except Exception as e:
        await websocket.send(json.dumps({
            "type": "error",
            "message": str(e),
        }))


ACTIVATE_TOOLS_DEF = {
    "name": "activate_tools",
    "description": (
        "Call this tool when you need to perform actions such as reading/writing files, "
        "installing packages, taking screenshots, fetching URLs, or managing memories. "
        "This activates your full toolkit for the current task. "
        "Do NOT call this for simple conversation, questions, or explanations — "
        "only when the user's request requires you to interact with the filesystem or external resources."
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


async def handle_chat(websocket, data):
    """Handle a chat message with automatic tool activation.

    Phase 1 (lightweight): Claude gets conversation history + a single
    `activate_tools` gate tool.  If Claude responds with text, we're done.
    If it calls `activate_tools`, we proceed to Phase 2.

    Phase 2 (full): Runs the AgentCore agentic loop with all tools,
    proposals, and approval — identical to builds.
    """
    prompt = data.get("prompt", "").strip()
    api_key = data.get("apiKey", "").strip()
    history = data.get("history", [])
    model = data.get("model")
    user_id = data.get("userId", "")
    include_system_context = data.get("includeSystemContext", True)
    memory_context = data.get("memoryContext", "").strip()

    if not prompt or not api_key:
        await websocket.send(json.dumps({
            "type": "error",
            "message": "prompt and apiKey are required",
        }))
        return

    # Ensure memory tools have the user ID
    if user_id:
        set_user_id(user_id)

    # Prepend selected memories to the prompt
    if memory_context:
        prompt = f"## User's Selected Memories\n{memory_context}\n\n---\n\n{prompt}"

    # Build system prompt
    system_prompt = ""
    if include_system_context:
        system_prompt = get_base_prompt()
    if user_id:
        system_prompt += f"\n\nThe current user's ID is: {user_id}"

    # Build conversation messages
    chat_history = [{"role": m["role"], "content": m["content"]} for m in history]
    messages = chat_history + [{"role": "user", "content": prompt}]

    print(f"[chat] Phase 1: {prompt[:80]}...")

    # ── Phase 1: Lightweight call with activate_tools gate ──
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
    except Exception as e:
        await websocket.send(json.dumps({
            "type": "error",
            "message": str(e),
        }))
        return

    phase1_in = response.usage.input_tokens if response.usage else 0
    phase1_out = response.usage.output_tokens if response.usage else 0

    # Check if Claude wants to activate tools
    tool_use = None
    text_parts: list[str] = []
    for block in response.content:
        if block.type == "tool_use" and block.name == "activate_tools":
            tool_use = block
        elif block.type == "text":
            text_parts.append(block.text)

    # If no tool activation — simple text response, done
    if not tool_use:
        text = "".join(text_parts) or "No response."
        await websocket.send(json.dumps({
            "type": "chat_response",
            "response": text,
            "tokensIn": phase1_in,
            "tokensOut": phase1_out,
        }))
        return

    # ── Phase 2: Full agentic loop with all tools ──
    reason = tool_use.input.get("reason", "")
    print(f"[chat] Phase 2 activated: {reason}")

    # Notify frontend that tools are being activated
    await websocket.send(json.dumps({
        "type": "thinking",
        "text": f"Activating tools: {reason}",
    }))

    # Include tool descriptions in system prompt for the agentic loop
    full_system = f"{system_prompt}\n\n{TOOL_DESCRIPTIONS_APPENDIX}" if system_prompt else get_system_prompt()

    core = AgentCore(api_key=api_key, model=model)
    pending_proposals: dict[str, asyncio.Future] = {}
    cancelled = False

    async def on_event(event_type: str, payload: dict):
        nonlocal cancelled
        if cancelled:
            return None

        if event_type == "proposal":
            future = asyncio.get_event_loop().create_future()
            pending_proposals[payload["id"]] = future
            await websocket.send(json.dumps({"type": "proposal", **payload}))
            decision = await future
            return decision
        elif event_type == "done":
            # Convert the build "done" into a chat_response
            # Add phase 1 tokens to the totals
            await websocket.send(json.dumps({
                "type": "chat_response",
                "response": payload.get("summary", "Done."),
                "tokensIn": payload.get("tokensIn", 0) + phase1_in,
                "tokensOut": payload.get("tokensOut", 0) + phase1_out,
            }))
        else:
            await websocket.send(json.dumps({"type": event_type, **payload}))
        return None

    async def listen_for_decisions():
        nonlocal cancelled
        try:
            async for raw_msg in websocket:
                msg = json.loads(raw_msg)
                msg_type = msg.get("type")
                if msg_type == "cancel":
                    cancelled = True
                    for future in pending_proposals.values():
                        if not future.done():
                            future.set_result({"approved": False})
                    pending_proposals.clear()
                    return
                if msg_type in ("approve", "deny"):
                    proposal_id = msg.get("id")
                    future = pending_proposals.pop(proposal_id, None)
                    if future and not future.done():
                        future.set_result({
                            "approved": msg_type == "approve",
                            "editedInput": msg.get("editedInput"),
                        })
        except websockets.exceptions.ConnectionClosed:
            cancelled = True
            for future in pending_proposals.values():
                if not future.done():
                    future.set_result({"approved": False})

    listener = asyncio.create_task(listen_for_decisions())
    try:
        await core.run_build(
            prompt,
            on_event,
            history=chat_history,
            system_prompt=full_system,
        )
    except websockets.exceptions.ConnectionClosed:
        print("[chat] Connection closed during chat")
    except Exception as e:
        print(f"[chat] Error: {e}")
        try:
            await websocket.send(json.dumps({
                "type": "error",
                "message": str(e),
            }))
        except Exception:
            pass
    finally:
        listener.cancel()
        try:
            await listener
        except asyncio.CancelledError:
            pass


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
