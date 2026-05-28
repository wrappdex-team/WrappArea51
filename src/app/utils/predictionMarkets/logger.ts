export const log = {
  info: (msg: string, ...args: any[]) => console.log(`[INFO] ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => console.warn(`[WARN] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[ERROR] ${msg}`, ...args),
  success: (msg: string, ...args: any[]) => console.log(`✅ ${msg}`, ...args),
};

// Also export as default logger object for flexibility
export const logger = log;
