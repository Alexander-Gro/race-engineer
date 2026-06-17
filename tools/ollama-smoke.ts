/**
 * Live Ollama end-to-end smoke test (run: `pnpm tsx tools/ollama-smoke.ts [model]`).
 *
 * Drives the REAL {@link OllamaProvider} through the REAL orchestrator + hallucination guard — the
 * exact path `AskResponder` uses in the worker — against a fixture race context, so we can prove the
 * local AI actually generates a grounded radio reply (and calls the read-only tools) without launching
 * the Electron GUI. Read-only/advisory: it only reads a fixture and talks to localhost Ollama.
 */
import { multiClassTrafficState } from '@race-engineer/core/fixtures';
import {
  OllamaProvider,
  checkSpokenNumbers,
  runRadioTurn,
  askEngineer,
  type RaceContext,
} from '@race-engineer/ai';

const model = process.argv[2] ?? 'qwen3';

// A hand-built fuel plan (the deterministic engine produces this in the real app; we inline it here so
// the smoke test only needs `ai` + `core/fixtures`, both resolvable from the repo root).
const ctx: RaceContext = {
  raceState: multiClassTrafficState,
  fuelPlan: {
    perLapLiters: 2.6,
    lapsRemainingOnFuel: 14.6,
    lapsToFinish: 22,
    litersToFinish: 57.2,
    litersToAddNextStop: 19.2,
    fuelSaveTargetLitersPerLap: 2.45,
    perLapEnergy01: null,
    lapsRemainingOnEnergy: null,
    energyToFinish01: null,
    energyToAddNextStop01: null,
    energySaveTargetPerLap01: null,
    bindingConstraint: 'fuel',
    confidence01: 0.8,
  },
};

const questions = ["How's my fuel looking?", 'Should I be worried about my pace?'];

const main = async (): Promise<void> => {
  console.log(`\n=== Live Ollama smoke test (model: ${model}) ===\n`);
  const provider = new OllamaProvider({ model });

  for (const q of questions) {
    console.log(`DRIVER: ${q}`);
    const t0 = Date.now();
    const result = await runRadioTurn({ provider, context: () => ctx, userMessage: q });
    const ms = Date.now() - t0;

    const guard = checkSpokenNumbers(result);
    const spoken = guard.grounded && result.text.trim() ? result.text.trim() : askEngineer(q, ctx);

    console.log(`  tools called : ${result.toolCalls.map((c) => c.name).join(', ') || '(none)'}`);
    console.log(`  rounds       : ${result.rounds}  ·  ${ms} ms`);
    console.log(
      `  guard        : ${guard.grounded ? 'GROUNDED → speak LLM' : 'ungrounded → template fallback'}`,
    );
    console.log(`  LLM draft    : ${result.text.trim() || '(empty)'}`);
    console.log(`ENGINEER: ${spoken}\n`);
  }
  console.log('=== done — the local AI generated the replies above ===\n');
};

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
