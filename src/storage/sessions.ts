// src/storage/sessions.ts
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { dirname } from 'path';
import { mkdirSync } from 'fs';
import type {
  SessionRow,
  StoredTurn,
  InsertSession,
  UpdateSession,
  ListOpts,
} from './types.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  cwd         TEXT NOT NULL,
  title       TEXT NOT NULL,
  turns_json  TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC, id DESC);
`;

const CURRENT_SCHEMA_VERSION = 1;

interface DbRow {
  id: string;
  cwd: string;
  title: string;
  turns_json: string;
  created_at: number;
  updated_at: number;
}

export class SessionsStore {
  private db: Db;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
    // Set user_version only on a fresh DB (default is 0). Don't unconditionally
    // overwrite — a future migration would compare against this and could
    // silently re-run if we always set it back to the current version here.
    const current = this.db.pragma('user_version', { simple: true }) as number;
    if (current === 0) {
      this.db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
    }
  }

  insert(s: InsertSession): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, cwd, title, turns_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(s.id, s.cwd, s.title, JSON.stringify(s.turns), s.createdAt, s.updatedAt);
  }

  get(id: string): SessionRow | null {
    const row = this.db
      .prepare<[string], DbRow>(`SELECT * FROM sessions WHERE id = ?`)
      .get(id);
    return row ? toSessionRow(row) : null;
  }

  list(opts: ListOpts = {}): SessionRow[] {
    const limit = opts.limit ?? 100;
    if (opts.before !== undefined) {
      // Composite cursor on (updated_at, id) — strict less-than on the pair.
      // SQLite tuple comparison: (a, b) < (c, d) iff a<c OR (a=c AND b<d).
      // Fallback when caller doesn't pass beforeId: behave as before, but only
      // safe when timestamps are unique (test-suite paths).
      if (opts.beforeId !== undefined) {
        const rows = this.db
          .prepare<[number, number, string, number], DbRow>(
            `SELECT * FROM sessions
             WHERE updated_at < ?
                OR (updated_at = ? AND id < ?)
             ORDER BY updated_at DESC, id DESC
             LIMIT ?`,
          )
          .all(opts.before, opts.before, opts.beforeId, limit);
        return rows.map(toSessionRow);
      }
      const rows = this.db
        .prepare<[number, number], DbRow>(
          `SELECT * FROM sessions WHERE updated_at < ? ORDER BY updated_at DESC, id DESC LIMIT ?`,
        )
        .all(opts.before, limit);
      return rows.map(toSessionRow);
    }
    const rows = this.db
      .prepare<[number], DbRow>(
        `SELECT * FROM sessions ORDER BY updated_at DESC, id DESC LIMIT ?`,
      )
      .all(limit);
    return rows.map(toSessionRow);
  }

  update(id: string, patch: UpdateSession): number {
    const sets: string[] = ['updated_at = ?'];
    const values: Array<string | number> = [patch.updatedAt];
    if (patch.title !== undefined) {
      sets.push('title = ?');
      values.push(patch.title);
    }
    if (patch.turns !== undefined) {
      sets.push('turns_json = ?');
      values.push(JSON.stringify(patch.turns));
    }
    values.push(id);
    const info = this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return info.changes;
  }

  delete(id: string): number {
    const info = this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
    return info.changes;
  }

  close(): void {
    this.db.close();
  }
}

function toSessionRow(row: DbRow): SessionRow {
  let turns: StoredTurn[] = [];
  try {
    const parsed = JSON.parse(row.turns_json);
    if (Array.isArray(parsed)) turns = parsed;
  } catch {
    turns = [];
  }
  return {
    id: row.id,
    cwd: row.cwd,
    title: row.title,
    turns,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
