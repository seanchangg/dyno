import { registerWidget } from "./registry";
import { lazy } from "react";

const ChatWidget = lazy(() => import("@/components/widgets/ChatWidget"));
const StatCardWidget = lazy(() => import("@/components/widgets/StatCardWidget"));
const MemoryWidget = lazy(() => import("@/components/widgets/MemoryWidget"));
const ScreenshotWidget = lazy(() => import("@/components/widgets/ScreenshotWidget"));
const MarkdownWidget = lazy(() => import("@/components/widgets/MarkdownWidget"));
const CodeBlockWidget = lazy(() => import("@/components/widgets/CodeBlockWidget"));
const ImageWidget = lazy(() => import("@/components/widgets/ImageWidget"));
const TableWidget = lazy(() => import("@/components/widgets/TableWidget"));
const HtmlWidget = lazy(() => import("@/components/widgets/HtmlWidget"));

export function registerBuiltInWidgets() {
  registerWidget({
    type: "chat",
    label: "Chat",
    defaultW: 7,
    defaultH: 8,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 20,
    component: ChatWidget as React.ComponentType<Record<string, unknown>>,
  });

  registerWidget({
    type: "stat-card",
    label: "Stat Card",
    defaultW: 3,
    defaultH: 2,
    minW: 2,
    minH: 2,
    maxW: 6,
    maxH: 4,
    component: StatCardWidget as React.ComponentType<Record<string, unknown>>,
  });

  registerWidget({
    type: "memory-table",
    label: "Memory Table",
    defaultW: 7,
    defaultH: 5,
    minW: 4,
    minH: 3,
    maxW: 12,
    maxH: 12,
    component: MemoryWidget as React.ComponentType<Record<string, unknown>>,
  });

  registerWidget({
    type: "screenshot-gallery",
    label: "Screenshot Gallery",
    defaultW: 5,
    defaultH: 5,
    minW: 3,
    minH: 3,
    maxW: 12,
    maxH: 12,
    component: ScreenshotWidget as React.ComponentType<Record<string, unknown>>,
  });

  registerWidget({
    type: "markdown",
    label: "Markdown",
    defaultW: 4,
    defaultH: 4,
    minW: 2,
    minH: 2,
    maxW: 12,
    maxH: 20,
    component: MarkdownWidget as React.ComponentType<Record<string, unknown>>,
  });

  registerWidget({
    type: "code-block",
    label: "Code Block",
    defaultW: 6,
    defaultH: 4,
    minW: 3,
    minH: 2,
    maxW: 12,
    maxH: 16,
    component: CodeBlockWidget as React.ComponentType<Record<string, unknown>>,
  });

  registerWidget({
    type: "image",
    label: "Image",
    defaultW: 4,
    defaultH: 4,
    minW: 2,
    minH: 2,
    maxW: 12,
    maxH: 12,
    component: ImageWidget as React.ComponentType<Record<string, unknown>>,
  });

  registerWidget({
    type: "table",
    label: "Table",
    defaultW: 6,
    defaultH: 4,
    minW: 3,
    minH: 2,
    maxW: 12,
    maxH: 16,
    component: TableWidget as React.ComponentType<Record<string, unknown>>,
  });

  registerWidget({
    type: "html",
    label: "HTML",
    defaultW: 6,
    defaultH: 5,
    minW: 2,
    minH: 2,
    maxW: 12,
    maxH: 20,
    component: HtmlWidget as React.ComponentType<Record<string, unknown>>,
  });
}
