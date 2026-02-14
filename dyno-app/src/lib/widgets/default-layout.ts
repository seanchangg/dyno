import type { Widget } from "@/types/widget";

/**
 * Default layout — widgets placed in the middle of the 48-column grid
 * so users can drag them in any direction (including left).
 *
 * Offset: +16 columns from origin. WidgetCanvas sets initial pan to match.
 */
const X = 0; // Left-aligned — no offset

const WELCOME_CONTENT = `# Welcome to Marty

This is a **widget**. Your dashboard is made of them — drag, resize, or close any of them. Marty can create any widget you can dream of: live charts, to-do lists, embedded apps, custom tools, you name it. Just ask.

Marty is your personal AI agent. He can **read and write files**, **run code**, **search the web**, **take screenshots**, and **spawn child agents** to work on tasks in parallel.

Give him a goal — not just a step. He'll figure out the rest. *Think big.*`;

const SETUP_CONTENT = `## Getting Started

1. Get your API key from the [Anthropic Developer Console](https://console.anthropic.com/settings/keys) (not the Claude chatbot — the developer platform)
2. Go to **Settings** in the sidebar and paste it
3. Come back here and start chatting with Marty

That's it. Once your key is saved, Marty is ready to go.`;

export const DEFAULT_WIDGETS: Widget[] = [
  {
    id: "welcome-banner",
    type: "markdown",
    x: X,
    y: 0,
    w: 7,
    h: 3,
    props: { content: WELCOME_CONTENT },
  },
  {
    id: "setup-guide",
    type: "markdown",
    x: X + 7,
    y: 0,
    w: 5,
    h: 3,
    props: { content: SETUP_CONTENT },
  },
  {
    id: "master-chat",
    type: "chat",
    x: X,
    y: 3,
    w: 7,
    h: 8,
    sessionId: "master",
  },
  {
    id: "tutorial",
    type: "tutorial",
    x: X + 7,
    y: 3,
    w: 5,
    h: 8,
  },
];
