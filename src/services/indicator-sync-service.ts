import { logger } from '../utils/logger';
import TrussApi, { AgentData } from '../adapters/input/truss-api';
import { SplunkAgent } from '../adapters/output/splunk';
import { ApiSearchFilter } from '../models/types';
import config from '../config/config';

class IndicatorSyncService {
  private trussApi: TrussApi;
  private splunkOutput: SplunkAgent;

  constructor() {
    this.trussApi = new TrussApi();
    this.splunkOutput = new SplunkAgent();
  }

  async initialize(): Promise<void> {
    try {
      // Initialize Splunk connection if enabled
      // if (config.get('outputs.splunk.enabled')) {
      //   await this.splunkOutput.initialize();
      // }
    } catch (error) {
      logger.error('Failed to initialize IndicatorSyncService:', error);
      throw error;
    }
  }

  async syncIndicators(): Promise<void> {
    try {
      // Example filter - in production this might come from configuration
      // const filter: ApiSearchFilter = {
      //   startDate: Date.now() - (24 * 60 * 60 * 1000), // Last 24 hours
      //   category: ['Malware']
      // };

      let filter: ApiSearchFilter = {}

      

      // Fetch agent data from Truss API
      const apiKey = process.env.TRUSS_API_KEY;
      if (!apiKey) {
        throw new Error('TRUSS_API_KEY is not set');
      }
      const agentData: AgentData = await this.trussApi.getAgentData(apiKey, 'Discord');
      logger.info(`Retrieved agent data from Truss API`);
      console.log('agentData', agentData);

      filter = {
        fromDate: Date.now() - (agentData.runIntervalMinutes * 60 * 1000 * 8), // Last 24 hours
        ...agentData.filter
      }

      logger.info('Starting indicator sync with filter:', filter);

      // Fetch indicators from Truss API
      const indicators = await this.trussApi.searchIndicators(filter);
      logger.info(`Retrieved ${indicators.length} indicators from Truss API`);

      if (indicators.length === 0) {
        logger.info('No new indicators to process');
        return;
      }

      return;
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