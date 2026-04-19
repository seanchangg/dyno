# marty
<img width="970" height="571" alt="Screenshot 2026-04-19 at 2 34 51 PM" src="https://github.com/user-attachments/assets/7834ca7d-e524-4e80-8072-79c361c05e0e" />

**An AI agent sandbox for everyone — not just engineers.**

marty (formerly *dyno* on days 1–3) is a dashboard-first environment for running, observing, and collaborating with a personal AI agent. It turns the command-line surface area of modern agent frameworks into a visual canvas of composable widgets, so non-technical users can direct real work — research, trading, file management, browsing, code execution — without ever touching a terminal.

---

## Why marty

Agent tooling today assumes the user is a developer: shell prompts, config files, JSON blobs, scattered logs. Most people who would benefit from a personal agent are locked out by that interface. marty closes the gap with three commitments:rface the agent acts on.
- **One simple chatbox, many Mini Marties.** Users type into a single plain chat input. Behind it, marty orchestrates a fleet of **Mini Marties** — specialized sub-agents bound to individual widgets — that the main agent dispatches, supervises, and stitches back into one coherent answer.

---

## Memory state

marty treats memory as a visible, editable part of the interface rather than a hidden prompt-engineering detail.

- **Persistent memory store.** Memories survive across sessions and are scoped to the user, stored behind `/api/memories` and surfaced through the `MemoryWidget` on the canvas.
- **User-visible and user-editable.** The `MemoryTable` lets users read every memory the agent has saved, toggle which ones are active in context, edit entries inline, or delete them. Nothing about the agent's recollection is hidden.
- **Selectable context injection.** Through `useMemorySelection`, the user (or the agent) chooses which memories are pinned into the current conversation. Relevance stays under human control, so the agent never drags in stale context silently.
- **Session bridging.** `DashboardSessionBridge` and `useSessionManager` keep memory, open widgets, and agent state coherent as the user moves between the dashboard, vault, trading, and skills surfaces.
- **Screenshots, files, and skills as memory-adjacent context.** Screenshot selection, vault selection, and saved skills plug into the same context-assembly flow, letting the user say "use *these* files, *this* screenshot, and *that* memory" with checkboxes instead of prompts.

The design goal: the user should always be able to answer "what does the agent know about me right now?" — and change the answer in one click.

---

## Widget-style architecture

The dashboard is a zoomable, persistent canvas of widgets built on `react-grid-layout`. Widgets are the unit of capability, composition, and agent action.

- **Composable canvas.** `WidgetCanvas` renders a 48-column, 7200px-wide grid with snap-to-grid drag/resize, zoom, and a minimap for spatial navigation. Layout and viewport persist to local storage, so a user's arrangement is theirs.
- **Persistent mount, route-aware visibility.** `PersistentDashboard` keeps the canvas mounted across route changes — switching to Settings or Vault doesn't tear down running widgets or lose agent state.
- **Widget registry.** New capabilities are added by registering a widget in `lib/widgets/registry` and referencing it from the layout. Every widget is a self-contained React surface with its own state, data hooks, and agent affordances.

Shipped widgets include:

| Widget | Role |
|---|---|
| `ChatWidget` | Primary conversation with the agent |
| `MemoryWidget` | Inspect, edit, toggle persistent memories |
| `VaultWidget` | User-owned file store the agent can read |
| `CodeBlockWidget` | Agent-authored code, runnable inline |
| `HtmlWidget` / `MarkdownWidget` / `ImageWidget` / `TableWidget` | Rich renderings of agent output |
| `ScreenshotWidget` | Capture + share visual context with the agent |
| `AgentControlWidget` | Start, stop, steer the agent |
| `TutorialWidget` | Inline onboarding for first-time users |
| `StatCardWidget` | At-a-glance metrics |

Because the canvas is the source of truth, any new capability — a calendar, a CRM, a code reviewer — becomes a widget and immediately inherits persistence, layout, memory selection, and agent access.

---

## One chatbox, many Mini Marties

marty's interface is deliberately disarming: a single chat input, no command palette, no prompt templates, no mode switches. Everything the user wants to do is said in plain language into one box.

Underneath, that one message is orchestrated across a swarm of **Mini Marties** — lightweight, widget-bound sub-agents that each own a narrow slice of the world.

