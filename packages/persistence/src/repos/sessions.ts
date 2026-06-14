import type { Db } from '../db';
import type { NewSession, SessionRecord } from '../types';

/** Raw `sessions` row as better-sqlite3 returns it (snake_case columns). */
interface SessionRow {
  id: number;
  game: string;
  track: string | null;
  car: string | null;
  car_class: string | null;
  type: string | null;
  server: string | null;
  started_at: number;
  ended_at: number | null;
}

const toRecord = (row: SessionRow): SessionRecord => ({
  id: row.id,
  game: row.game,
  track: row.track,
  car: row.car,
  carClass: row.car_class,
  type: row.type,
  server: row.server,
  startedAt: row.started_at,
  endedAt: row.ended_at,
});

/** CRUD for the `sessions` table. Synchronous (better-sqlite3) — safe off the hot loop. */
export class SessionRepo {
  constructor(private readonly db: Db) {}

  /** Insert a session, returning the DB-assigned id. */
  insert(session: NewSession): number {
    const info = this.db
      .prepare(
        `INSERT INTO sessions (game, track, car, car_class, type, server, started_at, ended_at)
         VALUES (@game, @track, @car, @carClass, @type, @server, @startedAt, @endedAt)`,
      )
      .run({
        game: session.game,
        track: session.track ?? null,
        car: session.car ?? null,
        carClass: session.carClass ?? null,
        type: session.type ?? null,
        server: session.server ?? null,
        startedAt: session.startedAt,
        endedAt: session.endedAt ?? null,
      });
    return Number(info.lastInsertRowid);
  }

  /** Fetch one session by id, or null if it doesn't exist. */
  get(id: number): SessionRecord | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      | SessionRow
      | undefined;
    return row ? toRecord(row) : null;
  }

  /** Mark a session finished (sets `ended_at`). */
  finish(id: number, endedAt: number): void {
    this.db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(endedAt, id);
  }

  /** All sessions, most recent first. */
  list(): SessionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions ORDER BY started_at DESC, id DESC')
      .all() as SessionRow[];
    return rows.map(toRecord);
  }
}
