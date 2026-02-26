import { Command } from 'commander';
import { logger } from './utils/logger';
import { QueryManager } from './services/query-manager';
import { runConfigCommand } from './cli/config-command';

const program = new Command();

program
  .name('truss-agent')
  .description('CLI to manage security indicator collection and distribution')
  .version('0.1.0');

program
  .command('sync')
  .description('Run all jobs once (or a single job by name)')
  .option('-f, --force', 'Force sync regardless of last run time (reserved)')
  .option('-j, --job <name>', 'Run only the job with this name')
  .action(async (options) => {
    try {
      const manager = new QueryManager();
      manager.load();
      if (options.job) {
        const found = await manager.runJobByName(options.job);
        if (!found) process.exit(1);
      } else {
        await manager.runAllOnce();
      }
      logger.info('Sync completed');
    } catch (error) {
      logger.error({ err: error }, 'Sync failed');
      process.exit(1);
    }
  });

program
  .command('serve')
  .description('Start the service in daemon mode with scheduled jobs')
  .option('-c, --cron <pattern>', 'Override default cron schedule (reserved)')
  .action(async () => {
    try {
      const { main } = await import('./index');
      await main();
    } catch (error) {
      logger.error({ err: error }, 'Service failed');
      process.exit(1);
    }
  });

program
  .command('config')
  .description('Interactive configuration: create, modify, and test connections')
  .action(async () => {
    try {
      await runConfigCommand();
    } catch (error) {
      logger.error({ err: error }, 'Config failed');
      process.exit(1);
    }
  });

program.parse();
