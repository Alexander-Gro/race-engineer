import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db';
import { openDatabase } from '../db';
import { LapRepo } from '../repos/laps';
import { SessionRepo } from '../repos/sessions';

describe('SessionRepo / LapRepo round-trip', () => {
  let db: Db;
  let sessions: SessionRepo;
  let laps: LapRepo;

  beforeEach(() => {
    db = openDatabase(); // :memory:
    sessions = new SessionRepo(db);
    laps = new LapRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it('writes and reads a session unchanged', () => {
    const id = sessions.insert({
      game: 'lmu',
      track: 'Le Mans',
      car: 'Hypercar 01',
      carClass: 'Hypercar',
      type: 'race',
      server: 'Quick Race',
      startedAt: 1_000,
    });
    expect(id).toBe(1);

    const got = sessions.get(id);
    expect(got).toEqual({
      id: 1,
      game: 'lmu',
      track: 'Le Mans',
      car: 'Hypercar 01',
      carClass: 'Hypercar',
      type: 'race',
      server: 'Quick Race',
      startedAt: 1_000,
      endedAt: null,
    });
  });

  it('defaults optional session fields to null and finishes a session', () => {
    const id = sessions.insert({ game: 'lmu', startedAt: 5 });
    expect(sessions.get(id)).toMatchObject({
      track: null,
      car: null,
      carClass: null,
      type: null,
      server: null,
      endedAt: null,
    });

    sessions.finish(id, 9_999);
    expect(sessions.get(id)?.endedAt).toBe(9_999);
  });

  it('returns null for a missing session', () => {
    expect(sessions.get(404)).toBeNull();
  });

  it('writes and reads laps, preserving sector arrays and the valid flag', () => {
    const sid = sessions.insert({ game: 'lmu', startedAt: 0 });

    laps.insert({
      sessionId: sid,
      lapNo: 1,
      lapTimeS: 211.5,
      sectorTimesS: [70.1, 71.2, 70.2],
      fuelUsedL: 2.6,
      fuelLeftL: 57.4,
      avgTireTempC: 88,
      tireWear01: 0.98,
      compound: 'medium',
      conditions: 'dry',
      valid: true,
    });
    // An out-lap: minimal data, flagged invalid for learning.
    laps.insert({ sessionId: sid, lapNo: 2, valid: false });

    const rows = laps.forSession(sid);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      lapNo: 1,
      lapTimeS: 211.5,
      sectorTimesS: [70.1, 71.2, 70.2],
      fuelUsedL: 2.6,
      compound: 'medium',
      conditions: 'dry',
      valid: true,
    });
    expect(rows[1]).toMatchObject({
      lapNo: 2,
      lapTimeS: null,
      sectorTimesS: null,
      fuelUsedL: null,
      valid: false,
    });
  });

  it('greenFuelUsed returns only valid, positive fuel samples', () => {
    const sid = sessions.insert({ game: 'lmu', startedAt: 0 });
    laps.insert({ sessionId: sid, lapNo: 1, fuelUsedL: 2.6, valid: true });
    laps.insert({ sessionId: sid, lapNo: 2, fuelUsedL: 2.5, valid: true });
    laps.insert({ sessionId: sid, lapNo: 3, fuelUsedL: 9.9, valid: false }); // pit/in-lap
    laps.insert({ sessionId: sid, lapNo: 4, fuelUsedL: null, valid: true }); // no reading
    expect(laps.greenFuelUsed(sid)).toEqual([2.6, 2.5]);
  });

  it('cascades lap deletes when a session is removed', () => {
    const sid = sessions.insert({ game: 'lmu', startedAt: 0 });
    laps.insert({ sessionId: sid, lapNo: 1, fuelUsedL: 2.6 });
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
    expect(laps.forSession(sid)).toEqual([]);
  });
});
