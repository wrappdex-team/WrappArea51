/**
 * Production-Safe Logger
 *
 * Replaces raw console.* calls with structured, level-aware logging.
 * In production builds, only warnings and errors are emitted.
 * In development, all levels are active.
 *
 * Usage:
 *   import { log } from "../utils/logger";
 *   log.info("SwapPanel", "Swap executed", { txId });
 *   log.error("HashPack", "Connection failed", error);
 *   log.warn("API", "Rate limit approaching");
 *   log.debug("SRMM", "Simulation tick", { price: 0.28 });
 */

import { ENV } from "./env";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: unknown;
}

// Circular buffer for recent logs (accessible via dev tools)
const LOG_BUFFER_SIZE = 200;
const _logBuffer: LogEntry[] = [];

function pushToBuffer(entry: LogEntry): void {
  _logBuffer.push(entry);
  if (_logBuffer.length > LOG_BUFFER_SIZE) {
    _logBuffer.shift();
  }
}

// Expose buffer globally for debugging (dev only — production builds must not
// surface the ring buffer, which may contain request parameters or wallet data)
if (typeof window !== "undefined" && ENV.IS_DEV) {
  (window as any).__HBARH_LOGS__ = _logBuffer;
}

function createEntry(
  level: LogLevel,
  module: string,
  message: string,
  data?: unknown
): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    data,
  };
}

function formatPrefix(level: LogLevel, module: string): string {
  return `[HBAR.h][${module}]`;
}

// ── Level Gate ─────────────────────────────────────────────────────
// In production: only warn + error
// In development: all levels
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel = ENV.IS_PROD ? "warn" : "debug";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[MIN_LEVEL];
}

// ── Public API ─────────────────────────────────────────────────────

function debug(module: string, message: string, data?: unknown): void {
  const entry = createEntry("debug", module, message, data);
  pushToBuffer(entry);
  if (shouldLog("debug")) {
    console.debug(formatPrefix("debug", module), message, data ?? "");
  }
}

function info(module: string, message: string, data?: unknown): void {
  const entry = createEntry("info", module, message, data);
  pushToBuffer(entry);
  if (shouldLog("info")) {
    console.log(formatPrefix("info", module), message, data ?? "");
  }
}

function warn(module: string, message: string, data?: unknown): void {
  const entry = createEntry("warn", module, message, data);
  pushToBuffer(entry);
  if (shouldLog("warn")) {
    console.warn(formatPrefix("warn", module), message, data ?? "");
  }
}

function error(module: string, message: string, data?: unknown): void {
  const entry = createEntry("error", module, message, data);
  pushToBuffer(entry);
  // Always log errors
  console.error(formatPrefix("error", module), message, data ?? "");
}

/** Get the recent log buffer (for diagnostics panel) */
function getBuffer(): ReadonlyArray<LogEntry> {
  return _logBuffer;
}

/** Clear the log buffer */
function clearBuffer(): void {
  _logBuffer.length = 0;
}

export const log = {
  debug,
  info,
  warn,
  error,
  getBuffer,
  clearBuffer,
} as const;

export type { LogLevel, LogEntry };