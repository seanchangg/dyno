"""
AgentCore — Claude API agentic loop with streaming, tool execution, and approval flow.

The loop calls Claude, streams text as 'thinking' events, auto-executes read-only tools,
and pauses for user approval on write tools via the on_event callback.
"""

import asyncio
import json
from pathlib import Path
from anthropic import Anthropic
from tools import AGENT_TOOLS, TOOL_HANDLERS, READ_ONLY_TOOLS

DEFAULT_MODEL = "claude-sonnet-4-5-20250929"
DEFAULT_MAX_TOKENS = 8192
DEFAULT_MAX_ITERATIONS = 15

PROJECT_ROOT = Path(__file__).resolve().parent.parent  # dyno-app/
DATA_DIR = PROJECT_ROOT / "data"
CONFIG_PATH = DATA_DIR / "config" / "agent.json"


def load_config() -> dict:
    """Load agent config from data/config/agent.json, with defaults."""
    defaults = {
        "default_model": DEFAULT_MODEL,
        "max_iterations": DEFAULT_MAX_ITERATIONS,
        "max_tokens": DEFAULT_MAX_TOKENS,
        "permissions": {
            "write_file": "manual",
            "modify_file": "manual",
            "install_package": "manual",
            "read_file": "auto",
            "list_files": "auto",
            "take_screenshot": "auto",
            "read_upload": "auto",
            "fetch_url": "auto",
        },
    }
    try:
        raw = CONFIG_PATH.read_text(encoding="utf-8")
        config = json.loads(raw)
        # Merge with defaults
        for k, v in defaults.items():
            if k not in config:
                config[k] = v
        return config
    except (FileNotFoundError, json.JSONDecodeError):
        return defaults


TOOL_DESCRIPTIONS_APPENDIX = (
    "## Tool Usage\n"
    "Your file tools (read_file, list_files, write_file, modify_file) operate on "
    "your own source directory (python/). You can read and modify your own code, "
    "including creating new tool skills in tools/.\n\n"
    "### Your source layout\n"
    "- `agent_core.py` — your agentic loop\n"
    "- `ws_server.py` — WebSocket server\n"
    "- `tools/` — your skill modules (file_ops.py, packages.py, screenshots.py, uploads.py, web.py)\n"
    "- `tools/__init__.py` — aggregates all skills\n"
    "- `tools/_common.py` — shared constants\n\n"
    "### Other tools\n"
    "- `take_screenshot`: Capture a webpage as PNG (saved to data/screenshots/)\n"
    "- `read_upload`: Read user-uploaded files from data/uploads/\n"
    "- `fetch_url`: Fetch and read content from a URL\n"
    "- `install_package`: Install an npm package\n\n"
    "### Memory tools\n"
    "- `save_memory`: Save a sticky-note to remember across sessions (tag + content). Auto-approved. User ID is handled automatically.\n"
    "- `recall_memories`: Search/list saved memories by tag or keyword. Auto-approved. User ID is handled automatically.\n"
    "- `delete_memory`: Remove an outdated memory by tag. Requires approval. User ID is handled automatically.\n\n"
    "Use memory tools to persist important context (user preferences, project notes, etc.) "
    "instead of relying on conversation history. You do NOT need to provide or know the user ID — it is set automatically.\n\n"
    "Write clean, working code. Be concise in your explanations."
)


def get_base_prompt() -> str:
    """Load base system prompt from data/context/claude.md if available."""
    context_file = DATA_DIR / "context" / "claude.md"
    try:
        return context_file.read_text(encoding="utf-8")
    except FileNotFoundError:
        return "You are a helpful AI agent managed through Dyno."


def get_system_prompt() -> str:
    """Load full system prompt: base + tool descriptions. Used by builds."""
    return f"{get_base_prompt()}\n\n{TOOL_DESCRIPTIONS_APPENDIX}"


