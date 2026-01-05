/**
 * Pino logger configuration.
 *
 * @packageDocumentation
 */

import pino from 'pino';
import { env } from './env.js';

const devTransport = {
  target: 'pino-pretty',
  options: {
    colorize: true,
  },
};

/**
 * Application logger instance.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: {
    paths: ['req.headers.authorization', 'password', 'token', 'secret'],
    censor: '[REDACTED]',
  },
  ...(env.NODE_ENV === 'development' && {
    transport: devTransport,
  }),
});
