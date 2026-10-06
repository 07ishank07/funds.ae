#!/usr/bin/env node
// Entry point for `npm run serve`. The server itself lives in src/server/.
// Environment variables are documented in backend/.env.example.
//
// You do NOT need this for GitHub Pages: there, api/v1/*.json is the API and
// the website's forms explain that they are not connected.

import { pathToFileURL } from 'node:url';
import { createServer } from './server/index.js';
import { scheduleDaily } from './server/scheduler.js';
import { log } from './lib/logger.js';

export { createServer };

// Compare as file URLs: a plain `file://${argv[1]}` never matches on Windows
// (backslashes, drive letter), which silently stopped the server starting there.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || '0.0.0.0';
  const server = createServer();
  server.listen(port, host, () => log.info('api.listening', {
    url: `http://localhost:${port}/`,
    mode: server.app.mode,
    submissions: server.app.submissionsEnabled,
    admin: Boolean(server.app.adminToken)
  }));
  if (process.env.ENABLE_SCHEDULER === 'true') scheduleDaily(Number(process.env.INGEST_HOUR_UTC ?? 3));
  const shutdown = () => {
    log.info('api.shutdown');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
