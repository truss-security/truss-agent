import axios, { AxiosInstance, type AxiosResponse } from 'axios';
import { logger } from '../../utils/logger';
import { sanitizeErrorForLog } from '../../utils/sanitize-error';
import config from '../../config/config';
import {
  SecurityIndicator,
  ApiSearchFilter
} from '../../models/types';
import { buildProductSearchPayload } from './build-product-search-payload';

/** Truss API /product/search response shape (products array + pagination). */
interface ProductSearchResponse {
  products?: unknown[];
  total?: number;
  page?: number;
  limit?: number;
  hasMore?: boolean;
}

/** Map API product (snake_case) to SecurityIndicator (camelCase). */
function mapProductToIndicator(item: unknown): SecurityIndicator {
  const p = item as Record<string, unknown>;
  const id = p.id != null ? String(p.id) : '';
  const pubDate = p.pub_date != null
    ? (typeof p.pub_date === 'string' ? p.pub_date : (p.pub_date as Date)?.toISOString?.() ?? String(p.pub_date))
    : undefined;
  const timestamp = p.timestamp != null
    ? (typeof p.timestamp === 'string' ? p.timestamp : (p.timestamp as Date)?.toISOString?.() ?? String(p.timestamp))
    : new Date().toISOString();
  return {
    id,
    title: p.title as string | undefined,
    author: Array.isArray(p.author) ? (p.author as string[]) : undefined,
    type: p.type as string | undefined,
    category: p.category as string | undefined,
    source: p.source as string | undefined,
    pubDate,
    reference: Array.isArray(p.reference) ? (p.reference as string[]) : undefined,
    tags: Array.isArray(p.tags) ? (p.tags as string[]) : undefined,
    industry: Array.isArray(p.industry) ? (p.industry as string[]) : undefined,
    region: Array.isArray(p.region) ? (p.region as string[]) : undefined,
    indicators: (p.indicators && typeof p.indicators === 'object' && !Array.isArray(p.indicators))
      ? (p.indicators as Record<string, unknown>)
      : {},
    validators: Array.isArray(p.validators) ? (p.validators as string[]) : undefined,
    downloads: typeof p.downloads === 'number' ? p.downloads : undefined,
    rating: typeof p.rating === 'number' ? p.rating : undefined,
    timestamp,
  };
}

