export interface ApiSearchFilter {
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
