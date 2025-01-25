import { logger } from '../utils/logger';
import TrussIndicatorApi from '../adapters/input/truss-indicator-api';
import { SplunkAgent } from '../adapters/output/splunk';
import { ApiSearchFilter } from '../models/types';
import config from '../config/config';

class IndicatorSyncService {
  private trussApi: TrussIndicatorApi;
  private splunkOutput: SplunkAgent;

  constructor() {
    this.trussApi = new TrussIndicatorApi();
    this.splunkOutput = new SplunkAgent();
  }

  async initialize(): Promise<void> {
    try {
      // Initialize Splunk connection if enabled
      if (config.get('outputs.splunk.enabled')) {
        await this.splunkOutput.initialize();
      }
    } catch (error) {
      logger.error('Failed to initialize IndicatorSyncService:', error);
      throw error;
    }
  }

  async syncIndicators(): Promise<void> {
    try {
      // Example filter - in production this might come from configuration
      const filter: ApiSearchFilter = {
        fromDate: Date.now() - (24 * 60 * 60 * 1000), // Last 24 hours
        filter: {
          category: ['malware', 'phishing'],
          industry: ['technology', 'finance']
        }
      };

      logger.info('Starting indicator sync with filter:', filter);

      // Fetch indicators from Truss API
      const indicators = await this.trussApi.searchIndicators(filter);
      logger.info(`Retrieved ${indicators.length} indicators from Truss API`);

      if (indicators.length === 0) {
        logger.info('No new indicators to process');
        return;
      }

      // Push to Splunk if enabled
      if (config.get('outputs.splunk.enabled')) {
        await this.splunkOutput.pushIndicators(indicators);
        
        // Create a saved search in Splunk for these indicators
        const searchName = `SecurityIndicators_${new Date().toISOString().split('T')[0]}`;
        
        // Extract indicator values for the search
        const searchIndicators: Record<string, string[]> = {};
        indicators.forEach(indicator => {
          Object.entries(indicator.indicators).forEach(([key, value]) => {
            if (!searchIndicators[key]) {
              searchIndicators[key] = [];
            }
            if (Array.isArray(value)) {
              searchIndicators[key].push(...value);
            } else {
              searchIndicators[key].push(value.toString());
            }
          });
        });

        await this.splunkOutput.createSavedSearch(searchName, searchIndicators, {
          earliest_time: '-24h',
          latest_time: 'now'
        });
      }

      logger.info('Indicator sync completed successfully');
    } catch (error) {
      logger.error('Error during indicator sync:', error);
      throw error;
    }
  }
}

export default IndicatorSyncService; 