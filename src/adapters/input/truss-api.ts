import axios, { AxiosInstance } from 'axios';
import { logger } from '../../utils/logger';
import config from '../../config/config';
import {
  SecurityIndicator,
  ApiSearchFilter
} from '../../models/types';

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

  public async getAgentData(apiKey: string, configName: string): Promise<AgentData> {
    console.log('apiKey', apiKey);
    console.log('configName', configName);
    try {
      const response = await this.apiClient.post<AgentData>('/agent-data', {
        apiKey,
        configName
      });
      console.log('response', response);
      return response.data;
    } catch (error) {
      console.error('Error getting agent data:', error);
      throw error;
    }
  }

  public async searchIndicators(filter: ApiSearchFilter): Promise<SecurityIndicator[]> {
    try {
      const allIndicators: SecurityIndicator[] = [];
      let page = 1;
      const limit = 1000;
      let hasMore = true;

      while (hasMore) {
        const payload = {
          ...filter,
          page,
          limit,
        };

        const response = await this.apiClient.post<ProductSearchResponse>('/product/search', payload);

        if (!response.data) {
          throw new Error('No data received from API');
        }

        const data = response.data;
        const products = Array.isArray(data.products) ? data.products : [];
        const batch = products.map(mapProductToIndicator);

        allIndicators.push(...batch);
        hasMore = data.hasMore === true;
        page += 1;

        logger.info(`Retrieved batch of ${batch.length} indicators. Running total: ${allIndicators.length}`);
      }

      logger.info(`Completed retrieval of all indicators. Total count: ${allIndicators.length}`);
      return allIndicators;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error('API request failed:', {
          status: error.response?.status,
          message: error.message,
          data: error.response?.data
        });
      } else {
        logger.error('Error searching indicators:', error);
      }
      throw error;
    }
  }
}

export default TrussApi; 