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
env
NODE_ENV=development
LOG_LEVEL=info
PORT=3000
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

## Configuration

Configuration is managed through environment variables and/or config files. See `src/config/config.ts` for available options.


