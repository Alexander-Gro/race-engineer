// @race-engineer/adapter-lmu
// Read-only LMU integration. T1.1 ships the rF2 shared-memory S1 dump tooling (struct
// decoders + torn-read guard, layouts verified in docs/03 §S1). The production GameAdapter
// + Normalizer mapping land in T2.1/T2.3. There is no write path (CLAUDE.md rule 5).
export * from './shm/layout';
export * from './shm/structs';
export * from './shm/torn-read';
export * from './shm/win32';
export * from './shm/reader';
export * from './types';
export * from './capabilities';
export * from './adapter';
export * from './normalizer';
export * from './rest/client';
export * from './rest/probe';
export * from './rest/virtual-energy';
export * from './rest/aids';
export * from './setup/svm';
