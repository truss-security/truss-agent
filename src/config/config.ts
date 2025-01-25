import convict from 'convict';
import dotenv from 'dotenv';

dotenv.config();

const config = convict({
  env: {
    doc: 'The application environment.',
    format: ['production', 'development', 'test'],
    default: 'development',
    env: 'NODE_ENV',
  },
  port: {
    doc: 'The port to bind.',
    format: 'port',
    default: 3000,
    env: 'PORT',
  },
  logLevel: {
    doc: 'The logging level',
    format: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'],
    default: 'info',
    env: 'LOG_LEVEL',
  },
  schedule: {
    cron: {
      doc: 'Cron expression for scheduling indicator collection',
      format: String,
      default: '0 */6 * * *', // Every 6 hours
      env: 'SCHEDULE_CRON',
    },
  },
  indicators: {
    apiUrl: {
      doc: 'URL for the Truss Security API',
      format: String,
      default: 'https://api.truss-security.com',
      env: 'TRUSS_API_URL',
      sensitive: false,
    },
    apiKey: {
      doc: 'API key for the Truss Security API',
      format: String,
      default: '',
      env: 'TRUSS_API_KEY',
      sensitive: true,
    },
  },
  outputs: {
    splunk: {
      enabled: {
        doc: 'Enable Splunk output',
        format: Boolean,
        default: false,
        env: 'SPLUNK_ENABLED',
      },
      username: {
        doc: 'Splunk username',
        format: String,
        default: '',
        env: 'SPLUNK_USERNAME',
        sensitive: true,
      },
      password: {
        doc: 'Splunk password',
        format: String,
        default: '',
        env: 'SPLUNK_PASSWORD',
        sensitive: true,
      },
      scheme: {
        doc: 'Splunk connection scheme',
        format: String,
        default: 'https',
        env: 'SPLUNK_SCHEME',
      },
      host: {
        doc: 'Splunk host',
        format: String,
        default: '',
        env: 'SPLUNK_HOST',
      },
      port: {
        doc: 'Splunk port',
        format: 'port',
        default: 8089,
        env: 'SPLUNK_PORT',
      },
      version: {
        doc: 'Splunk API version',
        format: String,
        default: '8.0',
        env: 'SPLUNK_VERSION',
      },
      index: {
        doc: 'Splunk index',
        format: String,
        default: 'main',
        env: 'SPLUNK_INDEX',
      },
    },
    notifications: {
      discord: {
        enabled: {
          doc: 'Enable Discord notifications',
          format: Boolean,
          default: false,
          env: 'DISCORD_ENABLED',
        },
        webhook: {
          doc: 'Discord webhook URL',
          format: String,
          default: '',
          env: 'DISCORD_WEBHOOK_URL',
          sensitive: true,
        },
      },
      email: {
        enabled: {
          doc: 'Enable email notifications',
          format: Boolean,
          default: false,
          env: 'EMAIL_ENABLED',
        },
        smtp: {
          host: {
            doc: 'SMTP host',
            format: String,
            default: '',
            env: 'SMTP_HOST',
          },
          port: {
            doc: 'SMTP port',
            format: 'port',
            default: 587,
            env: 'SMTP_PORT',
          },
          user: {
            doc: 'SMTP user',
            format: String,
            default: '',
            env: 'SMTP_USER',
          },
          password: {
            doc: 'SMTP password',
            format: String,
            default: '',
            env: 'SMTP_PASSWORD',
            sensitive: true,
          },
        },
        recipients: {
          doc: 'Comma-separated list of email recipients',
          format: String,
          default: '',
          env: 'EMAIL_RECIPIENTS',
        },
      },
    },
  },
});

config.validate({ allowed: 'strict' });

export default config;

// Get a value
const port = config.get('port');
const apiKey = config.get('indicators.apiKey');

// Get the whole config as an object
const fullConfig = config.getProperties(); 