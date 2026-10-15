import assert from "node:assert/strict";
import test from "node:test";
import { createGeneratedStrategyFoldReplay } from "@red-cup-engineering/generated-strategy-fold-replay-service";
test("routes every causal decision through the sandbox and preserves untouched holdout", async () => {
  const frames = Array.from({ length: 10 }, (_, index) => ({ index, at: `t${index}`, input: { symbols: ["AAA", "BBB"], features: { AAA: {}, BBB: {} } } }));
  const prices = { AAA: Array.from({ length: 10 }, (_, i) => 100 + i), BBB: Array.from({ length: 10 }, (_, i) => 100 - i / 2), SPY: Array(10).fill(100) };
  const fold = (prediction, outcome) => ({ prediction, outcome, predictedAt: `t${prediction}`, outcomeAt: `t${outcome}` });
  let calls = 0;
  const run = createGeneratedStrategyFoldReplay({
    replayProgram: async () => (calls++, { type: "DeterministicStrategyProgramReplay", output: { scores: { AAA: 1, BBB: 0 }, abstain: false } }),
    allocateMandatePortfolio: ({ scores }) => ({ weights: { AAA: scores.AAA, BBB: scores.BBB }, cashWeight: 0, turnover: 1 }),
    replayTransactionCosts: ({ periods }) => ({ metrics: { periods: periods.length, totalReturn: periods.reduce((sum, period) => sum + period.realizedReturns.AAA, 0) } })
  });
  const result = await run({ source: "export function decide(input){return input}", staticAssay: { admitted: true, source: "ni:///sha-256;aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, featureSequence: { type: "CausalFeatureFrameSequence", benchmark: "SPY", entities: ["AAA", "BBB", "SPY"], frames, pricesBySymbol: prices }, folds: { type: "PurgedWalkForwardFolds", folds: [fold(2, 3), fold(4, 5), fold(6, 7), fold(8, 9)], validation: [fold(2, 3), fold(4, 5)], holdout: [fold(6, 7), fold(8, 9)] }, mandate: { type: "PortfolioAllocationMandate" } });
  assert.equal(result.validation.metrics.periods, 2);
  assert.equal(result.holdout.metrics.periods, 2);
  assert.equal(calls, 5);
  assert.equal(result.orderEffect, false);
});
