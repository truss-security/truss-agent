# Security Indicator Service

A service for collecting cybersecurity indicators from external APIs and distributing them to local security tools.

## Features

- Scheduled collection of security indicators
- Configurable data mappings
- Support for multiple output destinations (Splunk, etc.)
- Notification system (Discord, email)
- Docker support

## Prerequisites

- Node.js (v20 or later)
- npm

## Installation

1. Clone the repository:

```bash
git clone [repository-url]
cd security-indicator-service
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the root directory:

```env
NODE_ENV=development
LOG_LEVEL=info
TRUSS_API_KEY=your-api-key
JOBS_FILE=config/jobs.json
```

## Development

Start the service in development mode:

```bash
npm run dev
```

Other available commands:
- `npm run build` - Build the TypeScript code
- `npm run start` - Run the built code
- `npm run test` - Run tests
- `npm run lint` - Run linter
- `npm run format` - Format code

## Workflow

1. **Configure** – Run the interactive config to set up the agent, connections, and jobs (see below).
2. **Run the service** – Start the configured agent with `docker compose up -d` (or `npm run cli serve`). The service runs your configured cron/interval jobs and keeps connections up to date by pulling from the Truss API and posting to the configured destinations (e.g. Discord, Slack, MS Teams, SIEM, EDR, FW, etc.).

## Configure (run first)

Run the interactive config:

```bash
npm run config
```

Use the menu to complete initial setup (see walkthroughs below). When you’re done, build and run the Docker container so the service runs your scheduled jobs.

---

### Walkthrough: Initial setup

Follow these steps in order when configuring the agent for the first time.

1. **First-Time Setup**  
   Choose **First-Time Setup (agent name, Truss API key)**. Enter your agent name and Truss API key. The name is saved to `config/agent.json`; the API key is written to `.env` as `TRUSS_API_KEY`. You can use **Test Truss API → Destination** in the same session without restarting.

2. **Create New Connection**  
   Choose **Create New Connection**. Select a destination type (e.g. Discord). Enter the connection name, destination URL (for Discord: webhook URL), and optional channel/label for display. When prompted, add a Truss query and pull frequency: either use a Truss API config name or define a filter (paste a query or enter category, source, industry, etc.). Set pull frequency as an interval (e.g. `10m`, `1h`, `7d`) or a cron expression. A job is created and linked to this connection; the connection's query is saved in `config/connections.json`.

3. **Test Destination Connection**  
   Choose **Test Destination Connection**. Select a connection (or **None (skip test)** to skip). This only tests the destination (e.g. Discord webhook); no API pull. Use it to confirm the destination is reachable.

4. **Test Truss API → Destination**  
   Choose **Test Truss API → Destination**. Select a connection (or **None (skip test)** to skip). This runs the full flow: pull from the Truss API using the connection's query, then send the result to the destination (e.g. Discord). You can choose output format (IOC, Metadata, or Report), preview the payload, and confirm before sending. Works for any connection regardless of enabled/disabled state.

5. **Enable Connections**  
   Choose **Enable/Disable Connection**. You'll see a list of all connections with a checkbox (switch) for each: checked = enabled, unchecked = disabled. Toggle with Space, then press Enter and confirm to save. **Enabled** = the job will pull from the Truss API and send to that connection. **Disabled** = the connection is only configured; the job will not run (no pull, no send).

You can also use **List All Connections** anytime to see connections and their enabled/disabled state.

---

### Walkthrough: Managing connections

Use these menu options to change or remove existing setup.

- **Modify Existing Connection**  
  Choose **Modify Existing Connection**, then select the connection. You can change the name, destination URL (e.g. webhook URL), channel/label, and enabled state. The connection's saved query (filters, window) is preserved.

- **Delete Connection**  
  Choose **Delete Connection**, then select the connection. If any job uses it, you'll be warned. Confirm to remove the connection; you'll need to update or remove those jobs in `config/jobs.json` if they still reference it.

- **Reset All Configuration**  
  Choose **Reset All Configuration**. You'll be asked to confirm, then type `reset` to finalize. This clears the agent name, all `.env` values, all connections, and all jobs (factory reset). Use only when you want to start over.

---

## Docker

### Docker Compose (recommended)

After configuring the agent with `npm run config` (so `config/` and `.env` exist), start the configured agent with:

```bash
docker compose up -d
```

This builds the image, mounts your `config/` and loads `.env`, and runs the scheduled job service. To rebuild after code changes:

```bash
docker compose up -d --build
```

### Plain Docker

Build the image:

```bash
docker build -t security-indicator-service .
```

Run the container (ensure `config/` and `.env` are present, e.g. from a previous `npm run config` or by mounting/copying them):

```bash
docker run -d -v $(pwd)/config:/app/config --env-file .env security-indicator-service
```

The container runs the scheduled job service: it loads jobs from `config/jobs.json`, runs each job on its schedule (cron or interval), pulls from the Truss API for enabled connections, and posts results to the configured destinations (e.g. Discord).

## Configuration

- **Environment**: `TRUSS_API_KEY` (required; set via First-Time Setup or `.env`), `TRUSS_API_URL`, `LOG_LEVEL`, `JOBS_FILE`, `JOBS_JSON`, `CONNECTIONS_FILE`, `AGENT_CONFIG_FILE`. See `src/config/config.ts` for all options.
- **Agent**: `config/agent.json` (default) stores the agent name. Use **First-Time Setup** in `npm run config` to set name and API key.
- **Connections**: Stored in `config/connections.json` (default). Use `npm run config` to create, modify, and test (see walkthroughs above). For destinations like Discord, the webhook URL specifies the channel.
- **Jobs**: Define pull jobs in `config/jobs.json` (or `JOBS_JSON`). Each job has a schedule, output format (`ioc` or `report`), and either `connectionName` (reference a connection) or `discordWebhookUrl`. Copy `config/jobs.example.json` and optionally `config/connections.example.json`.

## CLI Commands

### Run all jobs once (sync)

```bash
npm run cli sync
```

Run a single job by name:

```bash
npm run cli sync --job "discord-ioc"
```

### Start the service (scheduled jobs)

```bash
npm run cli serve
```

The manager loads jobs from `JOBS_FILE` or `JOBS_JSON`, then runs each job on its configured schedule and posts results to the job’s destination (e.g. Discord webhook).