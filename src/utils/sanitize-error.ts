import axios from 'axios';

/**
 * Return a log-safe representation of an error. Strips request config (headers, API keys, etc.)
 * so secrets are never written to logs.
 */
export function sanitizeErrorForLog(err: unknown): Record<string, unknown> {
  if (axios.isAxiosError(err)) {
    return {
      name: err.name,
      message: err.message,
      code: err.code,
      status: err.response?.status,
      responseData: err.response?.data,
      url: err.config?.url,
      method: err.config?.method,
      // Do not log: err.config (contains headers with x-api-key, etc.)
    };
  }
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  return { err: String(err) };
}
