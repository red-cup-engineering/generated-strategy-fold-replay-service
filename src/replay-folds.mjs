function outputScores(output, symbols) {
  if (!output || typeof output !== "object" || Array.isArray(output) || typeof output.abstain !== "boolean" || !output.scores || typeof output.scores !== "object" || Array.isArray(output.scores)) throw new TypeError("generated-strategy-output-schema-invalid");
  if (Object.keys(output.scores).some((symbol) => !symbols.includes(symbol))) throw new TypeError("generated-strategy-foreign-symbol-refused");
  const scores = Object.fromEntries(symbols.map((symbol) => {
    const score = Number(output.scores[symbol] ?? 0);
    if (!Number.isFinite(score) || score < -1 || score > 1) throw new TypeError("generated-strategy-score-bound-refused");
    return [symbol, score];
  }));
  return { scores, abstain: output.abstain };
}
export function createGeneratedStrategyFoldReplay({ replayProgram, allocateMandatePortfolio, replayTransactionCosts }) {
  if (![replayProgram, allocateMandatePortfolio, replayTransactionCosts].every((provider) => typeof provider === "function")) throw new TypeError("explicit-generated-replay-providers-required");
  return async function replay({ source, staticAssay, featureSequence, folds, mandate, horizon = 5, transactionCostBps = 10, maximumReplayWallClockMs = 5_000 } = {}) {
    if (staticAssay?.admitted !== true || featureSequence?.type !== "CausalFeatureFrameSequence" || folds?.type !== "PurgedWalkForwardFolds" || mandate?.type !== "PortfolioAllocationMandate" || !Number.isInteger(horizon) || horizon < 1) throw new TypeError("generated-fold-replay-input-invalid");
    const frameByIndex = new Map(featureSequence.frames.map((frame) => [frame.index, frame]));
    const symbols = featureSequence.entities.filter((entity) => entity !== featureSequence.benchmark), periods = [];
    let currentWeights = Object.fromEntries(symbols.map((symbol) => [symbol, 0]));
    for (const fold of folds.folds) {
      const frame = frameByIndex.get(fold.prediction);
      if (!frame) throw new TypeError("generated-fold-feature-frame-absent");
      const executed = await replayProgram({ source, staticAssay, input: frame.input, maximumWallClockMs: maximumReplayWallClockMs });
      if (executed?.type !== "DeterministicStrategyProgramReplay") throw new TypeError(`generated-program-replay-refused:${executed?.reason ?? "unknown"}`);
      const decision = outputScores(executed.output, symbols);
      const allocation = decision.abstain
        ? { weights: Object.freeze(Object.fromEntries(symbols.map((symbol) => [symbol, 0]))), cashWeight: 1, turnover: Object.values(currentWeights).reduce((sum, weight) => sum + Math.abs(weight), 0) }
        : allocateMandatePortfolio({ scores: decision.scores, uncertainty: {}, currentWeights, mandate });
      const realizedReturns = Object.fromEntries(symbols.map((symbol) => [symbol, featureSequence.pricesBySymbol[symbol][fold.outcome] / featureSequence.pricesBySymbol[symbol][fold.prediction] - 1]));
      periods.push(Object.freeze({ at: fold.predictedAt, outcomeAt: fold.outcomeAt, weights: allocation.weights, realizedReturns, source: staticAssay.source }));
      currentWeights = allocation.weights;
    }
    const validationCount = folds.validation.length;
    const latest = featureSequence.frames.at(-1), currentExecution = await replayProgram({ source, staticAssay, input: latest.input, maximumWallClockMs: maximumReplayWallClockMs });
    if (currentExecution?.type !== "DeterministicStrategyProgramReplay") throw new TypeError(`generated-current-replay-refused:${currentExecution?.reason ?? "unknown"}`);
    const currentOutput = outputScores(currentExecution.output, symbols);
    const currentAllocation = currentOutput.abstain ? { weights: Object.fromEntries(symbols.map((symbol) => [symbol, 0])), cashWeight: 1, turnover: 0 } : allocateMandatePortfolio({ scores: currentOutput.scores, uncertainty: {}, currentWeights, mandate });
    return Object.freeze({
      type: "GeneratedStrategyPurgedFoldReplay", version: 1, source: staticAssay.source,
      validation: replayTransactionCosts({ periods: periods.slice(0, validationCount), transactionCostBps }),
      holdout: replayTransactionCosts({ periods: periods.slice(validationCount), transactionCostBps }),
      full: replayTransactionCosts({ periods, transactionCostBps }),
      currentDecision: Object.freeze({ at: latest.at, scores: currentOutput.scores, abstain: currentOutput.abstain, targetWeights: Object.freeze(currentAllocation.weights), cashWeight: currentAllocation.cashWeight, outcomeResolved: false }),
      sandboxed: true, deterministic: true, orderEffect: false, promotionEstablished: false
    });
  };
}
