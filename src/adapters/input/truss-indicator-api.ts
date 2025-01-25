import axios, { AxiosInstance } from 'axios';
import { logger } from '../../utils/logger';
import config from '../../config/config';
import { 
  SecurityIndicator, 
  ApiSearchFilter
} from '../../models/types';

interface LastEvaluatedKey {
  GSI1PK: string;
  SK: string;
  GSI1SK: number;
  PK: string;
}

interface ApiResponse {
  Items: SecurityIndicator[];
  LastEvaluatedKey?: LastEvaluatedKey;
  Count: number;
}

class TrussIndicatorApi {
  private apiClient: AxiosInstance;
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = config.get('indicators.apiUrl');
    this.apiKey = config.get('indicators.apiKey');

    this.apiClient = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
    });
  }

  public async searchIndicators(filter: ApiSearchFilter): Promise<SecurityIndicator[]> {
    try {
      let allIndicators: SecurityIndicator[] = [];
      let lastEvaluatedKey: LastEvaluatedKey | undefined;

      do {
        const currentFilter = {
          ...filter,
          LastEvaluatedKey: lastEvaluatedKey
        };

        const response = await this.apiClient.post<ApiResponse>('/product/search', currentFilter);
        
        if (!response.data) {
          throw new Error('No data received from API');
        }

        const { Items, LastEvaluatedKey: newLastEvaluatedKey } = response.data;

        if (!Items) {
          throw new Error('No items in API response');
        }

        const indicators = Items.map(item => item as SecurityIndicator);
        allIndicators = [...allIndicators, ...indicators];
        lastEvaluatedKey = newLastEvaluatedKey;

        logger.info(`Retrieved batch of ${indicators.length} indicators. Running total: ${allIndicators.length}`);

      } while (lastEvaluatedKey);

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

export default TrussIndicatorApi; 