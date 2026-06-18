export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_NUM: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3,
};

const ENABLED = (process.env.LOG_LEVEL || "debug").toLowerCase() as LogLevel;

function fmt(level: LogLevel, tag: string, msg: string, ...args: any[]): string {
  const ts = new Date().toISOString().slice(11, 23);
  return `[${ts}] [${level.toUpperCase()}] [${tag}] ${msg}${args.length ? " " + args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ") : ""}`;
}

export const logger = {
  debug(tag: string, msg: string, ...args: any[]) {
    if (LEVEL_NUM[ENABLED] <= LEVEL_NUM.debug) console.debug(fmt("debug", tag, msg, ...args));
  },
  info(tag: string, msg: string, ...args: any[]) {
    if (LEVEL_NUM[ENABLED] <= LEVEL_NUM.info) console.log(fmt("info", tag, msg, ...args));
  },
  warn(tag: string, msg: string, ...args: any[]) {
    if (LEVEL_NUM[ENABLED] <= LEVEL_NUM.warn) console.warn(fmt("warn", tag, msg, ...args));
  },
  error(tag: string, msg: string, ...args: any[]) {
    if (LEVEL_NUM[ENABLED] <= LEVEL_NUM.error) console.error(fmt("error", tag, msg, ...args));
  },
};
