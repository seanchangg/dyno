# PROMPTS.md

Prompt 1: Scaffold

> Scaffold a Next.js 16 App Router project called dyno-app with React 19, TypeScript, and Tailwind CSS v4. Set up a dashboard route group with a persistent left sidebar, an auth-gated layout, and a single /dashboard page that renders a full-bleed canvas. The canvas should be a zoomable, pannable 48-column × 7200px grid built on react-grid-layout, with snap-to-grid drag/resize, a minimap for spatial navigation, and viewport state (zoom + scroll) persisted to localStorage. Every widget on the canvas must be registered in a lib/widgets/registry and looked up by id. Style it to the muted Bauhaus palette: #121A14 background, #1B291E surfaces, #2F5434 primary, #A8D5BA highlight, #E0E6E1 text, Jost font, no gradients, no pill shapes, no icons unless a widget asks for one. No test framework. Path alias @/* → ./src/*.

---

Prompt 2: Supabase

> Add Supabase as the data and auth layer for dyno-app. Create a browser client (lib/supabase/client.ts) using the anon key and a server client (lib/supabase/server.ts) using the service-role key. Wire Next.js middleware to gate the (dashboard) routes behind a signed-in session and redirect unauth'd users to /login. Build /api/auth/signin and /api/auth/signup routes. Add migrations under dyno-app/supabase/migrations/ for: profiles, token usage, chat settings, agent memories, screenshots, widget layouts, workspace storage, metrics, user credentials, agent control state, heartbeat config, user context files, and chat history. Every table must have row-level security scoping rows to auth.uid(). Expose CRUD routes under /api/memories, /api/screenshots, /api/storage, /api/uploads, /api/layout, /api/profile, and /api/chat. Support STORAGE_MODE=local (disk) and STORAGE_MODE=supabase (bucket) for file uploads so local dev doesn't require a storage bucket.

---

Prompt 3: Memory widget

> Memory should not be hidden prompt engineering. Build a MemoryWidget that renders a MemoryTable showing every memory the agent has saved for this user, with inline edit, delete, and a per-row active/inactive toggle. Back it with a useMemorySelection provider mounted at the dashboard layout so selection state is shared across widgets. When the user sends a chat message, only currently-active memories are injected into the agent's context — the user (or the agent itself) is always in charge of which memories are "on." Add the same selection pattern for screenshots (useScreenshotSelection) and vault files (useVaultSelection) so the user can say "use these memories + these files + this screenshot" via checkboxes, never a prompt template. Persist memories through /api/memories to the agent_memories table. Every write must include why it was saved so future marty can audit.

---

Prompt 4: Websocket gateway

> Build the gateway under dyno-app/gateway/ as a standalone Node WebSocket server on port 18789 using @anthropic-ai/sdk and ws. The gateway owns the Anthropic client; the Next.js app never talks to Anthropic directly. Architecture: a single user-facing ChatWidget sends a plain-English message to the gateway; the gateway instantiates a **main marty** (orchestrator) that plans the turn and dispatches work to **Mini Marties** — lightweight, widget-scoped sub-agents, each bound to one widget's tools. Implement Mini Marties for: Memory (api/memories), Vault (api/storage, api/uploads), Code (api/widget-exec), Screenshot (api/screenshots), HTML rendering (api/widget-html), and structured query (api/widget-query). Mini Marties run in parallel where possible and stream results back through the gateway so their widgets update live ; the user literally watches files open, code run, and tables render inside the widgets while the main marty is still working. Add AgentControlWidget with pause/stop/steer controls wired to api/agent-control, and an api/heartbeat-config + api/telemetry pair so the dashboard shows long-running agent state instead of a spinner. Share a GATEWAY_KEY_STORE_SECRET between the Next.js app and the gateway so the two can trust each other without exposing service-role keys to the browser.

---

Prompt 5: Webhooks for agent activation

> Add a webhook ingress/egress layer so external systems can push events into marty and the agent can call out to external URLs. Create migrations for webhooks, webhook_security, webhook_direct_mode, webhook_provider, and webhook_prompt tables. Build:
>
> - POST /api/webhooks — register a new webhook for the signed-in user, returning a public URL of the form {NEXT_PUBLIC_APP_URL}/api/webhook/{userId}/{endpointName}.
> - POST /api/webhook/[userId]/[endpointName] — public ingress. Validate HMAC using WEBHOOK_INTERNAL_SECRET, look up the webhook row, and forward the payload to the gateway over HTTP (derived from NEXT_PUBLIC_GATEWAY_URL by swapping ws://→http://).
> - GET /api/webhook-data — surface recent webhook events into a widget so the user can see what's coming in.
>
> Support two modes per webhook: **direct** (payload is handed verbatim to the agent as a new user turn) and **provider** (payload is parsed by a provider-specific adapter first, e.g. GitHub, Stripe). Webhooks must also respect api/tool-permissions — an incoming event should only trigger tools the user has explicitly granted. Every webhook hit is logged to Supabase with the raw payload, the adapter used, and the turn it produced, so the user can replay or debug from the UI.

---

Prompt 6: User using it

> Wrap it up so a new user can go from clone to canvas with just an Anthropic API key. Build a marketing-style /landing page as the unauthenticated front door, with a sign-in CTA that drops the user into /dashboard on success. Add a Skills surface: /api/skills (CRUD) + a skills/ page where users install reusable, named agent capabilities; skills appear to the agent as callable tools and to the user as labeled cards. Add a TutorialWidget that onboards a first-time user inline on the canvas. Make the gateway URL, the shared secrets, and STORAGE_MODE all configurable via .env.local with sensible localhost defaults. Document the minimum deploy as just three things — Next.js app, gateway, Supabase — with MCP as opt-in. The golden path for a new person is: npm install in dyno-app/, npm install in dyno-app/gateway/, drop ANTHROPIC_API_KEY and the Supabase trio into .env.local, run both dev servers, open http://localhost:3000/landing. Nothing else.