- **Main marty (orchestrator).** Reads the user's message, pulls selected memory / vault files / screenshots / skills into context, and decides which Mini Marties to dispatch. It plans, delegates, merges results, and speaks back in one voice.
- **Mini Marties (specialists).** Each widget has a Mini Marty bound to it: the Code Mini Marty runs snippets via `api/widget-exec`; the Vault Mini Marty reads/writes files via `api/storage`; the Memory Mini Marty curates what survives the turn via `api/memories`; the Screenshot Mini Marty handles visual context; the HTML/Markdown/Table Mini Marties render rich output back into the canvas. They stay scoped to their widget — small, auditable, and parallelizable.
- **Live supervision, not a black box.** Because every Mini Marty works *inside* a visible widget, the user watches orchestration happen: files open, code runs, tables and markdown render in place. `AgentControlWidget` and the telemetry/heartbeat routes let users pause, steer, or stop any step.
- **Simple to the user, rich underneath.** The user never picks a tool, never names an agent, never writes a prompt — they just talk. The chatbox hides the fan-out/fan-in completely.

---

## Agentic workflow enabling

Widgets are not passive panels. They are the tool surface the agent operates on, backed by a broad set of API routes under `src/app/api/`:

- **Tool execution.** `api/widget-exec`, `api/widget-query`, and `api/widget-html` let the agent run code, query structured data, and render rich HTML back into widgets during a turn.
- **Vaulted file access.** `api/storage` and `api/uploads` expose a permissioned file store that the agent can read from and write to — scoped per user, selectable per turn.
- **Skills.** `api/skills` + the Skills page let users install reusable, named capabilities. Skills appear to the agent as callable tools and to the user as labeled cards.
- **Credentials & tool permissions.** `api/credentials` and `api/tool-permissions` gate which integrations the agent may use, so non-technical users can grant and revoke access without editing config files.
- **Webhooks.** `api/webhook`, `api/webhooks`, and `api/webhook-data` let external systems push events into the agent, and the agent respond back — the ingress/egress for everything outside the canvas.
- **Telemetry & heartbeat.** `api/telemetry` and `api/heartbeat-config` keep the dashboard in sync with long-running agent activity, so the user can watch progress rather than wait in silence.
- **Context assembly hooks.** `useChat`, `useScreenshotSelection`, `useVaultSelection`, and `useSkills` compose each agent turn from the user's current selections — memory + files + screenshots + skills — without ever exposing a prompt template.

The result is an agent that can: read a file from your vault, pull a memory about how you like to work, run a quick script in a code widget, render the outcome as a table or markdown doc, capture a screenshot, and save a new memory — all inside one canvas the user can see, steer, and undo.

---

## Tech stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript
- **Styling:** Tailwind CSS v4
- **Layout:** `react-grid-layout` (zoomable canvas)
- **Markdown:** `react-markdown` + `remark-gfm`
- **Data / auth:** Supabase
- **Gateway:** Node + `ws` + Anthropic SDK, orchestrating Mini Marties and tool execution
- **Agent surface:** Chat + widget tool-calls over `/api/*` routes

---

## Getting started

marty is **plug and play** — the only thing you bring is your own Anthropic API key. Drop it into `.env.local` and everything else wires itself up.

```bash
# dyno-app/.env.local
ANTHROPIC_API_KEY=sk-ant-...
```

All commands run from `dyno-app/`.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm start        # serve production build
npm run lint     # ESLint
```

You'll also want the **gateway** running in a second terminal — it's what actually talks to Anthropic. See *Self-hosting* below.

Once both are up, open **[http://localhost:3000/landing](http://localhost:3000/landing)** — that's the front door. From there you sign in and drop straight into the canvas.

---

## Self-hosting on your own machine

marty is a small stack of cooperating processes. You can bring it up on any laptop; the only managed dependency is Supabase.

### 1. Services you need to run

| Process | Path | Port | Role |
|---|---|---|---|
| **Next.js app** | `dyno-app/` | `3000` | UI, API routes, auth |
| **Gateway** | `dyno-app/gateway/` | `18789` (WebSocket) | Anthropic SDK orchestration, Mini Marty dispatch, tool execution, credentials vault, skills, webhooks |
| **MCP server** (optional) | `dyno-app/python/mcp_server.py` | — | Python MCP tools exposed to the agent (file/PDF/image utilities, HTTP fetches, Playwright, etc.) |

The gateway is the workhorse — it holds the Anthropic client, dispatches Mini Marties, executes widget tools, signs webhooks, and talks to Supabase with the service-role key. The Next.js app is thin by comparison.

### 2. Supabase

All persistent state (profiles, memories, screenshots, widget layouts, vault storage, credentials, webhooks, chat history, token usage) lives in Supabase. The schema is versioned in `dyno-app/supabase/migrations/` — 18 migrations at time of writing.

```bash
# Option A — Supabase Cloud
#   Create a project at supabase.com, then run migrations from the SQL editor
#   (or with the Supabase CLI: `supabase db push`).

