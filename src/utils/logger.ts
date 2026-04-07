type Level = 'debug' | 'info' | 'warn' | 'error';

const DEFAULT_OPERATION = 'AGENT';
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase() as Level;
const levelRank: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function shouldLog(level: Level): boolean {
  return levelRank[level] >= levelRank[LOG_LEVEL];
}

function formatPrefix(operation: string, message: string): string {
  return `[${new Date().toISOString()}][${operation}]{${message}}`;
}

function normalizeArgs(args: unknown[]): { meta?: Record<string, unknown>; message: string } {
  if (args.length === 0) {
    return { message: 'Log event' };
  }

  if (typeof args[0] === 'string') {
    return { message: args[0] };
  }

  const meta = (args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]))
    ? (args[0] as Record<string, unknown>)
    : undefined;
  const message = typeof args[1] === 'string' ? args[1] : 'Log event';
  return { meta, message };
}

function emit(level: Level, ...args: unknown[]): void {
  if (!shouldLog(level)) return;

  const { meta, message } = normalizeArgs(args);
  const operation = typeof meta?.operation === 'string' ? meta.operation : DEFAULT_OPERATION;
  const line = formatPrefix(operation, message);

  if (meta) {
    const { operation: _op, ...rest } = meta;
    if (Object.keys(rest).length > 0) {
      // Keep metadata available, but ensure prefix is always first.
      console.log(`${line} ${JSON.stringify({ level, ...rest })}`);
      return;
    }
  }

  console.log(`${line} ${JSON.stringify({ level })}`);
}

export const logger = {
  debug: (...args: unknown[]) => emit('debug', ...args),
  info: (...args: unknown[]) => emit('info', ...args),
  warn: (...args: unknown[]) => emit('warn', ...args),
  error: (...args: unknown[]) => emit('error', ...args),
};