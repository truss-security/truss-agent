export const SCALAR_ATTRIBUTES = ['category', 'source'] as const;
export const ARRAY_ATTRIBUTES = ['author', 'industry', 'region', 'reference', 'tags'] as const;
export const INDICATOR_ATTRIBUTES = ['indicators'] as const;
export const PRODUCT_ATTRIBUTES = [...SCALAR_ATTRIBUTES, ...ARRAY_ATTRIBUTES, ...INDICATOR_ATTRIBUTES] as const;

export type ScalarAttribute = (typeof SCALAR_ATTRIBUTES)[number];
export type ArrayAttribute = (typeof ARRAY_ATTRIBUTES)[number];
export type IndicatorAttribute = (typeof INDICATOR_ATTRIBUTES)[number];
export type ProductAttribute = ScalarAttribute | ArrayAttribute | IndicatorAttribute;

export interface ProductFilter {
  [key in ProductAttribute]?: string[];
}

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
