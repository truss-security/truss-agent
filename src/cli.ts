import { Command } from 'commander';
import { logger } from './utils/logger';
import IndicatorSyncService from './services/indicator-sync-service';
import config from './config/config';

const program = new Command();

program
  .name('security-indicator-service')
  .description('CLI to manage security indicator collection and distribution')
  .version('0.1.0');

program
  .command('sync')
  .description('Run a one-time sync of security indicators')
  .option('-f, --force', 'Force sync regardless of last run time')
  .action(async (options) => {
    try {
      logger.info('Starting manual sync...');
      const syncService = new IndicatorSyncService();
      await syncService.initialize();
      await syncService.syncIndicators();
      logger.info('Manual sync completed');
    } catch (error) {
      logger.error('Sync failed:', error);
      process.exit(1);
    }
  });

program
  .command('serve')
  .description('Start the service in daemon mode with scheduled syncs')
  .option('-c, --cron <pattern>', 'Override default cron schedule')
  .action(async (options) => {
    try {
      if (options.cron) {
        config.set('schedule.cron', options.cron);
      }
      // Use the existing main function
      await (await import('./index.js')).main();
    } catch (error) {
      logger.error('Service failed:', error);
      process.exit(1);
    }
  });

// program
//   .command('config')
//   .description('Manage service configuration')
//   .option('-l, --list', 'List current configuration')
//   .option('-t, --test', 'Test current configuration')
//   .action(async (options) => {
//     if (options.list) {
//       const conf = config.getProperties();
//       const maskedConfig = JSON.parse(JSON.stringify(conf));
//       const schema = config.getSchema() as { properties: Record<string, { sensitive?: boolean }> };
      
//       Object.entries(schema.properties).forEach(([key, value]) => {
//         if (value.sensitive) {
//           maskedConfig[key] = '********';
//         }
//       });
//       console.log(JSON.stringify(maskedConfig, null, 2));
//     }
//     if (options.test) {
//       try {
//         const syncService = new IndicatorSyncService();
//         await syncService.initialize();
//         logger.info('Configuration test successful');
//       } catch (error) {
//         logger.error('Configuration test failed:', error);
//         process.exit(1);
//       }
//     }
//   });

program.parse(); 