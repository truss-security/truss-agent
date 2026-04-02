import * as fs from 'fs';
import * as path from 'path';
import config from '../config/config';
import { logger } from './logger';

function resolveConfigPath(relativeOrAbsolute: string): string {
  return path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.resolve(process.cwd(), relativeOrAbsolute);
}

/**
 * Log where the agent will read jobs and connections from, and warn about
 * common Docker misconfiguration (host-only absolute paths, missing mount).
 */
export function logResolvedConfigPaths(): void {
  const connectionsSetting = config.get('connections.connectionsFile') as string;
  const jobsSetting = config.get('jobs.jobsFile') as string;
  const connectionsPath = resolveConfigPath(connectionsSetting);
  const jobsPath = resolveConfigPath(jobsSetting);
  const cwd = process.cwd();

  logger.info(
    { cwd, connectionsFile: connectionsPath, jobsFile: jobsPath },
    'Resolved config file paths'
  );

  const inDocker = fs.existsSync('/.dockerenv');
  if (inDocker && path.isAbsolute(connectionsSetting)) {
    const normalizedCwd = path.resolve(cwd);
    if (!connectionsPath.startsWith(normalizedCwd)) {
      logger.warn(
        {
          CONNECTIONS_FILE: connectionsSetting,
          cwd: normalizedCwd,
        },
        'CONNECTIONS_FILE points outside the container working directory; the file is usually missing here. Use a relative path such as config/connections.json and bind-mount the host config directory to /app/config (see README Docker section).'
      );
    }
  }
  if (inDocker && path.isAbsolute(jobsSetting)) {
    const normalizedCwd = path.resolve(cwd);
    if (!jobsPath.startsWith(normalizedCwd)) {
      logger.warn(
        { JOBS_FILE: jobsSetting, cwd: normalizedCwd },
        'JOBS_FILE points outside the container cwd; use a relative path such as config/jobs.json with a matching volume mount.'
      );
    }
  }

  if (!fs.existsSync(connectionsPath)) {
    logger.warn(
      { path: connectionsPath },
      'Connections file not found at resolved path (agent will use an empty connection list). Check volume mounts and run `docker compose` from the project directory that contains your config/ folder.'
    );
  }
  if (!fs.existsSync(jobsPath) && !(config.get('jobs.jobsJson') as string)?.trim()) {
    logger.warn({ path: jobsPath }, 'Jobs file not found at resolved path');
  }
}
