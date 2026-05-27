// src/storage/types.ts
import type { SourceCard } from '../engine/types.js';

export interface StoredTurn {
  query: string;
  finalAnswer: string;
  cards: SourceCard[];
}

export interface SessionRow {
  id: string;
  cwd: string;
  title: string;
  turns: StoredTurn[];
  createdAt: number;
  updatedAt: number;
}

export interface InsertSession {
  id: string;
  cwd: string;
  title: string;
  turns: StoredTurn[];
  createdAt: number;
  updatedAt: number;
}

export interface UpdateSession {
  title?: string;
  turns?: StoredTurn[];
  updatedAt: number;
}

export interface ListOpts {
  limit?: number;
  before?: number;
  beforeId?: string;  // composite cursor — pass alongside `before` to disambiguate same-millisecond rows
}