export type AgentData = {
  apiKey: string;
  username: string;
  filterName: string;
  filter: ApiSearchFilter;
  runIntervalMinutes: number;
  serviceName: string;
  serviceUrl: string;
  serviceKey: string;
  serviceUser: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headerRetryAfterMs(headers: AxiosResponse['headers'] | undefined): number | undefined {
  if (!headers) return undefined;
  const raw =
    (typeof headers.get === 'function' ? headers.get('retry-after') : undefined) ??
    (headers as Record<string, unknown>)['retry-after'] ??
    (headers as Record<string, unknown>)['Retry-After'];
  if (raw == null || raw === '') return undefined;
  const s = String(raw).trim();
  const seconds = Number(s);
  if (!Number.isNaN(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const when = Date.parse(s);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return undefined;
}

class TrussApi {
  private apiClient: AxiosInstance;
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKeyOverride?: string) {
    this.baseUrl = config.get('indicators.apiUrl');
    this.apiKey = apiKeyOverride ?? config.get('indicators.apiKey');

    this.apiClient = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
    });
  }

  /**
   * POST with retries for rate limits and transient errors.
   *
   * - **TRUSS_API_RETRY_BUDGET_MS** — Total wall time for this POST (from first try through failed attempts
   *   and sleeps before the next try). When exhausted, we log and throw so the job queue advances.
   * - **TRUSS_API_RETRY_MAX_MS** — Max length of *one* sleep (caps exponential backoff and huge
   *   `Retry-After`). When the budget is smaller, the effective per-wait cap is min(max, budget) so you
   *   never schedule a single wait longer than the total budget.
   *
   * Env: TRUSS_API_MAX_RETRIES (8), TRUSS_API_RETRY_BASE_MS (1000), TRUSS_API_RETRY_MAX_MS (120000),
   * TRUSS_API_RETRY_BUDGET_MS (60000), TRUSS_API_PAGE_DELAY_MS (pagination only).
   */
  private async postWithRetry<T>(
    url: string,
    body: unknown,
    context: string
  ): Promise<AxiosResponse<T>> {
    const maxAttempts = Math.max(1, parseInt(process.env.TRUSS_API_MAX_RETRIES ?? '8', 10));
    const baseDelayMs = Math.max(100, parseInt(process.env.TRUSS_API_RETRY_BASE_MS ?? '1000', 10));
    const maxDelayMs = Math.max(baseDelayMs, parseInt(process.env.TRUSS_API_RETRY_MAX_MS ?? '120000', 10));
    const budgetMs = Math.max(1000, parseInt(process.env.TRUSS_API_RETRY_BUDGET_MS ?? '60000', 10));
    /** Single sleep cannot exceed this (nor the overall budget). */
    const perWaitCapMs = Math.min(maxDelayMs, budgetMs);

    const t0 = Date.now();
    let attempt = 0;
    while (true) {
      try {
        return await this.apiClient.post<T>(url, body);
      } catch (error) {
        if (!axios.isAxiosError(error)) throw error;
        const status = error.response?.status;
        const retryable = status === 429 || status === 503 || status === 502;
        if (!retryable || attempt >= maxAttempts - 1) throw error;

        const elapsed = Date.now() - t0;
        if (elapsed >= budgetMs) {
          logger.error(
            {
              operation: 'AGENT PULL',
              url,
              status,
              context,
              elapsedMs: elapsed,
              budgetMs,
            },
            'Truss API retry budget elapsed without success; giving up on this request'
          );
          throw error;
        }

        attempt += 1;
        const fromHeader = headerRetryAfterMs(error.response?.headers);
        const backoff = Math.min(
          fromHeader ?? baseDelayMs * 2 ** (attempt - 1),
          perWaitCapMs
        );

        if (Date.now() - t0 + backoff > budgetMs) {
          logger.error(
            {
              operation: 'AGENT PULL',
              url,
              status,
              context,
              attempt,
              waitMs: backoff,
              elapsedMs: Date.now() - t0,
              budgetMs,
            },
            'Truss API retry backoff would exceed budget; giving up on this request'
          );
          throw error;
        }

        logger.warn(
          {
            operation: 'AGENT PULL',
            url,
            status,
            attempt,
            maxAttempts,
            waitMs: backoff,
            budgetMs,
            context,
          },
          'Truss API returned retryable status; waiting before retry'
        );
        await sleep(backoff);
      }
    }
  }

  public async getAgentData(apiKey: string, configName: string): Promise<AgentData> {
    try {
      const response = await this.postWithRetry<AgentData>('/agent-data', { apiKey, configName }, 'agent-data');
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const msg =
          status === 429
            ? 'Truss API rate limit (429) getting agent data. Limit exceeded.'
            : status && status >= 500
              ? 'Truss API server error (5xx) getting agent data. Try again later.'
              : 'Error getting agent data';
        logger.error(
          {
            operation: 'AGENT PULL',
            status,
            message: error.message,
            responseData: error.response?.data,
            configName,
          },
          msg
        );
      } else {
        logger.error({ operation: 'AGENT PULL', ...sanitizeErrorForLog(error) }, 'Error getting agent data');
      }
      throw error;
    }
  }

  public async searchIndicators(filter: ApiSearchFilter): Promise<SecurityIndicator[]> {
    try {
      const allIndicators: SecurityIndicator[] = [];
      let page = 1;
      const limit = 1000;
      let hasMore = true;
      const pageDelayMs = Math.max(0, parseInt(process.env.TRUSS_API_PAGE_DELAY_MS ?? '300', 10));

      while (hasMore) {
        const payload = buildProductSearchPayload(filter, page, limit);

        const response = await this.postWithRetry<ProductSearchResponse>(
          '/product/search',
          payload,
          `product/search page ${page}`
        );

        if (!response.data) {
          throw new Error('No data received from API');
        }

        const data = response.data;
        const products = Array.isArray(data.products) ? data.products : [];
        const batch = products.map(mapProductToIndicator);

        allIndicators.push(...batch);
        hasMore = data.hasMore === true;
        page += 1;

        logger.debug(`Retrieved batch of ${batch.length} indicators. Running total: ${allIndicators.length}`);

        if (hasMore && pageDelayMs > 0) {
          await sleep(pageDelayMs);
        }
      }

      logger.debug(`Completed retrieval of all indicators. Total count: ${allIndicators.length}`);
      return allIndicators;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        const message =
          status === 429
            ? 'Truss API rate limit (429). Limit exceeded.'
            : status && status >= 500
              ? 'Truss API server error (5xx). Try again later or contact the API provider.'
              : 'Truss API request failed.';
        logger.error(
          {
            operation: 'AGENT PULL',
            status,
            message: error.message,
            responseData: data,
            url: error.config?.url,
          },
          message
        );
      } else {
        logger.error({ operation: 'AGENT PULL', err: error }, 'Error searching indicators');
      }
      throw error;
    }
  }
}

export default TrussApi; 