// Optional in-process daily ingestion (ENABLE_SCHEDULER=true). Runs
// `node src/cli.js all` as a child process so a crash in ingestion can never
// take the API down. On failure it retries up to 3 times, 15 minutes apart.

import { spawn } from 'node:child_process';
import { BACKEND_DIR } from '../config.js';
import { log } from '../lib/logger.js';

function runIngestion(attempt = 1) {
  log.info('scheduler.run', { attempt });
  const child = spawn(process.execPath, ['src/cli.js', 'all'], { cwd: BACKEND_DIR, stdio: 'inherit' });
  child.on('exit', (code) => {
    if (code === 0) return log.info('scheduler.done');
    log.warn('scheduler.failed', { code, attempt });
    if (attempt < 3) setTimeout(() => runIngestion(attempt + 1), 15 * 60_000).unref();
  });
}

export function scheduleDaily(hourUtc = 3) {
  const next = new Date();
  next.setUTCHours(hourUtc, 0, 0, 0);
  if (next <= new Date()) next.setUTCDate(next.getUTCDate() + 1);
  log.info('scheduler.next', { at: next.toISOString() });
  setTimeout(() => { runIngestion(); scheduleDaily(hourUtc); }, next - Date.now()).unref();
}
