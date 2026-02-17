import { logger } from './utils/logger';
import { QueryManager } from './services/query-manager';

export async function main(): Promise<void> {
  try {
    logger.info('Starting Truss agent (query manager)...');
    const manager = new QueryManager();
    const jobs = manager.load();
    if (jobs.length === 0) {
      logger.warn('No jobs configured. Set JOBS_FILE or JOBS_JSON and ensure TRUSS_API_KEY is set.');
    }
    manager.start();
  } catch (error) {
    logger.error({ err: error }, 'Fatal error in main application');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
