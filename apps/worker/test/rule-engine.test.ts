import { describe, expect, it } from "vitest";
import { createRuleEngine, type RuleRow } from "../src/transform/normalize/rule-engine.js";

let nextId = 1;
function rule(partial: Partial<RuleRow> & Pick<RuleRow, "ruleType" | "matchKey">): RuleRow {
  return {
    id: `rule-${nextId++}`,
    sourceScope: "global",
    matchValue: null,
    normalizedKey: null,
    normalizedValue: null,
    priority: 100,
    active: true,
    ...partial,
  };
}

describe("createRuleEngine", () => {
  it("resolves brand aliases through folding", () => {
    const engine = createRuleEngine(
      [rule({ ruleType: "brand_alias", matchKey: "dr jart", normalizedValue: "Dr. Jart+" })],
      "any-source",
    );
    expect(engine.brandAlias("DR. JART+")).toBe("Dr. Jart+");
    expect(engine.brandAlias("Dr Jart")).toBe("Dr. Jart+");
    expect(engine.brandAlias("Laneige")).toBeNull();
  });

  it("prefers source-scoped rules over global, then lower priority number", () => {
    const engine = createRuleEngine(
      [
        rule({ ruleType: "brand_alias", matchKey: "abc", normalizedValue: "Global Brand" }),
        rule({
          ruleType: "brand_alias",
          matchKey: "abc",
          normalizedValue: "Scoped Brand",
          sourceScope: "my-source",
        }),
      ],
      "my-source",
    );
    expect(engine.brandAlias("abc")).toBe("Scoped Brand");
  });

  it("ignores inactive rules and rules scoped to other sources", () => {
    const engine = createRuleEngine(
      [
        rule({
          ruleType: "brand_alias",
          matchKey: "x",
          normalizedValue: "Inactive",
          active: false,
        }),
        rule({
          ruleType: "brand_alias",
          matchKey: "y",
          normalizedValue: "Other",
          sourceScope: "other-source",
        }),
      ],
      "my-source",
    );
    expect(engine.brandAlias("x")).toBeNull();
    expect(engine.brandAlias("y")).toBeNull();
  });

  it("matches category keywords on word boundaries", () => {
    const engine = createRuleEngine(
      [rule({ ruleType: "category_keyword", matchKey: "essence", normalizedValue: "Skincare" })],
      "s",
    );
    expect(engine.categoryFor("Snail 96 Mucin Power Essence")).toBe("Skincare");
    expect(engine.categoryFor("Essenceless product")).toBeNull();
  });

  it("builds the currency symbol map and detects ignored urls", () => {
    const engine = createRuleEngine(
      [
        rule({ ruleType: "currency_hint", matchKey: "₩", normalizedValue: "KRW" }),
        rule({ ruleType: "ignore_pattern", matchKey: "/login" }),
      ],
      "s",
    );
    expect(engine.currencySymbolMap().get("₩")).toBe("KRW");
    expect(engine.isIgnoredUrl("https://shop.test/Login?next=/")).toBe(true);
    expect(engine.isIgnoredUrl("https://shop.test/product/1")).toBe(false);
  });

  it("skips invalid stored regex patterns instead of crashing", () => {
    const engine = createRuleEngine(
      [rule({ ruleType: "regex_pattern", matchKey: "spf", matchValue: "([invalid" })],
      "s",
    );
    expect(engine.regexRules()).toHaveLength(0);
  });
});
