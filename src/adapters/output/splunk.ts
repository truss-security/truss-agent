//let splunkjs = require('splunk-sdk');
import splunkjs from 'splunk-sdk'
import { logger } from '../../utils/logger';
import config from '../../config/config';
import { SecurityIndicator } from '../../models/types';

import 'dotenv/config'
//dotenv.config()

interface ServiceParams {
  username: string
  password: string
  scheme: string
  host: string
  port: number
  version: string
}

interface SplunkConfig {
  username: string;
  password: string;
  scheme: string;
  host: string;
  port: number;
  version: string;
}

interface SearchOptions {
  earliest_time?: string;
  latest_time?: string;
  index?: string;
}

// Add proper typing for the Service class
type SplunkService = {
  login(): Promise<void>;
  indexes(): {
    item(name: string): SplunkIndex;
  };
  savedSearches(): {
    create(params: SavedSearchParams): Promise<SavedSearch>;
    fetch(): Promise<SavedSearchCollection>;
  };
  firedAlertGroups(): {
    fetch(): Promise<FiredAlertGroupCollection>;
  };
}

type SplunkIndex = {
  submitEvent(event: Record<string, any>, callback: (err: Error | null) => void): void;
}

type SavedSearchParams = {
  name: string;
  search: string;
  earliest_time?: string;
  latest_time?: string;
  index?: string;
  description?: string;
  alert_type?: string;
  'alert.severity'?: string;
  'alert.suppress'?: string;
  'alert.track'?: string;
  'dispatch.earliest_time'?: string;
  'dispatch.latest_time'?: string;
  is_scheduled?: string;
  cron_schedule?: string;
}

type SavedSearch = {
  name: string;
  properties(): { search: string };
  dispatch(): Promise<[SearchJob, SavedSearch]>;
  remove(): Promise<void>;
}

type SearchJob = {
  sid: string;
  properties(): {
    eventCount: number;
    resultCount: number;
    diskUsage: number;
    priority: number;
  };
  results(options: { count: number }): Promise<[any[], SearchJob]>;
  track(
    options: { period: number },
    callbacks: {
      done: (job: SearchJob) => void;
      failed: (job: SearchJob) => void;
      error: (err: Error) => void;
    }
  ): Promise<void>;
}

type SavedSearchCollection = {
  list(): SavedSearch[];
  item(name: string): SavedSearch | null;
}

type FiredAlertGroupCollection = {
  list(): FiredAlertGroup[];
}

type FiredAlertGroup = {
  name: string;
  count(): number;
  list(): Promise<[FiredAlert[], FiredAlertGroup]>;
}

type FiredAlert = {
  properties(): Record<string, any>;
}

export class SplunkAgent {
  private service!: SplunkService;
  private config: SplunkConfig;

  constructor() {
    this.config = {
      username: config.get('outputs.splunk.username'),
      password: config.get('outputs.splunk.password'),
      scheme: config.get('outputs.splunk.scheme'),
      host: config.get('outputs.splunk.host'),
      port: config.get('outputs.splunk.port'),
      version: config.get('outputs.splunk.version')
    };
  }

  async initialize(): Promise<void> {
    try {
      this.service = new splunkjs.Service(this.config);
      await this.service.login();
      logger.info('Successfully connected to Splunk');
    } catch (error) {
      logger.error('Failed to connect to Splunk:', error);
      throw error;
    }
  }

  async pushIndicators(indicators: SecurityIndicator[]): Promise<void> {
    try {
      const index = this.service.indexes().item(config.get('outputs.splunk.index'));

      for (const indicator of indicators) {
        const event = this.formatIndicatorEvent(indicator);
        await this.submitEvent(index, event);
      }

      logger.info(`Successfully pushed ${indicators.length} indicators to Splunk`);
    } catch (error) {
      logger.error('Failed to push indicators to Splunk:', error);
      throw error;
    }
  }

  private formatIndicatorEvent(indicator: SecurityIndicator): Record<string, any> {
    return {
      sourcetype: 'security_indicator',
      time: new Date(indicator.timestamp).getTime() / 1000,
      event: {
        ...indicator,
        _meta: {
          source: 'security_indicator_service',
          version: '1.0'
        }
      }
    };
  }

  private async submitEvent(index: any, event: Record<string, any>): Promise<void> {
    return new Promise((resolve, reject) => {
      index.submitEvent(event, (err: Error) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async createSavedSearch(
    name: string, 
    indicators: Record<string, string[]>,
    options: SearchOptions = {}
  ): Promise<{ name: string }> {
    try {
      const searchName = `${name}_${Date.now()}`.substring(0, 100); // Splunk name length limit
      const searchQuery = this.buildSearchQuery(indicators, options);

      const savedSearches = this.service.savedSearches();
      const search = await savedSearches.create({
        name: searchName,
        search: searchQuery,
        earliest_time: options.earliest_time || '-1h',
        latest_time: options.latest_time || 'now',
        index: options.index || config.get('outputs.splunk.index')
      });

      logger.info(`Created saved search: ${searchName}`);
      return { name: search.name };
    } catch (error) {
      logger.error('Failed to create saved search:', error);
      throw error;
    }
  }

  private buildSearchQuery(indicators: Record<string, string[]>, options: SearchOptions): string {
    let query = `index="${options.index || config.get('outputs.splunk.index')}"`;
    
    Object.entries(indicators).forEach(([field, values]) => {
      const valueList = values.map(v => `"${v}"`).join(',');
      query += ` | search ${field.toLowerCase()} IN (${valueList})`;
    });

    return query;
  }
}
