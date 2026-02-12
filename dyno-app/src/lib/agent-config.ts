/**
 * Centralized agent backend configuration.
 *
 * The frontend connects to the Gateway WebSocket server.
 * URL is configurable via NEXT_PUBLIC_GATEWAY_URL env variable.
 */

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "ws://localhost:18789";

export const WS_URL = GATEWAY_URL;

export const HEALTH_URL =
  GATEWAY_URL.replace("ws://", "http://").replace("wss://", "https://") + "/health";
