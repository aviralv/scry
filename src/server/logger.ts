// src/server/logger.ts
// Minimal leveled logger for scry server. All output goes to stderr
// so stdout stays clean for JSON results (CLI search output).
// No external dependencies — this is intentionally tiny.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const currentLevel: LogLevel = (process.env.SCRY_LOG_LEVEL as LogLevel) ?? 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function format(level: LogLevel, msg: string): string {
  return `scry [${level}]: ${msg}`;
}

export const log = {
  debug(msg: string): void {
    if (shouldLog('debug')) process.stderr.write(format('debug', msg) + '\n');
  },
  info(msg: string): void {
    if (shouldLog('info')) process.stderr.write(format('info', msg) + '\n');
  },
  warn(msg: string): void {
    if (shouldLog('warn')) process.stderr.write(format('warn', msg) + '\n');
  },
  error(msg: string): void {
    if (shouldLog('error')) process.stderr.write(format('error', msg) + '\n');
  },
};
