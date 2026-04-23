/** Must match POST /product/search allowed `order_by` values. */
export type ProductSearchOrderBy = 'pub_date' | 'downloads' | 'rating' | 'timestamp';

export interface ApiSearchFilter {
  /** FilterQL for POST /product/search; takes precedence over legacy array fields when building the request body. */
  filterExpression?: string;
  /** Relative window; omitted from API body when `startDate` is set (rolling jobs always set start/end). */
  days?: number;
  order_by?: ProductSearchOrderBy;
  order_direction?: 'asc' | 'desc';
  startDate?: number | string;
  endDate?: number | string;
  category?: string[];
  source?: string[];
  author?: string[];
  industry?: string[];
  region?: string[];
  reference?: string[];
  tags?: string[];
  indicators?: string[];
}

export interface SecurityIndicator {
  id: string;
  title?: string;
  author?: string[];
  type?: string;
  category?: string;
  source?: string;
  pubDate?: string;
  reference?: string[];
  tags?: string[];
  industry?: string[];
  region?: string[];
  indicators: {
    [key: string]: any;
  };
  validators?: string[];
  downloads?: number;
  rating?: number;
  timestamp: string;
}
