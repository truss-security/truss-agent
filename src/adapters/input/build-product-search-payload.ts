import type { ApiSearchFilter } from '../../models/types';

/** Legacy multi-value fields mapped to FilterQL attribute names (POST /product/search). */
export const LEGACY_ARRAY_FILTER_KEYS = [
  'category',
  'source',
  'author',
  'industry',
  'region',
  'reference',
  'tags',
  'indicators',
] as const;

export type LegacyArrayFilterKey = (typeof LEGACY_ARRAY_FILTER_KEYS)[number];

function escapeFilterQlLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function comparisonsForAttribute(attr: string, values: string[]): string {
  const parts = values.map((v) => `${attr} = "${escapeFilterQlLiteral(v)}"`);
  if (parts.length === 1) return parts[0];
  return `(${parts.join(' OR ')})`;
}

/**
 * Build FilterQL from legacy array filters (when `filterExpression` is not set).
 */
export function legacyArraysToFilterExpression(filter: ApiSearchFilter): string | undefined {
  const clauses: string[] = [];
  for (const key of LEGACY_ARRAY_FILTER_KEYS) {
    const arr = filter[key];
    if (Array.isArray(arr) && arr.length > 0) {
      const trimmed = arr.map((s) => String(s).trim()).filter(Boolean);
      if (trimmed.length > 0) clauses.push(comparisonsForAttribute(key, trimmed));
    }
  }
  if (clauses.length === 0) return undefined;
  return clauses.join(' AND ');
}

/**
 * Resolved body for POST /product/search — only whitelisted keys.
 */
export interface ProductSearchPayload {
  filterExpression?: string;
  startDate?: string | number;
  endDate?: string | number;
  days?: number;
  page: number;
  limit: number;
  order_by?: 'pub_date' | 'downloads' | 'rating' | 'timestamp';
  order_direction?: 'asc' | 'desc';
}

/**
 * Map agent `ApiSearchFilter` to POST /product/search JSON body.
 * Drops legacy array fields; uses `filterExpression` or compiles arrays to FilterQL.
 * When `startDate` is present, omits `days` so the API does not override the rolling window.
 */
export function buildProductSearchPayload(
  filter: ApiSearchFilter,
  page: number,
  limit: number
): ProductSearchPayload {
  const trimmedExpr = filter.filterExpression?.trim();
  const fromExpr = trimmedExpr ? trimmedExpr : undefined;
  const fromArrays = fromExpr ? undefined : legacyArraysToFilterExpression(filter);

  const payload: ProductSearchPayload = {
    page,
    limit,
  };

  if (fromExpr) {
    payload.filterExpression = fromExpr;
  } else if (fromArrays) {
    payload.filterExpression = fromArrays;
  }

  if (filter.startDate != null) {
    payload.startDate = filter.startDate;
  }
  if (filter.endDate != null) {
    payload.endDate = filter.endDate;
  }
  if (filter.days != null && filter.startDate == null) {
    payload.days = filter.days;
  }

  if (filter.order_by != null) {
    payload.order_by = filter.order_by;
  }
  if (filter.order_direction != null) {
    payload.order_direction = filter.order_direction;
  }

  return payload;
}
