import { logger } from './utils/logger';
import IndicatorSyncService from './services/indicator-sync-service';
import config from './config/config';
import cron from 'node-cron';

async function runSync() {
  const syncService = new IndicatorSyncService();
  
  try {
    await syncService.initialize();
    await syncService.syncIndicators();
  } catch (error) {
    logger.error('Sync failed:', error);
  }
}

async function main() {
  try {
    logger.info('Starting security indicator service...');

    // Run initial sync
    await runSync();

    // Schedule regular syncs if cron is configured
    const cronSchedule = config.get('schedule.cron');
    if (cronSchedule) {
      logger.info(`Scheduling regular syncs with cron pattern: ${cronSchedule}`);
      cron.schedule(cronSchedule, async () => {
        logger.info('Starting scheduled sync');
        await runSync();
      });
    }

  } catch (error) {
    logger.error('Fatal error in main application:', error);
    process.exit(1);
  }
}

main(); 