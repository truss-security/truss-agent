type ProductAttribute = 'category' | 'source' | 'author' | 'industry' | 'region' | 'reference' | 'tags' | 'indicators'

export type ProductFilter = Partial<Record<ProductAttribute, string[]>>;

export interface ApiSearchFilter {
  filter?: ProductFilter;
  fromDate?: number;
  toDate?: number;
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
