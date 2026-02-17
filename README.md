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

## Docker

Build the Docker image:

```bash
docker build -t security-indicator-service .
```

Run the Docker container:

```bash
docker run -d security-indicator-service
```

## Configure before running

Run the interactive config (e.g. before first use or before Docker):

```bash
npm run config
```

or `npm run cli config`.

**First-time setup** (menu: "First-time setup"): Set the **agent name** and **Truss API key**. The name is saved to `config/agent.json`; the API key is written to `.env` as `TRUSS_API_KEY`. Restart the agent (or run config again) after saving so the key is loaded.

The menu also lets you **create** a new connection (Discord webhook + Truss query and pull frequency), **modify** or **test** a connection, **list all connections**, **delete** a connection, and **reset all configuration** (agent name, Truss API key, all connections, all jobs – with a confirmation step). When creating a connection you can define what to pull: use a Truss API config name, or define a filter. You can **paste the full Truss API query** (raw JSON or code snippet, e.g. `requests.post(..., json={...})`) and the tool will extract the filter (industry, category, dates, etc.) and the date range for the query window. Or enter the same options as the Truss Dashboard manually: Category, Sources, Authors, Region, Industry, References, Tags, Indicator types, and time window. Pull frequency is either a cron expression or an interval in minutes (e.g. `60`). For **interval** schedules, the query window is set to the run interval (e.g. 10 min schedule → pull last 10 minutes) so each run only fetches new items and avoids duplicates. For cron, you can set a query window in minutes. The API is called with `startDate` and `endDate` (ISO) and your filter fields (e.g. `industry`, `category`) as in the Truss product/search example.

## Configuration

- **Environment**: `TRUSS_API_KEY` (required; set via first-time setup or `.env`), `TRUSS_API_URL`, `LOG_LEVEL`, `JOBS_FILE`, `JOBS_JSON`, `CONNECTIONS_FILE`, `AGENT_CONFIG_FILE`. See `src/config/config.ts` for all options.
- **Agent**: `config/agent.json` (default) stores the agent name. Use first-time setup in `npm run config` to set name and API key.
- **Connections**: Stored in `config/connections.json` (default). Use `npm run config` to create, modify, and test. For communication apps (Discord), the webhook URL specifies the channel.
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

The manager loads jobs from `JOBS_FILE` or `JOBS_JSON`, then runs each job on its configured schedule and posts results to the job’s Discord webhook.