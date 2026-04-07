import pino from 'pino';

const DEFAULT_OPERATION = 'AGENT';

function getUtcTimestamp(): string {
  return new Date().toISOString();
}

function formatMessage(message: string, operation: string): string {
  return `[${getUtcTimestamp()}][${operation}]{${message}}`;
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  hooks: {
    logMethod(args, method) {
      const mutableArgs = [...args];
      const firstArg = mutableArgs[0];
      const operation =
        firstArg && typeof firstArg === 'object' && !Array.isArray(firstArg) && typeof (firstArg as Record<string, unknown>).operation === 'string'
          ? String((firstArg as Record<string, unknown>).operation)
          : DEFAULT_OPERATION;

      const lastArg = mutableArgs[mutableArgs.length - 1];
      if (typeof lastArg === 'string') {
        mutableArgs[mutableArgs.length - 1] = formatMessage(lastArg, operation);
      } else {
        mutableArgs.push(formatMessage('Log event', operation));
      }

      method.apply(this, mutableArgs as Parameters<typeof method>);
    },
  },
}); 