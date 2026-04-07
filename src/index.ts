import * as fs from 'fs';
import * as path from 'path';
import { logger } from './utils/logger';
import { logResolvedConfigPaths } from './utils/config-paths';
import { QueryManager } from './services/query-manager';

let shuttingDown = false;

function readPackageVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function main(): Promise<void> {
  const version = readPackageVersion();
  logger.info(
    {
      operation: 'CONTAINER',
      version,
      node: process.version,
      pid: process.pid,
    },
    'Truss agent container starting (serve mode)'
  );

  try {
    logResolvedConfigPaths();
    const manager = new QueryManager();
    const jobs = manager.load();
    if (jobs.length === 0) {
      logger.warn(
        {
          operation: 'CONTAINER',
        },
        'No jobs configured. Set JOBS_FILE or JOBS_JSON and ensure TRUSS_API_KEY is set.'
      );
    }
    manager.start();

    logger.info(
      {
        operation: 'CONTAINER',
        jobCount: jobs.length,
      },
      'Truss agent scheduler running; waiting for schedules (SIGTERM/SIGINT to stop)'
    );

    const shutdown = (signal: string): void => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      logger.info(
        { operation: 'CONTAINER', signal },
        'Truss agent container shutdown requested; stopping schedulers'
      );
      try {
        manager.stop();
      } catch (err) {
        logger.error({ operation: 'CONTAINER', err }, 'Error while stopping schedulers');
      }
      logger.info({ operation: 'CONTAINER' }, 'Truss agent container stopped cleanly');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error({ operation: 'CONTAINER', err: error }, 'Fatal error in main application');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
