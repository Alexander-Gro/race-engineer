// @race-engineer/strategy
// Pure, deterministic race + tuning analysis (depends on core only). See docs/05 (strategy) and
// docs/08 §3 (handling diagnosis). The LLM calls these as tools and phrases results; it never
// reproduces the math.
export * from './fuel';
export * from './tires';
export * from './pit';
export * from './stint';
export * from './undercut';
export * from './traffic';
export * from './fcy';
export * from './handling';
