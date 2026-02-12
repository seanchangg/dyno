export interface Widget {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  props?: Record<string, unknown>;
  sessionId?: string;
}

export interface WidgetLayout {
  widgets: Widget[];
  version: number;
}

export type UIActionType = "add" | "remove" | "update" | "move" | "resize" | "clear" | "reset";

export interface UIAction {
  action: UIActionType;
  widgetId: string;
  widgetType?: string;
  position?: { x: number; y: number };
  size?: { w: number; h: number };
  props?: Record<string, unknown>;
  sessionId?: string;
}
