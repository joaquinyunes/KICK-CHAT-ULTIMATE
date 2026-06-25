import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

const base = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  transport: isDev ? { target: "pino-pretty" } : undefined,
});

export const logger = {
  debug(tag: string, msg: string, ...args: any[]) {
    base.debug({ tag }, msg, ...args);
  },
  info(tag: string, msg: string, ...args: any[]) {
    base.info({ tag }, msg, ...args);
  },
  warn(tag: string, msg: string, ...args: any[]) {
    base.warn({ tag }, msg, ...args);
  },
  error(tag: string, msg: string, ...args: any[]) {
    base.error({ tag }, msg, ...args);
  },
};
