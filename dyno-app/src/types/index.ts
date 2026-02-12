export * from "./widget";

export type AgentStatus = "online" | "working" | "offline";

export interface ChatSettings {
  maxHistoryMessages: number;
  maxStoredMessages: number;
  includeSystemContext: boolean;
  includeToolDescriptions: boolean;
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  maxHistoryMessages: 50,
  maxStoredMessages: 200,
  includeSystemContext: true,
  includeToolDescriptions: false,
};

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  encrypted_api_key: string | null;
  chat_settings: ChatSettings | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: ThinkingStep[];
  timestamp: number;
}

export type ThinkingStepType = "thought" | "tool_call" | "tool_result";

export interface ThinkingStep {
  type: ThinkingStepType;
  content: string;
  timestamp: number;
}

export interface TelemetryEntry {
  id: string;
  sessionId: string;
  prompt: string;
  response: string;
  thinkingSteps: ThinkingStep[];
  tokensIn: number;
  tokensOut: number;
  timestamp: number;
}

export interface AgentContext {
  filename: string;
  content: string;
  lastModified: number;
}

export interface ToolFile {
  name: string;
  description: string;
  code: string;
  createdAt: number;
}

// --- Agent Lab Types ---

export type BuildEventType =
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "proposal"
  | "execution_result"
  | "done"
  | "error"
  | "session_created"
  | "session_ended"
  | "ui_mutation";

export interface BuildEvent {
  type: BuildEventType;
  id?: string;
  tool?: string;
  input?: Record<string, string>;
  text?: string;
  result?: string;
  displayTitle?: string;
  status?: "completed" | "denied";
  error?: string;
  summary?: string;
  tokensIn?: number;
  tokensOut?: number;
  message?: string;
  sessionId?: string;
  timestamp: number;
}

export type ProposalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "executing"
  | "completed"
  | "failed";

export interface ProposedAction {
  id: string;
  tool: string;
  input: Record<string, string>;
  displayTitle: string;
  status: ProposalStatus;
  result?: string;
  error?: string;
  tokensIn?: number;
  tokensOut?: number;
  costSoFar?: number;
  iteration?: number;
}

export interface BuildPlanStep {
  tool: string;
  target: string;
  description: string;
}

export interface BuildPlan {
  summary: string;
  steps: BuildPlanStep[];
  files: string[];
  packages: string[];
  estimatedIterations: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCost: string;
  complexity: string;
  reasoning: string;
}

export interface PlanResult {
  plan: BuildPlan;
  planTokensIn: number;
  planTokensOut: number;
  planCost: number;
}

export type PermissionMode = "auto" | "manual";

export interface ToolPermissions {
  write_file: PermissionMode;
  modify_file: PermissionMode;
  install_package: PermissionMode;
  read_file: PermissionMode;
  list_files: PermissionMode;
  take_screenshot: PermissionMode;
  read_upload: PermissionMode;
  fetch_url: PermissionMode;
}

export interface ScreenshotMeta {
  filename: string;
  size: number;
  createdAt: number;
}

export type AttachmentType = "file" | "url";

export interface Attachment {
  id: string;
  type: AttachmentType;
  name: string;
  url?: string;
}
