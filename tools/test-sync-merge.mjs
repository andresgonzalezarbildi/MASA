import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../js/sync-merge.js", import.meta.url), "utf8");
const window = {};
vm.runInNewContext(source, { window, JSON, Map, Set, Symbol, Object, Array, String, Number });
const { threeWayMergeState } = window.MASA_SYNC_MERGE;

const cloudSource = await readFile(new URL("../js/cloud.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
assert.match(cloudSource, /const remote = await loadUserStateFromRemote\(\);/);
assert.match(cloudSource, /mergeCloudStates\(base, localState, remote\.state\)/);
assert.doesNotMatch(cloudSource, /from\("weigh_ins"\)\.delete\(\)\.eq\("user_id", userId\)/);
assert.match(cloudSource, /\.in\("recipe_id", batch\)/);
assert.match(appSource, /loadUserState\(\{ silent: true \}\)/);
assert.match(appSource, /setInterval\(\(\) => refreshCloudStateQuietly\(false\), 12_000\)/);
assert.match(appSource, /localRecoveryCandidate\(refreshedState, state\)/);

function baseState(overrides = {}) {
  return {
    version: 19,
    configured: true,
    profile: { name: "Andrés" },
    weighIns: [],
    foods: [],
    recipes: [],
    diary: {},
    completedDays: {},
    foodUsage: {},
    catalogOverrides: {},
    calibrationHistory: [],
    lastCheckinDate: "",
    ...overrides
  };
}

{
  const recipeA = { id: "r-a", name: "A", ingredients: [] };
  const recipeB = { id: "r-b", name: "B", ingredients: [] };
  const base = baseState({ recipes: [recipeA] });
  const local = baseState({ recipes: [recipeA] });
  const remote = baseState({ recipes: [recipeA, recipeB] });
  const merged = threeWayMergeState(base, local, remote);
  assert.equal(JSON.stringify(merged.recipes.map(item => item.id).sort()), JSON.stringify(["r-a", "r-b"]));
}

{
  const recipeA = { id: "r-a", name: "A", ingredients: [] };
  const recipeB = { id: "r-b", name: "B", ingredients: [] };
  const base = baseState({ recipes: [recipeA] });
  const local = baseState({ recipes: [] });
  const remote = baseState({ recipes: [recipeA, recipeB] });
  const merged = threeWayMergeState(base, local, remote);
  assert.equal(JSON.stringify(merged.recipes.map(item => item.id)), JSON.stringify(["r-b"]));
}

{
  const base = baseState({ diary: {} });
  const local = baseState({ diary: {
    "2026-08-05": [{ id: "local-entry", name: "Local", meal: "lunch" }]
  }});
  const remote = baseState({ diary: {
    "2026-08-05": [{ id: "remote-entry", name: "Remota", meal: "dinner" }]
  }});
  const merged = threeWayMergeState(base, local, remote);
  assert.equal(
    JSON.stringify(merged.diary["2026-08-05"].map(item => item.id).sort()),
    JSON.stringify(["local-entry", "remote-entry"])
  );
}

{
  const original = { id: "r-a", name: "Original", ingredients: [] };
  const localEdit = { ...original, name: "Edición local" };
  const remoteEdit = { ...original, name: "Edición remota" };
  const merged = threeWayMergeState(
    baseState({ recipes: [original] }),
    baseState({ recipes: [localEdit] }),
    baseState({ recipes: [remoteEdit] })
  );
  assert.equal(merged.recipes[0].name, "Edición local");
}

{
  const entry = { id: "entry-a", name: "Existente", meal: "lunch" };
  const base = baseState({ diary: { "2026-08-05": [entry] } });
  const local = baseState({ diary: { "2026-08-05": [entry] } });
  const remote = baseState({ diary: {} });
  const merged = threeWayMergeState(base, local, remote);
  assert.equal(Object.keys(merged.diary).length, 0);
}

{
  const base = baseState({ profile: { name: "Andrés", heightCm: 179 } });
  const local = baseState({ profile: { name: "Andrés", heightCm: 180 } });
  const remote = baseState({ profile: { name: "Andrés G.", heightCm: 179 } });
  const merged = threeWayMergeState(base, local, remote);
  assert.equal(JSON.stringify(merged.profile), JSON.stringify({ name: "Andrés G.", heightCm: 180 }));
}

console.log("OK: la mezcla de sincronización conserva cambios de varios dispositivos y respeta eliminaciones explícitas.");
