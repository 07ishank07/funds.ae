// JSON-file database. Each "table" is one file in backend/data/.
//
// Why files instead of a database server: this site runs on GitHub Pages and
// GitHub Actions with nothing to install. The files are version-controlled,
// so every change is auditable and can be rolled back, and they comfortably
// hold tens of thousands of records. The same record shapes map one-to-one
// onto the SQL tables in schema/schema.sql for a later move to PostgreSQL.
//
// Writes are atomic (write to a temp file, then rename) so a crash mid-write
// can never leave a half-written database file.

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION = 1;

export class JsonStore {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  file(name) {
    return path.join(this.dir, name);
  }

  load(name, defaults) {
    const file = this.file(name);
    if (!existsSync(file)) return structuredClone(defaults);
    const raw = readFileSync(file, 'utf8');
    try {
      const data = JSON.parse(raw);
      if (data.schemaVersion && data.schemaVersion > SCHEMA_VERSION) {
        throw new Error(`${name} was written by a newer version of this backend (schema ${data.schemaVersion}).`);
      }
      return { ...structuredClone(defaults), ...data };
    } catch (err) {
      throw new Error(`Database file ${name} is corrupt or unreadable: ${err.message}. Restore it from git history.`);
    }
  }

  save(name, data) {
    const file = this.file(name);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...data }, null, 2) + '\n', 'utf8');
    renameSync(tmp, file);
  }
}

/** Writes a public API file atomically. */
export function writeJsonAtomic(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
}
