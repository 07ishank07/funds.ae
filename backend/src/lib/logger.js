// Small structured logger. Writes one readable line per event to stdout/stderr.
// Inside GitHub Actions, warnings and errors also become run annotations so
// they appear on the workflow summary page without digging through logs.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;
const inActions = process.env.GITHUB_ACTIONS === 'true';

const collected = { warnings: [], errors: [] };

function formatContext(ctx) {
  if (!ctx) return '';
  return Object.entries(ctx)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      const value = typeof v === 'string' ? v : JSON.stringify(v);
      return `${k}=${/\s/.test(value) ? JSON.stringify(value) : value}`;
    })
    .join(' ');
}

function write(level, event, ctx) {
  if (LEVELS[level] < minLevel) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${event} ${formatContext(ctx)}`.trim();
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');

  if (level === 'warn' || level === 'error') {
    const entry = { at: new Date().toISOString(), event, ...ctx };
    (level === 'warn' ? collected.warnings : collected.errors).push(entry);
    if (inActions) {
      const msg = `${event} ${formatContext(ctx)}`.replace(/\r?\n/g, ' ');
      process.stdout.write(`::${level === 'warn' ? 'warning' : 'error'}::${msg}\n`);
    }
  }
}

export const log = {
  debug: (event, ctx) => write('debug', event, ctx),
  info: (event, ctx) => write('info', event, ctx),
  warn: (event, ctx) => write('warn', event, ctx),
  error: (event, ctx) => write('error', event, ctx),
  collected: () => ({ warnings: [...collected.warnings], errors: [...collected.errors] }),
  reset: () => { collected.warnings.length = 0; collected.errors.length = 0; }
};
