import type { Widget } from "@/types/widget";

/**
 * Default layout — widgets placed in the middle of the 48-column grid
 * so users can drag them in any direction (including left).
 *
 * Offset: +16 columns from origin. WidgetCanvas sets initial pan to match.
 */
const X = 0; // Left-aligned — no offset

export const DEFAULT_WIDGETS: Widget[] = [
  {
    id: "master-chat",
    type: "chat",
    x: X,
    y: 0,
    w: 7,
    h: 8,
    sessionId: "master",
  },
  {
    id: "tutorial",
    type: "tutorial",
    x: X + 7,
    y: 0,
    w: 5,
    h: 8,
  },
  {
    id: "memory-table",
    type: "memory-table",
    x: X,
    y: 8,
    w: 7,
    h: 5,
  },
  {
    id: "stat-agent-status",
    type: "stat-card",
    x: X + 12,
    y: 0,
    w: 5,
    h: 2,
    props: { title: "Agent Status", dataSource: "agent-status" },
  },
  {
    id: "stat-cost",
    type: "stat-card",
    x: X + 12,
    y: 2,
    w: 5,
    h: 2,
    props: { title: "Est. Total Cost", dataSource: "cost" },
  },
  {
    id: "agent-control",
    type: "agent-control",
    x: X + 12,
    y: 4,
    w: 5,
    h: 9,
  },
  {
    id: "screenshot-gallery",
    type: "screenshot-gallery",
    x: X + 7,
    y: 8,
    w: 5,
    h: 5,
  },
];
