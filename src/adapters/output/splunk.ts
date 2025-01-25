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

export class SplunkAgent {
  serviceParams: ServiceParams
  service: any
  private config: SplunkConfig

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

  async deleteSavedSearch(name: string): Promise<void> {
    try {
      const savedSearches = await this.service.savedSearches().fetch();
      const search = savedSearches.item(name);

      if (!search) {
        logger.warn(`Saved search '${name}' not found`);
        return;
      }

      await search.remove();
      logger.info(`Deleted saved search: ${name}`);
    } catch (error) {
      logger.error('Failed to delete saved search:', error);
      throw error;
    }
  }

  async listSavedSearches(): Promise<Array<{ name: string; query: string }>> {
    try {
      const savedSearches = await this.service.savedSearches().fetch();
      return savedSearches.list().map(search => ({
        name: search.name,
        query: search.properties().search
      }));
    } catch (error) {
      logger.error('Failed to list saved searches:', error);
      throw error;
    }
  }

  async listAlerts() {
    try {
      // Get the collection of all fired alert groups for the current user
      let firedAlertGroups = await this.service.firedAlertGroups().fetch();
              
      // Get the list of all fired alert groups, including the all group (represented by "-")
      firedAlertGroups = firedAlertGroups.list();
      console.log("Fired alert groups:", firedAlertGroups);
              
      // For each fired alert group...
      for(let a in firedAlertGroups) {
        if (firedAlertGroups.hasOwnProperty(a)) {
          let firedAlertGroup = firedAlertGroups[a];
          let firedAlerts;
          [firedAlerts, firedAlertGroup] = await firedAlertGroup.list();
          // How many times were this group's alerts fired?
          console.log(firedAlertGroup.name, "(Count:", firedAlertGroup.count(), ")");
          // Print the properties for each fired alert (default of 30 per alert group)
          for(let i = 0; i < firedAlerts.length; i++) {
              let firedAlert = firedAlerts[i];
              for(let key in firedAlert.properties()) {
                  if (firedAlert.properties().hasOwnProperty(key)) {
                      console.log("\t", key, ":", firedAlert.properties()[key]);
                  }
              }
              console.log();
          }
          console.log("======================================");
        }
      }

      return "return"
    } catch (err) {
      console.log("Error:", err);
    }
  }

  async createAlert(productName: string, id: string, indicators: {}, alertOptions?: {}) { 
    try {
      const timestamp = Date.now()
      const alertName = productName.replace(/ /g, "_") + '-' + timestamp

      const defaultAlertOptions = {
        "alert_type": "always",
        "alert.severity": "4",
        "alert.suppress": "0",
        "alert.track": "1",
        "dispatch.earliest_time": "-1h",
        "dispatch.latest_time": "now",
        "is_scheduled": "1",
        "cron_schedule": "* * * * *"
      };
      alertOptions = alertOptions ? alertOptions : defaultAlertOptions

      // Create the search query from the indicators
      let searchQuery = `index="_internal"`
      for (const indicator in indicators) {
        let indicatorRange = ''
        indicators[indicator].forEach((item: string) => {
          indicatorRange += `"${item}",`
        })
        indicatorRange = indicatorRange.slice(0, -1); 
        searchQuery += ` | search ${indicator.toLowerCase()} IN (${indicatorRange})`  
      }

      // Create a saved search as an alert.
      let alert = await this.service.savedSearches().create({
        name: alertName.substring(0,100), // Splunk only allows names < 100 char
        search: searchQuery,
        description: id,
        ...alertOptions
      });

      return {name: alert.name}
    
    } catch (err) {
      throw err
    }
  }

  async deleteAlert(alertName: string) {
    try {
      const name = alertName;
      // Retrieve the alert group.
      let firedAlertGroups = await this.service.savedSearches().fetch();
      // Get the alert group to delete using its name.
      let alertToDelete = firedAlertGroups.item(name);

      // Does the alert exist?
      if (!alertToDelete) {
          console.log("Can't delete '" + name + "' because it doesn't exist!");
      }
      else {
          // Delete the alert.
          await alertToDelete.remove();
          console.log("Deleted alert: " + name + "");
      }
    } catch (err) {
      console.log("Error:", err);
    }
  }
  
  async getSavedSearches() {
    try {
      let mySavedSearches = this.service.savedSearches();
      mySavedSearches = await mySavedSearches.fetch();
  
      console.log("There are " + mySavedSearches.list().length + " saved searches");
  
      let savedSearchColl = mySavedSearches.list();
  
      for(let i = 0; i < savedSearchColl.length; i++) {
          let search = savedSearchColl[i];
          console.log(i + ": " + search.name);
          console.log("    Query: " + search.properties().search + "\n");
      }
    } catch (err) {
      console.log("Error:", err);
    }
  }

  // Run a saved search
  async runSearch(searchName: string) {
    // Retrieve the saved search collection
    let mySavedSearches = this.service.savedSearches();
    mySavedSearches = await mySavedSearches.fetch();

    // Retrieve the saved search 
    let mySavedSearch = mySavedSearches.item(searchName);

    // Run the saved search and poll for completion
    let [job, savedSearch] = await mySavedSearch.dispatch();

    // Display the job's search ID
    console.log("Job SID: ", job.sid);

    // Poll the status of the search job
    await job.track({
            period: 200
        }, {
            done: async function(job) {
                console.log("Done!");

                // Print out the statics
                console.log("Job statistics:");
                console.log("  Event count:  " + job.properties().eventCount);
                console.log("  Result count: " + job.properties().resultCount);
                console.log("  Disk usage:   " + job.properties().diskUsage + " bytes");
                console.log("  Priority:     " + job.properties().priority);

                // Get 10 results and print them
                let results;
                [results, job] = await job.results({
                    count: 10
                });
                console.log(JSON.stringify(results));
            },
            failed: function(job) {
                console.log(`Job failed: ${job.sid}`)
            },
            error: function(err) {
                console.log(err);
            }
        }
    );

    return job

  }
}
