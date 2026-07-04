import { GLOBAL_RULE_SCOPE, type RuleType } from "@dip/domain";
import { fold } from "./text.js";

/** Minimal rule row the engine needs (projection of normalization_rules). */
export interface RuleRow {
  id: string;
  ruleType: RuleType;
  sourceScope: string;
  matchKey: string;
  matchValue: string | null;
  normalizedKey: string | null;
  normalizedValue: string | null;
  priority: number;
  active: boolean;
}

export interface RegexRule {
  field: string;
  pattern: RegExp;
  ruleId: string;
}

export interface SelectorHint {
  field: string;
  selector: string;
  ruleId: string;
}

/**
 * Single application point for normalization_rules. Source-scoped rules
 * override global ones; within a scope, lower priority number wins.
 * Adding a rule row changes behavior on the next run with zero code changes —
 * this is the mechanism future AI-learned knowledge plugs into.
 */
export interface RuleEngine {
  brandAlias(rawBrand: string): string | null;
  categoryFor(text: string): string | null;
  productTypeFor(text: string): string | null;
  currencySymbolMap(): ReadonlyMap<string, string>;
  isIgnoredUrl(url: string): boolean;
  selectorHints(): SelectorHint[];
  regexRules(): RegexRule[];
}

export function createRuleEngine(rules: RuleRow[], sourceSlug: string): RuleEngine {
  // Scoped-before-global, then by priority, so the first hit wins.
  const applicable = rules
    .filter(
      (r) => r.active && (r.sourceScope === GLOBAL_RULE_SCOPE || r.sourceScope === sourceSlug),
    )
    .sort((a, b) => {
      if (a.sourceScope !== b.sourceScope) {
        return a.sourceScope === GLOBAL_RULE_SCOPE ? 1 : -1;
      }
      return a.priority - b.priority;
    });

  const byType = (type: RuleType) => applicable.filter((r) => r.ruleType === type);

  const brandAliases = new Map<string, string>();
  for (const rule of byType("brand_alias")) {
    if (rule.normalizedValue && !brandAliases.has(fold(rule.matchKey))) {
      brandAliases.set(fold(rule.matchKey), rule.normalizedValue);
    }
  }

  const currencySymbols = new Map<string, string>();
  for (const rule of byType("currency_hint")) {
    if (rule.normalizedValue && !currencySymbols.has(rule.matchKey)) {
      currencySymbols.set(rule.matchKey, rule.normalizedValue);
    }
  }

  const ignorePatterns = byType("ignore_pattern").map((r) => r.matchKey.toLowerCase());

  const keywordLookup = (type: RuleType, text: string): string | null => {
    const folded = ` ${fold(text)} `;
    for (const rule of byType(type)) {
      if (rule.normalizedValue && folded.includes(` ${fold(rule.matchKey)} `)) {
        return rule.normalizedValue;
      }
    }
    return null;
  };

  const compiledRegexRules: RegexRule[] = [];
  for (const rule of byType("regex_pattern")) {
    if (!rule.matchValue) continue;
    try {
      compiledRegexRules.push({
        field: rule.matchKey,
        pattern: new RegExp(rule.matchValue, "i"),
        ruleId: rule.id,
      });
    } catch {
      // An invalid stored pattern must never crash a run; it is simply skipped.
    }
  }

  return {
    brandAlias: (rawBrand) => brandAliases.get(fold(rawBrand)) ?? null,
    categoryFor: (text) => keywordLookup("category_keyword", text),
    productTypeFor: (text) => keywordLookup("product_type_keyword", text),
    currencySymbolMap: () => currencySymbols,
    isIgnoredUrl: (url) => {
      const lower = url.toLowerCase();
      return ignorePatterns.some((pattern) => lower.includes(pattern));
    },
    selectorHints: () =>
      byType("selector_hint")
        .filter((r) => r.normalizedKey)
        .map((r) => ({ field: r.normalizedKey as string, selector: r.matchKey, ruleId: r.id })),
    regexRules: () => compiledRegexRules,
  };
}
