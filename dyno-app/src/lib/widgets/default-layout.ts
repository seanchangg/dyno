import type { Widget } from "@/types/widget";

/**
 * Default layout mirrors the current hardcoded dashboard:
 * - Master chat (left, top)
 * - Memory table (left, below chat)
 * - Four stat cards stacked on the right
 */
export const DEFAULT_WIDGETS: Widget[] = [
  {
    id: "master-chat",
    type: "chat",
    x: 0,
    y: 0,
    w: 7,
    h: 8,
    sessionId: "master",
  },
  {
    id: "memory-table",
    type: "memory-table",
    x: 0,
    y: 8,
    w: 7,
    h: 5,
  },
  {
    id: "stat-agent-status",
    type: "stat-card",
    x: 7,
    y: 0,
    w: 5,
    h: 2,
    props: { title: "Agent Status", dataSource: "agent-status" },
  },
  {
    id: "stat-sessions",
    type: "stat-card",
    x: 7,
    y: 2,
    w: 5,
    h: 2,
    props: { title: "Sessions", dataSource: "sessions" },
  },
  {
    id: "stat-tokens",
    type: "stat-card",
    x: 7,
    y: 4,
    w: 5,
    h: 2,
    props: { title: "Tokens In / Out", dataSource: "token-usage" },
  },
  {
    id: "stat-cost",
    type: "stat-card",
    x: 7,
    y: 6,
    w: 5,
    h: 2,
    props: { title: "Est. Total Cost", dataSource: "cost" },
  },
  {
    id: "screenshot-gallery",
    type: "screenshot-gallery",
    x: 7,
    y: 8,
    w: 5,
    h: 5,
  },
];
