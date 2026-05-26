import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionsStore } from '../../src/storage/sessions.js';

describe('SessionsStore', () => {
  let dir: string;
  let store: SessionsStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'scry-sessions-'));
    store = new SessionsStore(join(dir, 'scry.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the schema on first open and produces a db file', () => {
    expect(existsSync(join(dir, 'scry.db'))).toBe(true);
  });

  it('insert + get round-trips a row', () => {
    const now = Date.now();
    store.insert({
      id: 'sess-1',
      cwd: '/tmp/scry',
      title: 'first query',
      turns: [{ query: 'first query', finalAnswer: 'answer', cards: [] }],
      createdAt: now,
      updatedAt: now,
    });
    const got = store.get('sess-1');
    expect(got).not.toBeNull();
    expect(got!.id).toBe('sess-1');
    expect(got!.title).toBe('first query');
    expect(got!.turns).toHaveLength(1);
    expect(got!.turns[0].finalAnswer).toBe('answer');
  });

  it('returns null on missing id', () => {
    expect(store.get('nope')).toBeNull();
  });

  it('list orders by updatedAt DESC', () => {
    store.insert({ id: 'a', cwd: '/x', title: 'A', turns: [], createdAt: 100, updatedAt: 100 });
    store.insert({ id: 'b', cwd: '/x', title: 'B', turns: [], createdAt: 200, updatedAt: 200 });
    store.insert({ id: 'c', cwd: '/x', title: 'C', turns: [], createdAt: 150, updatedAt: 150 });
    const rows = store.list();
    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('list pagination via { limit, before }', () => {
    for (let i = 0; i < 5; i++) {
      store.insert({ id: `s${i}`, cwd: '/x', title: `T${i}`, turns: [], createdAt: i * 100, updatedAt: i * 100 });
    }
    const first = store.list({ limit: 2 });
    expect(first.map((r) => r.id)).toEqual(['s4', 's3']);
    const second = store.list({ limit: 2, before: first[first.length - 1].updatedAt });
    expect(second.map((r) => r.id)).toEqual(['s2', 's1']);
  });

  it('list pagination tie-breaks on (updated_at, id) for same-millisecond rows', () => {
    // All four rows share updated_at = 100. The composite cursor should walk them in id-DESC order.
    store.insert({ id: 'a', cwd: '/x', title: 'A', turns: [], createdAt: 100, updatedAt: 100 });
    store.insert({ id: 'b', cwd: '/x', title: 'B', turns: [], createdAt: 100, updatedAt: 100 });
    store.insert({ id: 'c', cwd: '/x', title: 'C', turns: [], createdAt: 100, updatedAt: 100 });
    store.insert({ id: 'd', cwd: '/x', title: 'D', turns: [], createdAt: 100, updatedAt: 100 });
    const first = store.list({ limit: 2 });
    expect(first.map((r) => r.id)).toEqual(['d', 'c']);
    const last = first[first.length - 1];
    const second = store.list({ limit: 2, before: last.updatedAt, beforeId: last.id });
    expect(second.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('update patches title and bumps updatedAt', () => {
    const now = Date.now();
    store.insert({ id: 's', cwd: '/x', title: 'old', turns: [], createdAt: now, updatedAt: now });
    store.update('s', { title: 'new', updatedAt: now + 1000 });
    const got = store.get('s')!;
    expect(got.title).toBe('new');
    expect(got.updatedAt).toBe(now + 1000);
  });

  it('update patches turns when provided', () => {
    const now = Date.now();
    store.insert({ id: 's', cwd: '/x', title: 'q', turns: [], createdAt: now, updatedAt: now });
    store.update('s', { turns: [{ query: 'q', finalAnswer: 'A', cards: [] }], updatedAt: now + 1 });
    const got = store.get('s')!;
    expect(got.turns).toHaveLength(1);
    expect(got.turns[0].finalAnswer).toBe('A');
  });

  it('delete removes the row', () => {
    store.insert({ id: 'sd', cwd: '/x', title: 't', turns: [], createdAt: 1, updatedAt: 1 });
    store.delete('sd');
    expect(store.get('sd')).toBeNull();
  });

  it('opens in WAL mode (.db-wal file appears after a write)', () => {
    store.insert({ id: 'wal', cwd: '/x', title: 't', turns: [], createdAt: 1, updatedAt: 1 });
    // better-sqlite3 creates the WAL file on first write
    expect(existsSync(join(dir, 'scry.db-wal'))).toBe(true);
  });
});