# Option B — local Supabase
supabase start
supabase db reset      # applies every migration in dyno-app/supabase/migrations/
```

Grab three values from Project Settings → API:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only — never ship to the browser)

You'll also want a Supabase Storage bucket for uploaded files / screenshots / widget HTML if you set `STORAGE_MODE=supabase`; otherwise marty writes to local disk.

### 3. Environment variables

Create `dyno-app/.env.local`:

```bash
# --- Anthropic (required) ---
ANTHROPIC_API_KEY=sk-ant-...

# --- Supabase (required) ---
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# --- Gateway (defaults to localhost) ---
NEXT_PUBLIC_GATEWAY_URL=ws://localhost:18789

# --- Shared secrets between Next.js ↔ Gateway ---
GATEWAY_KEY_STORE_SECRET=<random-long-string>
INTERNAL_API_KEY=<random-long-string>
WEBHOOK_INTERNAL_SECRET=<random-long-string>

# --- Storage ---
STORAGE_MODE=local              # or "supabase"

# --- Public URLs (used for webhook callback generation) ---
NEXT_PUBLIC_APP_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3000
```

The gateway reads its own `dyno-app/gateway/.env` — at minimum it needs `ANTHROPIC_API_KEY`, the Supabase URL + service-role key, and the same `GATEWAY_KEY_STORE_SECRET` as the app so the two trust each other.

### 4. Python MCP server (optional)

The MCP server gives the agent access to a sandboxed set of Python utilities — file conversions, PDF/markdown generation, HTTP fetches, Playwright, image handling. Skip it if you don't need any of that.

```bash
cd dyno-app/python
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install    # only if you want the browsing tools

python mcp_server.py
```

### 5. Bring it all up

```bash
# Two terminals for the minimum stack:
cd dyno-app && npm install && npm run dev            # Next.js   :3000
cd dyno-app/gateway && npm install && npm run dev    # Gateway   :18789

# Optional third terminal:
cd dyno-app/python && python mcp_server.py           # MCP tools
```

Then visit **[http://localhost:3000/landing](http://localhost:3000/landing)**, create an account against your Supabase project, and the canvas is yours.

### 6. Deploying somewhere real

- **App:** any Next.js-compatible host (Vercel, Fly, a container). Set every `.env.local` value in the host's env dashboard.
- **Gateway:** deploy as a long-running Node process (Fly, Railway, a VM). It must be reachable over WebSocket from the app — update `NEXT_PUBLIC_GATEWAY_URL` accordingly (`wss://...` in production).
- **Supabase:** cloud is easiest; migrations apply the same way.
- **MCP server:** only needed if you use its tools. Run it alongside the gateway on the same host.

A minimum deploy is therefore: Next.js + Gateway + Supabase. The MCP server is opt-in.

---

## Project layout

```
dyno/
├── README.md
└── dyno-app/
    ├── gateway/              # Node WebSocket gateway — Anthropic SDK, Mini Marty dispatch, tool exec
    ├── python/               # Optional MCP server + sandboxed Python tools
    ├── supabase/migrations/  # Schema (profiles, memories, vault, widget layouts, credentials, webhooks, …)
    └── src/
        ├── app/
        │   ├── (dashboard)/  # Authenticated dashboard routes (canvas, vault, skills, settings, agent-lab)
        │   ├── api/          # Agent tool + data routes (memories, skills, widget-exec, storage, webhooks, …)
        │   ├── landing/
        │   └── login/
        ├── components/
        │   ├── widgets/      # Canvas widgets (the agent's tool surface)
        │   ├── chat/         # Chat + memory table
        │   ├── sidebar/      # Navigation
        │   ├── sprite/       # marty agent sprite
        │   ├── agent-lab/    # Agent lab / internals UI
        │   ├── vault/        # File vault UI
        │   └── skills/       # Installable skills UI
        ├── hooks/            # useChat, useSessionManager, useScreenshots, useVaultFiles, …
        ├── contexts/         # Canvas zoom, layout, selection providers
        ├── lib/              # Widget registry, Supabase clients, agent config
        └── types/
```

---<img width="942" height="613" alt="Screenshot 2026-04-19 at 2 34 36 PM" src="https://github.com/user-attachments/assets/f8e523d8-1b0d-4943-9d23-8f90315659bb" />

