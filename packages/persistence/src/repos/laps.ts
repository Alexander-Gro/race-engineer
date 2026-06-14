import type { Db } from '../db';
import type { LapRecord, NewLap } from '../types';

/** Raw `laps` row as better-sqlite3 returns it. */
interface LapRow {
  id: number;
  session_id: number;
  lap_no: number;
  lap_time_s: number | null;
  sector_times_json: string | null;
  fuel_used_l: number | null;
  fuel_left_l: number | null;
  avg_tire_temp_c: number | null;
  tire_wear01: number | null;
  compound: string | null;
  conditions: string | null;
  valid: number;
}

const parseSectors = (json: string | null): number[] | null => {
  if (json === null) return null;
  const parsed: unknown = JSON.parse(json);
  return Array.isArray(parsed) ? (parsed as number[]) : null;
};

const toRecord = (row: LapRow): LapRecord => ({
  id: row.id,
  sessionId: row.session_id,
  lapNo: row.lap_no,
  lapTimeS: row.lap_time_s,
  sectorTimesS: parseSectors(row.sector_times_json),
  fuelUsedL: row.fuel_used_l,
  fuelLeftL: row.fuel_left_l,
  avgTireTempC: row.avg_tire_temp_c,
  tireWear01: row.tire_wear01,
  compound: row.compound,
  conditions: row.conditions,
  valid: row.valid !== 0,
});

/** CRUD for the `laps` table — the per-lap history strategy/learning is built from. */
export class LapRepo {
  constructor(private readonly db: Db) {}

  /** Insert one lap, returning the DB-assigned id. */
  insert(lap: NewLap): number {
    const info = this.db
      .prepare(
        `INSERT INTO laps
           (session_id, lap_no, lap_time_s, sector_times_json, fuel_used_l, fuel_left_l,
            avg_tire_temp_c, tire_wear01, compound, conditions, valid)
         VALUES
           (@sessionId, @lapNo, @lapTimeS, @sectorTimesJson, @fuelUsedL, @fuelLeftL,
            @avgTireTempC, @tireWear01, @compound, @conditions, @valid)`,
      )
      .run({
        sessionId: lap.sessionId,
        lapNo: lap.lapNo,
        lapTimeS: lap.lapTimeS ?? null,
        sectorTimesJson: lap.sectorTimesS ? JSON.stringify(lap.sectorTimesS) : null,
        fuelUsedL: lap.fuelUsedL ?? null,
        fuelLeftL: lap.fuelLeftL ?? null,
        avgTireTempC: lap.avgTireTempC ?? null,
        tireWear01: lap.tireWear01 ?? null,
        compound: lap.compound ?? null,
        conditions: lap.conditions ?? null,
        // SQLite has no boolean; store 1/0. Default valid = true.
        valid: (lap.valid ?? true) ? 1 : 0,
      });
    return Number(info.lastInsertRowid);
  }

  /** All laps for a session in lap order. */
  forSession(sessionId: number): LapRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM laps WHERE session_id = ? ORDER BY lap_no ASC, id ASC')
      .all(sessionId) as LapRow[];
    return rows.map(toRecord);
  }

  /** Fuel-used samples from green/valid laps only — the input to the learning layer. */
  greenFuelUsed(sessionId: number): number[] {
    const rows = this.db
      .prepare(
        `SELECT fuel_used_l FROM laps
         WHERE session_id = ? AND valid = 1 AND fuel_used_l IS NOT NULL AND fuel_used_l > 0
         ORDER BY lap_no ASC, id ASC`,
      )
      .all(sessionId) as Array<{ fuel_used_l: number }>;
    return rows.map((r) => r.fuel_used_l);
  }
}
