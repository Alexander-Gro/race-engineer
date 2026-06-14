import Database from 'better-sqlite3';
import { migrate } from './migrations';

/** The concrete driver handle. Repos take this so they can share one connection. */
export type Db = Database.Database;

export interface OpenOptions {
  /** Open read-only (e.g. for analysis tooling); writes will throw. */
  readonly?: boolean;
}

/**
 * Open (or create) the local SQLite store and run migrations. Defaults to an in-memory DB,
 * which the tests use — same driver as production, no file I/O. Pass a file path for the
 * real app's user-data store.
 *
 * Local-first, no central server (CLAUDE.md rule 6): this is a plain on-disk file the user
 * owns; nothing is sent anywhere.
 */
export const openDatabase = (filename = ':memory:', opts: OpenOptions = {}): Db => {
  const db = new Database(filename, { readonly: opts.readonly ?? false });
  // WAL improves concurrent read/write on file DBs; a no-op (stays 'memory') for :memory:.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  if (!opts.readonly) migrate(db);
  return db;
};
