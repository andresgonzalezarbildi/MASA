#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../css/styles.css", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `No se encontró ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth++;
    if (char === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`No se pudo extraer ${name}`);
}

const resolverSource = extractFunction("resolveEquivalenceDrafts");
const resolveEquivalenceDrafts = new Function(`
  const toNumber = (value, fallback = 0) => {
    const parsed = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const normalizeHeader = value => String(value || "").trim().toLowerCase();
  const canonicalEditableUnit = value => String(value || "custom");
  const equivalenceUnitKey = (unit, customUnit = "") => unit + ":" + normalizeHeader(customUnit);
  const createId = (() => { let index = 0; return () => "generated-" + (++index); })();
  let currentBase = { unit: "g", customUnit: "", amount: 100 };
  const equivalenceBaseUnitData = () => currentBase;
  ${resolverSource}
  return { resolveEquivalenceDrafts, setBase: base => { currentBase = base; } };
`)();

const unit = {
  id: "unit",
  amount: 1,
  unit: "unit",
  customUnit: "",
  referenceAmount: 100,
  referenceId: "",
  baseAmount: 100
};
const cup = {
  id: "cup",
  amount: 1,
  unit: "cup",
  customUnit: "",
  referenceAmount: 2,
  referenceId: "unit",
  baseAmount: 0
};

const direct = resolveEquivalenceDrafts.resolveEquivalenceDrafts("food", [unit]);
assert.equal(direct.error, undefined);
assert.equal(direct.items[0].baseAmount, 100);

const chained = resolveEquivalenceDrafts.resolveEquivalenceDrafts("food", [unit, cup]);
assert.equal(chained.error, undefined);
assert.equal(chained.items[1].baseAmount, 200);

const servingAmount = 100;
const caloriesPerServing = 200;
const unitOptionBaseAmount = unit.amount * servingAmount / direct.items[0].baseAmount;
assert.equal(0.5 / unitOptionBaseAmount * caloriesPerServing, 100);
const cupOptionBaseAmount = cup.amount * servingAmount / chained.items[1].baseAmount;
assert.equal(1 / cupOptionBaseAmount * caloriesPerServing, 400);

const cycle = resolveEquivalenceDrafts.resolveEquivalenceDrafts("food", [
  { ...unit, referenceId: "cup", referenceAmount: 1 },
  { ...cup, referenceId: "unit", referenceAmount: 1 }
]);
assert.match(cycle.error.message, /circularmente/);

const duplicate = resolveEquivalenceDrafts.resolveEquivalenceDrafts("food", [unit, { ...unit, id: "unit-2" }]);
assert.match(duplicate.error.message, /No repitas/);

assert.match(source, /if \(catalog\) return \{ kind: "external", id: catalog\.id \};/);
assert.match(source, /baseAmount: Math\.max\(0\.000001, equivalence\.amount \* baseServingAmount \/ equivalence\.baseAmount\)/);
assert.match(source, /Unidad que querés usar/);
assert.match(source, /Equivale a/);
assert.match(source, /equivalence-live-preview/);
assert.match(source, /equivalencePreviewText\(type, item\)/);
assert.match(styles, /html\.native-runtime \.equivalence-relation-symbol/);
assert.doesNotMatch(styles, /\.equivalence-equals \{ display: none;/);
assert.match(html, /Indicá qué unidad querés usar y a qué cantidad equivale/);

console.log("Equivalence tests: OK");
