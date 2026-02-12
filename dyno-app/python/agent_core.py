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

# Sonnet pricing for cost estimation
COST_PER_INPUT_TOKEN = 3 / 1_000_000
COST_PER_OUTPUT_TOKEN = 15 / 1_000_000

# Max chars to store per tool result in conversation history (saves context tokens)
TOOL_RESULT_HISTORY_LIMIT = 4000

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
            "write_file": "auto",
            "modify_file": "auto",
            "install_package": "manual",
            "read_file": "auto",
            "list_files": "auto",
            "take_screenshot": "auto",
            "read_upload": "auto",
            "fetch_url": "auto",
            "save_script": "auto",
            "db_query": "auto",
            "db_insert": "auto",
            "db_update": "auto",
            "db_delete": "manual",
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
    "File tools operate on python/ (your code) and data/ (your config, context, scripts, logs).\n"
    "Paths must start with `python/` or `data/` (e.g. `python/tools/new_skill.py`, `data/context/claude.md`).\n\n"
    "### Database (direct Supabase access)\n"
    "- `db_query`: SELECT with PostgREST filters. Always filter by user_id (except `profiles` where the column is `id`).\n"
    "- `db_insert`: INSERT rows. Include user_id for user-scoped tables.\n"
    "- `db_update`: UPDATE matching rows. Filters required.\n"
    "- `db_delete`: DELETE matching rows. Filters required. Requires approval.\n"
    "Tables: profiles (PK: id), agent_memories, agent_screenshots, token_usage, widget_layouts (PK: user_id).\n\n"
    "### Web: web_search, browse_web, fetch_url — all auto.\n"
    "### Memory: save_memory, recall_memories, delete_memory, append_memory, edit_memory, list_memory_tags.\n"
    "### Execution: execute_code, save_script, run_script, list_scripts, delete_script.\n"
    "### Orchestration: spawn_agent, list_children, get_session_status, get_child_details, send_to_session, terminate_child.\n"
    "### Dashboard: get_dashboard_layout (read first!), ui_action (add/remove/update/move/resize/clear/reset). Grid: 12 cols, 60px rows.\n"
    "Use `html` widget type for charts/graphs/interactive content — pass {html} for inline or write to data/widgets/ and use {src: '/api/widget-html/filename.html'}.\n"
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
    def __init__(
        self,
        api_key: str,
        model: str | None = None,
        session_id: str = "master",
        context_handlers: dict | None = None,
        tools_override: list[dict] | None = None,
        permission_overrides: dict[str, str] | None = None,
    ):
        self.client = Anthropic(api_key=api_key)
        self.config = load_config()
        self.model = model or self.config["default_model"]
        self.max_tokens = self.config["max_tokens"]
        self.max_iterations = self.config["max_iterations"]
        self.permissions = self.config["permissions"]
        self.session_id = session_id
        self.context_handlers = context_handlers
        self.tools_override = tools_override
        self.permission_overrides = permission_overrides or {}
        self.messages: list[dict] = []
        self.total_tokens_in = 0
        self.total_tokens_out = 0
        self._cancelled = False

    def is_auto_approved(self, tool_name: str) -> bool:
        """Check if a tool is auto-approved.

        Priority: session overrides > server defaults (READ_ONLY_TOOLS) > config.
        """
        # Session-level overrides from the frontend take top priority
        if tool_name in self.permission_overrides:
            return self.permission_overrides[tool_name] == "auto"
        # Server defaults
        if tool_name in READ_ONLY_TOOLS:
            return True
        return self.permissions.get(tool_name, "manual") == "auto"

    async def execute_tool(self, tool_name: str, tool_input: dict) -> str:
        """Execute a tool handler and return the result string.

        Checks context_handlers first (session-scoped), then global TOOL_HANDLERS.
        """
        handler = None
        if self.context_handlers:
            handler = self.context_handlers.get(tool_name)
        if not handler:
            handler = TOOL_HANDLERS.get(tool_name)
        if not handler:
            return f"Error: Unknown tool: {tool_name}"
        try:
            return await handler(tool_input)
        except Exception as e:
            return f"Error executing {tool_name}: {str(e)}"

    def cancel(self):
        """Signal the agentic loop to stop at the next iteration."""
        self._cancelled = True

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
        self._cancelled = False
        if history:
            self.messages.extend(history)
        self.messages.append({"role": "user", "content": prompt})
        if system_prompt is None:
            system_prompt = get_system_prompt()

        active_tools = self.tools_override if self.tools_override is not None else AGENT_TOOLS

        for iteration in range(self.max_iterations):
            # Early exit on cancel
            if self._cancelled:
                await on_event("done", {
                    "summary": "Cancelled.",
                    "tokensIn": self.total_tokens_in,
                    "tokensOut": self.total_tokens_out,
                })
                return

            try:
                # Run sync Anthropic call in a thread to avoid blocking the event loop
                response = await asyncio.to_thread(
                    self.client.messages.create,
                    model=self.model,
                    max_tokens=self.max_tokens,
                    system=system_prompt,
                    tools=active_tools,
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
                # Save final response to self.messages so callers can inspect it
                serialized_content = []
                final_text = ""
                for block in response.content:
                    if block.type == "text":
                        serialized_content.append({"type": "text", "text": block.text})
                        final_text += block.text
                if serialized_content:
                    self.messages.append({"role": "assistant", "content": serialized_content})

                await on_event("done", {
                    "summary": final_text if final_text else "Build complete.",
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
                        "content": result[:TOOL_RESULT_HISTORY_LIMIT],
                    }

                auto_results = await asyncio.gather(
                    *(exec_auto(b) for b in auto_blocks)
                )
                tool_results.extend(auto_results)

            # Process write tools sequentially (each needs approval)
            for block in approval_blocks:
                # Build a display title
                display_title = block.name
                if "filename" in block.input:
                    display_title = f"{block.name}: {block.input['filename']}"
                elif "package_name" in block.input:
                    display_title = f"{block.name}: {block.input['package_name']}"
                elif "table" in block.input:
                    display_title = f"{block.name}: {block.input['table']}"

                # Calculate running cost
                cost_so_far = (
                    self.total_tokens_in * COST_PER_INPUT_TOKEN
                    + self.total_tokens_out * COST_PER_OUTPUT_TOKEN
                )

                # Send proposal and wait for decision
                decision = await on_event("proposal", {
                    "id": block.id,
                    "tool": block.name,
                    "input": block.input,
                    "displayTitle": display_title,
                    "tokensIn": self.total_tokens_in,
                    "tokensOut": self.total_tokens_out,
                    "costSoFar": round(cost_so_far, 6),
                    "iteration": iteration + 1,
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
                        "content": result[:TOOL_RESULT_HISTORY_LIMIT],
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
                        "content": "User denied this action. Do not retry this action or ask why. Move on to the next step or finish the build with what you have.",
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
