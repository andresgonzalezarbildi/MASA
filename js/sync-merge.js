(() => {
  "use strict";

  const MISSING = Symbol("masa-missing");

  function clone(value) {
    if (value === MISSING) return MISSING;
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function sameValue(left, right) {
    if (left === MISSING || right === MISSING) return left === right;
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function mergeValue(base, local, remote) {
    if (sameValue(local, base)) return clone(remote);
    if (sameValue(remote, base)) return clone(local);
    if (sameValue(local, remote)) return clone(local);

    if (local === MISSING) return MISSING;
    if (remote === MISSING) return clone(local);

    if (isPlainObject(base) && isPlainObject(local) && isPlainObject(remote)) {
      const result = {};
      const keys = new Set([
        ...Object.keys(base),
        ...Object.keys(local),
        ...Object.keys(remote)
      ]);
      for (const key of keys) {
        const merged = mergeValue(
          Object.hasOwn(base, key) ? base[key] : MISSING,
          Object.hasOwn(local, key) ? local[key] : MISSING,
          Object.hasOwn(remote, key) ? remote[key] : MISSING
        );
        if (merged !== MISSING) result[key] = merged;
      }
      return result;
    }

    // Conflicto sobre el mismo valor: gana la edición local que originó la sincronización.
    return clone(local);
  }

  function collectionMap(values, keyOf) {
    const map = new Map();
    (Array.isArray(values) ? values : []).forEach(value => {
      const key = keyOf(value);
      if (key) map.set(key, value);
    });
    return map;
  }

  function mergeCollection(baseValues, localValues, remoteValues, keyOf, compare = null) {
    const base = collectionMap(baseValues, keyOf);
    const local = collectionMap(localValues, keyOf);
    const remote = collectionMap(remoteValues, keyOf);
    const keys = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);
    const result = [];

    for (const key of keys) {
      const merged = mergeValue(
        base.has(key) ? base.get(key) : MISSING,
        local.has(key) ? local.get(key) : MISSING,
        remote.has(key) ? remote.get(key) : MISSING
      );
      if (merged !== MISSING) result.push(merged);
    }

    if (typeof compare === "function") result.sort(compare);
    return result;
  }

  function flattenDiary(diary) {
    const result = [];
    Object.entries(isPlainObject(diary) ? diary : {}).forEach(([date, entries]) => {
      (Array.isArray(entries) ? entries : []).forEach(entry => {
        if (!entry || typeof entry !== "object") return;
        result.push({ ...clone(entry), __masaEntryDate: date });
      });
    });
    return result;
  }

  function rebuildDiary(entries) {
    const diary = {};
    entries.forEach(entry => {
      const date = String(entry.__masaEntryDate || "");
      if (!date) return;
      const clean = { ...entry };
      delete clean.__masaEntryDate;
      if (!diary[date]) diary[date] = [];
      diary[date].push(clean);
    });
    Object.values(diary).forEach(values => values.sort((a, b) => String(a.id || "").localeCompare(String(b.id || ""))));
    return diary;
  }

  function diaryKey(entry) {
    return String(entry?.id || `${entry?.__masaEntryDate || ""}:${entry?.meal || ""}:${entry?.name || ""}:${entry?.createdAt || ""}`);
  }

  function threeWayMergeState(baseState = {}, localState = {}, remoteState = {}) {
    const base = isPlainObject(baseState) ? baseState : {};
    const local = isPlainObject(localState) ? localState : {};
    const remote = isPlainObject(remoteState) ? remoteState : {};
    const merged = mergeValue(base, local, remote);

    merged.weighIns = mergeCollection(
      base.weighIns,
      local.weighIns,
      remote.weighIns,
      item => String(item?.date || item?.id || ""),
      (a, b) => String(a.date || "").localeCompare(String(b.date || ""))
    );
    merged.foods = mergeCollection(
      base.foods,
      local.foods,
      remote.foods,
      item => String(item?.id || ""),
      (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es")
    );
    merged.recipes = mergeCollection(
      base.recipes,
      local.recipes,
      remote.recipes,
      item => String(item?.id || ""),
      (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es")
    );
    merged.diary = rebuildDiary(mergeCollection(
      flattenDiary(base.diary),
      flattenDiary(local.diary),
      flattenDiary(remote.diary),
      diaryKey,
      (a, b) => {
        const dateOrder = String(a.__masaEntryDate || "").localeCompare(String(b.__masaEntryDate || ""));
        return dateOrder || String(a.id || "").localeCompare(String(b.id || ""));
      }
    ));

    const versions = [base.version, local.version, remote.version]
      .map(Number)
      .filter(Number.isFinite);
    if (versions.length) merged.version = Math.max(...versions);
    return merged;
  }

  const api = Object.freeze({ threeWayMergeState, mergeValue, mergeCollection });
  window.MASA_SYNC_MERGE = api;
})();