class AgentCore:
    def __init__(self, api_key: str, model: str | None = None):
        self.client = Anthropic(api_key=api_key)
        self.config = load_config()
        self.model = model or self.config["default_model"]
        self.max_tokens = self.config["max_tokens"]
        self.max_iterations = self.config["max_iterations"]
        self.permissions = self.config["permissions"]
        self.messages: list[dict] = []
        self.total_tokens_in = 0
        self.total_tokens_out = 0

    def is_auto_approved(self, tool_name: str) -> bool:
        """Check if a tool is auto-approved based on config permissions."""
        if tool_name in READ_ONLY_TOOLS:
            return True
        return self.permissions.get(tool_name, "manual") == "auto"

    async def execute_tool(self, tool_name: str, tool_input: dict) -> str:
        """Execute a tool handler and return the result string."""
        handler = TOOL_HANDLERS.get(tool_name)
        if not handler:
            return f"Error: Unknown tool: {tool_name}"
        try:
            return await handler(tool_input)
        except Exception as e:
            return f"Error executing {tool_name}: {str(e)}"

    async def run_build(self, prompt: str, on_event, *, history: list[dict] | None = None, system_prompt: str | None = None):
        """
        Main agentic loop.

        on_event(type, data) is an async callback:
        - For most events, it just sends data to the client.
        - For "proposal" events, it returns {"approved": bool, "editedInput": ...}

        Optional history: prepend conversation history before the user prompt.
        Optional system_prompt: override the default system prompt.
        """
        self.messages = []
        if history:
            self.messages.extend(history)
        self.messages.append({"role": "user", "content": prompt})
        if system_prompt is None:
            system_prompt = get_system_prompt()

        for iteration in range(self.max_iterations):
            try:
                # Run sync Anthropic call in a thread to avoid blocking the event loop
                response = await asyncio.to_thread(
                    self.client.messages.create,
                    model=self.model,
                    max_tokens=self.max_tokens,
                    system=system_prompt,
                    tools=AGENT_TOOLS,
                    messages=self.messages,
                )
            except Exception as e:
                await on_event("error", {"message": f"API error: {str(e)}"})
                return

            # Track token usage and emit per-iteration deltas
            if hasattr(response, "usage") and response.usage:
                delta_in = response.usage.input_tokens
                delta_out = response.usage.output_tokens
                self.total_tokens_in += delta_in
                self.total_tokens_out += delta_out
                await on_event("token_usage", {
                    "deltaIn": delta_in,
                    "deltaOut": delta_out,
                    "totalIn": self.total_tokens_in,
                    "totalOut": self.total_tokens_out,
                    "iteration": iteration + 1,
                })

            # Stream text blocks as thinking
            for block in response.content:
                if block.type == "text":
                    await on_event("thinking", {"text": block.text})

            # If no tool use, we're done
            if response.stop_reason != "tool_use":
                # Extract final text for summary
                final_text = ""
                for block in response.content:
                    if block.type == "text":
                        final_text += block.text
                await on_event("done", {
                    "summary": final_text[:200] if final_text else "Build complete.",
                    "tokensIn": self.total_tokens_in,
                    "tokensOut": self.total_tokens_out,
                })
                return

            # Collect tool_use blocks
            tool_blocks = [b for b in response.content if b.type == "tool_use"]

            # Separate read-only (auto) from write (needs approval)
            auto_blocks = [b for b in tool_blocks if self.is_auto_approved(b.name)]
            approval_blocks = [b for b in tool_blocks if not self.is_auto_approved(b.name)]

            tool_results = []

            # Execute read-only tools in parallel
            if auto_blocks:
                async def exec_auto(block):
                    await on_event("tool_call", {
                        "id": block.id,
                        "tool": block.name,
                        "input": block.input,
                    })
                    result = await self.execute_tool(block.name, block.input)
                    await on_event("tool_result", {
                        "id": block.id,
                        "tool": block.name,
                        "result": result[:2000],  # Truncate large results for display
                    })
                    return {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result,
                    }

                auto_results = await asyncio.gather(
                    *(exec_auto(b) for b in auto_blocks)
                )
                tool_results.extend(auto_results)

            # Process write tools sequentially (each needs approval)
            for block in approval_blocks:
                await on_event("tool_call", {
                    "id": block.id,
                    "tool": block.name,
                    "input": block.input,
                })

                # Build a display title
                display_title = block.name
                if "filename" in block.input:
                    display_title = f"{block.name}: {block.input['filename']}"
                elif "package_name" in block.input:
                    display_title = f"{block.name}: {block.input['package_name']}"

                # Send proposal and wait for decision
                decision = await on_event("proposal", {
                    "id": block.id,
                    "tool": block.name,
                    "input": block.input,
                    "displayTitle": display_title,
                })

                if decision and decision.get("approved"):
                    actual_input = decision.get("editedInput") or block.input
                    result = await self.execute_tool(block.name, actual_input)
                    await on_event("execution_result", {
                        "id": block.id,
                        "status": "completed",
                        "result": result,
                    })
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result,
                    })
                else:
                    await on_event("execution_result", {
                        "id": block.id,
                        "status": "denied",
                        "error": "User denied this action.",
                    })
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": "User denied this action.",
                        "is_error": True,
                    })

            # Serialize assistant content for message history
            serialized_content = []
            for block in response.content:
                if block.type == "text":
                    serialized_content.append({
                        "type": "text",
                        "text": block.text,
                    })
                elif block.type == "tool_use":
                    serialized_content.append({
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    })

            self.messages.append({"role": "assistant", "content": serialized_content})
            self.messages.append({"role": "user", "content": tool_results})

        # Hit max iterations
        await on_event("done", {
            "summary": f"Reached maximum iterations ({self.max_iterations}).",
            "tokensIn": self.total_tokens_in,
            "tokensOut": self.total_tokens_out,
        })
