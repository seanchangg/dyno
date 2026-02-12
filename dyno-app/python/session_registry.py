"""
SessionRegistry — manages child agent sessions spawned by the master agent.

Each child gets its own AgentCore running in an asyncio.Task.
Events from children are routed back through the master's WebSocket,
tagged with the child's session_id.
"""

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, Awaitable

from agent_core import AgentCore


@dataclass
class SessionEntry:
    session_id: str
    agent_core: AgentCore
    task: asyncio.Task
    model: str
    prompt: str
    status: str  # "running" | "completed" | "error" | "terminated"
    created_at: float
    parent_session_id: str
    result: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0


class SessionRegistry:
    MAX_CHILDREN = 5

    def __init__(self):
        self.sessions: dict[str, SessionEntry] = {}

    def create_child(
        self,
        api_key: str,
        model: str,
        prompt: str,
        on_event: Callable[[str, dict], Awaitable[None]],
        tools_override: list[dict] | None = None,
        system_prompt: str | None = None,
        parent_session_id: str = "master",
    ) -> str:
        """Spawn a child agent in a background task. Returns session_id immediately."""
        if len(self.sessions) >= self.MAX_CHILDREN:
            raise RuntimeError(f"Maximum child sessions ({self.MAX_CHILDREN}) reached")

        session_id = f"child-{uuid.uuid4().hex[:8]}"

        core = AgentCore(
            api_key=api_key,
            model=model,
            session_id=session_id,
            tools_override=tools_override,
        )

        entry = SessionEntry(
            session_id=session_id,
            agent_core=core,
            task=None,  # type: ignore — set below
            model=model,
            prompt=prompt,
            status="running",
            created_at=time.time(),
            parent_session_id=parent_session_id,
        )

        async def run_child():
            try:
                async def child_on_event(event_type: str, payload: dict):
                    # Track token usage on the entry
                    if event_type == "token_usage":
                        entry.tokens_in = payload.get("totalIn", 0)
                        entry.tokens_out = payload.get("totalOut", 0)
                    # Capture done summary as result fallback
                    if event_type == "done":
                        summary = payload.get("summary", "")
                        if summary and not entry.result:
                            entry.result = summary
                    # Forward all events through the parent callback
                    await on_event(event_type, payload)
                    return None  # Children don't get proposals

                await core.run_build(
                    prompt,
                    child_on_event,
                    system_prompt=system_prompt,
                )
                entry.status = "completed"
                # Extract result from last assistant message
                for msg in reversed(core.messages):
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
                await on_event("error", {"message": f"Child {session_id} error: {str(e)}"})

        task = asyncio.create_task(run_child())
        entry.task = task
        self.sessions[session_id] = entry
        return session_id

    def terminate_child(self, session_id: str) -> None:
        """Cancel a running child session."""
        entry = self.sessions.get(session_id)
        if entry and not entry.task.done():
            entry.task.cancel()
            entry.status = "terminated"

    def get_session(self, session_id: str) -> SessionEntry | None:
        return self.sessions.get(session_id)

    def list_sessions(self) -> list[dict]:
        """Return summary of all child sessions."""
        return [
            {
                "sessionId": e.session_id,
                "model": e.model,
                "status": e.status,
                "prompt": e.prompt[:100],
                "tokensIn": e.tokens_in,
                "tokensOut": e.tokens_out,
                "createdAt": e.created_at,
            }
            for e in self.sessions.values()
        ]

    def cleanup(self) -> None:
        """Cancel all child tasks. Called on master WS disconnect."""
        for entry in self.sessions.values():
            if not entry.task.done():
                entry.task.cancel()
        self.sessions.clear()
