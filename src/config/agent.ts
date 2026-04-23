import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_AGENT_FILE = 'config/agent.json';

export interface AgentConfig {
  agentName: string;
}

function resolveAgentPath(): string {
  const base = process.cwd();
  return path.resolve(base, DEFAULT_AGENT_FILE);
}

export function loadAgentConfig(agentFilePath?: string): AgentConfig | null {
  const resolved = agentFilePath
    ? path.isAbsolute(agentFilePath)
      ? agentFilePath
      : path.resolve(process.cwd(), agentFilePath)
    : resolveAgentPath();
  if (!fs.existsSync(resolved)) return null;
  const raw = fs.readFileSync(resolved, 'utf-8');
  const data = JSON.parse(raw) as unknown;
  if (data && typeof data === 'object' && 'agentName' in data && typeof (data as AgentConfig).agentName === 'string') {
    return data as AgentConfig;
  }
  return null;
}

export function saveAgentConfig(config: AgentConfig, agentFilePath?: string): void {
  const resolved = agentFilePath
    ? path.isAbsolute(agentFilePath)
      ? agentFilePath
      : path.resolve(process.cwd(), agentFilePath)
    : resolveAgentPath();
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(resolved, JSON.stringify(config, null, 2), 'utf-8');
}

export function updateEnvFile(key: string, value: string, envPath?: string): void {
  const resolved = envPath ?? path.resolve(process.cwd(), '.env');
  let lines: string[] = [];
  let found = false;
  const prefix = `${key}=`;
  if (fs.existsSync(resolved)) {
    const content = fs.readFileSync(resolved, 'utf-8');
    lines = content.split(/\r?\n/);
    lines = lines.map((line) => {
      if (line.startsWith(prefix) || line.startsWith(`${key} `)) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    });
  }
  if (!found) {
    lines.push(`${key}=${value}`);
  }
  fs.writeFileSync(resolved, lines.join('\n'), 'utf-8');
}

/** Remove a key from .env (removes the line). */
export function removeFromEnvFile(key: string, envPath?: string): void {
  const resolved = envPath ?? path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(resolved)) return;
  const content = fs.readFileSync(resolved, 'utf-8');
  const lines = content.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith(`${key}=`) && !trimmed.startsWith(`${key} `);
  });
  fs.writeFileSync(resolved, lines.join('\n'), 'utf-8');
}

/** Clear the entire .env file (remove all values). Used for full config reset. */
export function clearEnvFile(envPath?: string): void {
  const resolved = envPath ?? path.resolve(process.cwd(), '.env');
  if (fs.existsSync(resolved)) {
    fs.writeFileSync(resolved, '', 'utf-8');
  }
}

/** Delete the agent config file (for full reset). */
export function deleteAgentConfigFile(agentFilePath?: string): void {
  const resolved = agentFilePath
    ? path.isAbsolute(agentFilePath)
      ? agentFilePath
      : path.resolve(process.cwd(), agentFilePath)
    : resolveAgentPath();
  if (fs.existsSync(resolved)) {
    fs.unlinkSync(resolved);
  }
}
