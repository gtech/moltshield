export {
  // Core evaluation
  evaluatePrompt,
  evaluateContext,
  shouldBlock,
  runHeuristics,
  clearCache,
  buildSystemPrompt,
  buildUserPrompt,
  ASSESSMENT_TASKS,
  // Exchange classifier (post-inference)
  evaluateExchange,
  clearExchangeCache,
  // Image evaluation
  evaluateImage,
  evaluateImages,
  clearImageCache,
  // Types
  type EvaluationResult,
  type EvaluatorConfig,
  type HeuristicResult,
  type AssessmentTask,
  type ExchangeEvaluationResult,
  type ImageEvaluationResult,
} from "./evaluator.js";
