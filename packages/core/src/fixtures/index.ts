import { lowFuelState } from './low-fuel';
import { midStintState } from './mid-stint';
import { multiClassTrafficState } from './multi-class-traffic';
import { raceStartState } from './race-start';

export { lowFuelState } from './low-fuel';
export { midStintState } from './mid-stint';
export { multiClassTrafficState } from './multi-class-traffic';
export { raceStartState } from './race-start';

// Canonical-state constructors, reused by the sim-replay synthetic generator (T0.4).
export * from './helpers';

/** All canonical fixtures, keyed by name — handy for table-driven tests. */
export const allFixtures = {
  raceStartState,
  midStintState,
  lowFuelState,
  multiClassTrafficState,
};
