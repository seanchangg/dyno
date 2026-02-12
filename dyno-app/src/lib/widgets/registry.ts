import type { ComponentType } from "react";

export interface WidgetRegistration {
  type: string;
  label: string;
  defaultW: number;
  defaultH: number;
  minW: number;
  minH: number;
  maxW: number;
  maxH: number;
  component: ComponentType<Record<string, unknown>>;
}

const registry = new Map<string, WidgetRegistration>();

export function registerWidget(reg: WidgetRegistration) {
  registry.set(reg.type, reg);
}

export function getWidget(type: string): WidgetRegistration | undefined {
  return registry.get(type);
}

export function getAllWidgetTypes(): WidgetRegistration[] {
  return Array.from(registry.values());
}
