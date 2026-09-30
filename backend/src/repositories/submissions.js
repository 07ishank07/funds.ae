// Append-only store for website form submissions: one JSON-lines file per kind
// (contact.jsonl, newsletter.jsonl, ...). Maps to the "submissions" table in
// schema/schema.sql.
//
// Privacy by design:
//  - the client IP is never stored, only an HMAC of it (enough to spot abuse)
//  - the user agent is truncated
//  - files are created owner-read/write only and the folder is git-ignored
//  - prune() deletes records older than the retention period
//
// Concurrency: writes to each file are serialised through a promise chain, which
// is safe for a single server process. Run one instance (or move to PostgreSQL)
// before scaling out.

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SUBMISSION_KINDS } from '../contracts/models.js';

export class SubmissionCapacityError extends Error {}

const emailKey = (email) => createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex');

export class SubmissionsRepository {
  /**
   * @param {string} dir
   * @param {{ hashSalt?: string, maxPerKind?: number }} options
   */
  constructor(dir, { hashSalt, maxPerKind = Infinity } = {}) {
    this.dir = dir;
    this.maxPerKind = maxPerKind;
    // Without a configured salt a random one is used: hashes are then only
    // comparable within one process lifetime, which is enough for rate abuse.
    this.salt = hashSalt || randomBytes(32).toString('hex');
    this.queues = new Map();
    this.counts = new Map();
    this.newsletterKeys = new Set();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const kind of SUBMISSION_KINDS) {
      const records = this.#readAllSync(kind);
      this.counts.set(kind, records.length);
      if (kind === 'newsletter') for (const r of records) if (r.email) this.newsletterKeys.add(emailKey(r.email));
    }
  }

  file(kind) {
    if (!SUBMISSION_KINDS.includes(kind)) throw new Error(`Unknown submission kind: ${kind}`);
    return path.join(this.dir, `${kind}.jsonl`);
  }

  hashIp(ip) {
    return createHmac('sha256', this.salt).update(String(ip || 'unknown')).digest('hex').slice(0, 32);
  }

  /**
   * Stores a validated submission.
   * @returns {Promise<{ id: string|null, duplicate: boolean }>}
   */
  add({ kind, status, payload, ip, userAgent, now = new Date() }) {
    return this.#enqueue(kind, async () => {
      const email = payload.email || null;
      if (kind === 'newsletter' && email && this.newsletterKeys.has(emailKey(email))) {
        return { id: null, duplicate: true };
      }
      if ((this.counts.get(kind) || 0) >= this.maxPerKind) {
        throw new SubmissionCapacityError(`The ${kind} store is full`);
      }
      const record = {
        id: `sub_${randomBytes(10).toString('hex')}`,
        kind,
        status,
        payload,
        email,
        ipHash: this.hashIp(ip),
        userAgent: String(userAgent || '').slice(0, 200),
        createdAt: now.toISOString()
      };
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      await appendFile(this.file(kind), JSON.stringify(record) + '\n', { encoding: 'utf8', mode: 0o600 });
      this.counts.set(kind, (this.counts.get(kind) || 0) + 1);
      if (kind === 'newsletter' && email) this.newsletterKeys.add(emailKey(email));
      return { id: record.id, duplicate: false };
    });
  }

  /** Newest first. Corrupt lines are skipped, never fatal. */
  async list(kind, { limit = 50 } = {}) {
    const file = this.file(kind);
    if (!existsSync(file)) return [];
    const raw = await readFile(file, 'utf8');
    return parseLines(raw).reverse().slice(0, limit);
  }

  /** Deletes records older than retentionDays. Returns how many were removed. */
  async prune(retentionDays, now = new Date()) {
    const cutoff = now.getTime() - retentionDays * 86_400_000;
    let removed = 0;
    for (const kind of SUBMISSION_KINDS) {
      removed += await this.#enqueue(kind, async () => {
        const file = this.file(kind);
        if (!existsSync(file)) return 0;
        const records = parseLines(await readFile(file, 'utf8'));
        const kept = records.filter((r) => new Date(r.createdAt).getTime() >= cutoff);
        if (kept.length === records.length) return 0;
        const tmp = `${file}.${process.pid}.tmp`;
        await writeFile(tmp, kept.map((r) => JSON.stringify(r) + '\n').join(''), { encoding: 'utf8', mode: 0o600 });
        await rename(tmp, file);
        this.counts.set(kind, kept.length);
        if (kind === 'newsletter') {
          this.newsletterKeys = new Set(kept.filter((r) => r.email).map((r) => emailKey(r.email)));
        }
        return records.length - kept.length;
      });
    }
    return removed;
  }

  #enqueue(kind, task) {
    const previous = this.queues.get(kind) || Promise.resolve();
    const next = previous.then(task, task);
    // Keep the chain alive even if this task fails.
    this.queues.set(kind, next.catch(() => {}));
    return next;
  }

  #readAllSync(kind) {
    const file = this.file(kind);
    return existsSync(file) ? parseLines(readFileSync(file, 'utf8')) : [];
  }
}

function parseLines(raw) {
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip a torn or corrupt line */ }
  }
  return out;
}
