export {
  createPromotionService,
  type PromotionService,
  type PromotionSummary,
  type ItemOutcome,
} from "./service.js";
export { normalizeSourceUrl } from "./url.js";
export { pickMatch, type MatchCandidate, type MatchResult } from "./matcher.js";
export { fold, slugify, similarity } from "./text.js";
