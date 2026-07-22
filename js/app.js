(() => {
  "use strict";

  const STORAGE_KEY = "masa-state-v7";
  const LEGACY_KEYS = ["masa-state-v6", "masa-state-v5", "peso-claro-state-v2", "peso-claro-state-v1"];
  const DAY_MS = 86_400_000;
  const KG_KCAL = 7700;

  const DEFAULT_PROFILE = {
    name: "",
    birthDate: "",
    sex: "male",
    heightCm: "",
    bodyFat: "",
    formula: "mifflin",
    activityFactor: 1.35,
    calibrationOffset: 0,
    goalType: "loss",
    goalMetric: "weight",
    goalWeight: "",
    goalBodyFat: "",
    goalDate: "",
    rateMode: "auto",
    weeklyRatePct: 0.5,
    macroMode: "auto",
    proteinPct: "",
    fatPct: "",
    carbPct: "",
    trendWindow: 7,
    planStartDate: "",
    planStartWeight: ""
  };

  const ACTIVITY_LABELS = {
    "1.2": "Bajo · 1,20",
    "1.35": "Ligero · 1,35",
    "1.5": "Medio · 1,50",
    "1.7": "Alto · 1,70",
    "1.9": "Muy alto · 1,90"
  };

  const ACTIVITY_EXPLANATIONS = {
    "1.2": "Rutina mayormente sentada, pocos pasos y entrenamiento inexistente o esporádico.",
    "1.35": "Trabajo principalmente sentado, con caminatas habituales o 2–3 sesiones semanales.",
    "1.5": "Movimiento frecuente durante el día o 3–5 sesiones semanales. Es un punto medio razonable para muchas personas activas.",
    "1.7": "Trabajo físico, muchos pasos diarios o entrenamiento exigente y frecuente.",
    "1.9": "Trabajo físico más entrenamiento intenso casi diario. Es poco habitual y suele sobreestimarse."
  };

  const FORMULA_LABELS = {
    mifflin: "Mifflin–St Jeor",
    harris: "Harris–Benedict",
    cunningham: "Cunningham"
  };

  let state = loadState();
  let settingsRequired = false;
  let importMode = "profile";
  let chartPayload = null;
  let chartRange = "3m";
  let recalibrationSuggestion = null;
  let fillingProfileForm = false;
  let activeMeal = "breakfast";
  let activeFoodMode = "food";
  let activeAppView = "today";
  let activeDiaryView = "record";
  let calorieRange = 14;
  let weightEditorForced = false;

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function toNumber(value, fallback = "") {
    if (value === "" || value === null || value === undefined) return fallback;
    const parsed = Number(String(value).trim().replace(",", "."));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function createId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function toISODate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function todayISO() {
    return toISODate(new Date());
  }

  function normalizeDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return toISODate(value);
    const raw = String(value || "").trim().replace(/^"|"$/g, "");
    let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return validISO(`${match[1]}-${match[2]}-${match[3]}`) ? `${match[1]}-${match[2]}-${match[3]}` : "";
    match = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/);
    if (match) {
      let year = match[3] ? Number(match[3]) : new Date().getFullYear();
      if (year < 100) year += 2000;
      const iso = `${year}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
      return validISO(iso) ? iso : "";
    }
    match = raw.match(/^(\d{2})(\d{2})(\d{2}|\d{4})$/);
    if (match) {
      let year = Number(match[3]);
      if (year < 100) year += 2000;
      const iso = `${year}-${match[2]}-${match[1]}`;
      return validISO(iso) ? iso : "";
    }
    return "";
  }

  function validISO(value) {
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
    return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
  }

  function parseDate(value) {
    const iso = normalizeDate(value);
    if (!iso) return null;
    const [year, month, day] = iso.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  function displayDate(value) {
    const iso = normalizeDate(value);
    if (!iso) return "";
    const [year, month, day] = iso.split("-");
    return `${day}/${month}/${year}`;
  }

  function formatDate(value) {
    const formatted = displayDate(value);
    return formatted || "—";
  }

  function formatMonth(value) {
    const date = value instanceof Date ? value : parseDate(value);
    if (!date) return "—";
    return new Intl.DateTimeFormat("es-UY", { month: "long", year: "numeric" }).format(date);
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function addMonths(date, months) {
    return new Date(date.getFullYear(), date.getMonth() + months, 1, 12, 0, 0, 0);
  }

  function endOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
  }

  function daysBetween(a, b) {
    return (b - a) / DAY_MS;
  }

  function formatNumber(value, digits = 0) {
    return Number.isFinite(Number(value))
      ? Number(value).toLocaleString("es-UY", { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : "—";
  }

  function formatKg(value, digits = 1) {
    return Number.isFinite(Number(value)) ? `${formatNumber(value, digits)} kg` : "—";
  }

  function formatSignedKg(value) {
    if (!Number.isFinite(value)) return "—";
    return `${value > 0 ? "+" : ""}${formatNumber(value, 2)} kg`;
  }

  function nearestActivity(value) {
    const options = [1.2, 1.35, 1.5, 1.7, 1.9];
    return options.reduce((best, current) => Math.abs(current - value) < Math.abs(best - value) ? current : best, 1.35);
  }

  function normalizeProfile(raw = {}, weighIns = []) {
    const sorted = [...weighIns].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0];
    const latest = sorted.at(-1);
    const oldProtein = toNumber(raw.proteinGrams, NaN);
    const oldFat = toNumber(raw.fatGrams, NaN);
    const oldCarbs = toNumber(raw.carbGrams, NaN);
    const oldMacroCalories = oldProtein * 4 + oldFat * 9 + oldCarbs * 4;
    const hasOldMacros = [oldProtein, oldFat, oldCarbs].every(Number.isFinite) && oldMacroCalories > 0;
    const hasPercentMacros = [raw.proteinPct, raw.fatPct, raw.carbPct].every(value => Number.isFinite(toNumber(value, NaN)));
    const macroMode = raw.macroMode === "manual" && (hasPercentMacros || hasOldMacros) ? "manual" : "auto";
    const migratedProteinPct = hasPercentMacros ? toNumber(raw.proteinPct) : hasOldMacros ? oldProtein * 4 / oldMacroCalories * 100 : "";
    const migratedFatPct = hasPercentMacros ? toNumber(raw.fatPct) : hasOldMacros ? oldFat * 9 / oldMacroCalories * 100 : "";
    const migratedCarbPct = hasPercentMacros ? toNumber(raw.carbPct) : hasOldMacros ? oldCarbs * 4 / oldMacroCalories * 100 : "";

    return {
      ...clone(DEFAULT_PROFILE),
      ...raw,
      name: String(raw.name || "").trim(),
      birthDate: normalizeDate(raw.birthDate),
      sex: raw.sex === "female" ? "female" : "male",
      heightCm: toNumber(raw.heightCm),
      bodyFat: toNumber(raw.bodyFat),
      formula: ["mifflin", "harris", "cunningham"].includes(raw.formula) ? raw.formula : "mifflin",
      activityFactor: [1.2, 1.35, 1.5, 1.7, 1.9].includes(toNumber(raw.activityFactor))
        ? toNumber(raw.activityFactor)
        : nearestActivity(toNumber(raw.activityFactor, 1.35)),
      calibrationOffset: clamp(toNumber(raw.calibrationOffset, 0), -900, 900),
      goalType: ["loss", "maintain", "gain"].includes(raw.goalType) ? raw.goalType : "loss",
      goalMetric: ["weight", "bodyFat"].includes(raw.goalMetric) ? raw.goalMetric : "weight",
      goalWeight: toNumber(raw.goalWeight),
      goalBodyFat: toNumber(raw.goalBodyFat),
      goalDate: normalizeDate(raw.goalDate),
      rateMode: ["auto", "manual"].includes(raw.rateMode) ? raw.rateMode : "auto",
      weeklyRatePct: clamp(toNumber(raw.weeklyRatePct, raw.goalType === "gain" ? 0.25 : 0.5), 0, 2),
      macroMode,
      proteinPct: macroMode === "manual" ? clamp(migratedProteinPct, 5, 70) : "",
      fatPct: macroMode === "manual" ? clamp(migratedFatPct, 10, 70) : "",
      carbPct: macroMode === "manual" ? clamp(migratedCarbPct, 5, 80) : "",
      trendWindow: clamp(Math.round(toNumber(raw.trendWindow, 7)), 3, 14),
      planStartDate: normalizeDate(raw.planStartDate) || first?.date || "",
      planStartWeight: toNumber(raw.planStartWeight, first?.weight || "")
    };
  }

  function normalizeState(raw = {}) {
    const input = Array.isArray(raw) ? { weighIns: raw } : raw;
    const weighIns = Array.isArray(input.weighIns)
      ? input.weighIns.map(item => ({
          id: item.id || createId(),
          date: normalizeDate(item.date || item.fecha),
          weight: toNumber(item.weight ?? item.peso ?? item.peso_kg, NaN)
        })).filter(item => item.date && Number.isFinite(item.weight) && item.weight > 0)
      : [];

    const deduped = new Map();
    weighIns.forEach(item => deduped.set(item.date, item));
    const sorted = [...deduped.values()].sort((a, b) => a.date.localeCompare(b.date));
    const profile = normalizeProfile(input.profile || {}, sorted);

    const foods = Array.isArray(input.foods) ? input.foods.map(normalizeFood).filter(Boolean) : [];
    const recipes = Array.isArray(input.recipes) ? input.recipes.map(item => normalizeFood({ ...item, kind: "recipe" })).filter(Boolean) : [];
    const diary = {};
    Object.entries(input.diary || {}).forEach(([date, entries]) => {
      const iso = normalizeDate(date);
      if (!iso || !Array.isArray(entries)) return;
      diary[iso] = entries.map(normalizeDiaryEntry).filter(Boolean);
    });

    const completedDays = {};
    Object.entries(input.completedDays || {}).forEach(([date, completed]) => {
      const iso = normalizeDate(date);
      if (iso && completed) completedDays[iso] = true;
    });

    const configured = profileIsComplete(profile, sorted);
    return {
      version: 7,
      configured,
      profile,
      weighIns: sorted,
      foods,
      recipes,
      diary,
      completedDays,
      lastCheckinDate: normalizeDate(input.lastCheckinDate)
    };
  }

  function normalizeFood(item = {}) {
    const name = String(item.name || "").trim();
    const calories = toNumber(item.calories, NaN);
    if (!name || !Number.isFinite(calories) || calories < 0) return null;
    return {
      id: item.id || createId(),
      name,
      calories,
      protein: Math.max(0, toNumber(item.protein, 0)),
      fat: Math.max(0, toNumber(item.fat, 0)),
      carbs: Math.max(0, toNumber(item.carbs, 0)),
      serving: String(item.serving || "1 porción").trim() || "1 porción",
      kind: item.kind === "recipe" ? "recipe" : "food",
      uses: Math.max(0, Math.round(toNumber(item.uses, 0))),
      lastUsed: normalizeDate(item.lastUsed)
    };
  }

  function normalizeDiaryEntry(item = {}) {
    const food = normalizeFood(item);
    if (!food) return null;
    return {
      ...food,
      id: item.id || createId(),
      sourceId: item.sourceId || "",
      meal: ["breakfast", "lunch", "snack", "dinner", "extras"].includes(item.meal) ? item.meal : "extras"
    };
  }

  function profileIsComplete(profile, weighIns) {
    return Boolean(
      parseDate(profile.birthDate) &&
      Number(profile.heightCm) > 0 &&
      ["male", "female"].includes(profile.sex) &&
      Array.isArray(weighIns) && weighIns.length > 0 &&
      (profile.goalType === "maintain" || ((Number(profile.goalWeight) > 0 || Number(profile.goalBodyFat) > 0) && Boolean(parseDate(profile.goalDate))))
    );
  }

  function loadState() {
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      if (current) return normalizeState(JSON.parse(current));
      for (const key of LEGACY_KEYS) {
        const legacy = localStorage.getItem(key);
        if (legacy) return normalizeState(JSON.parse(legacy));
      }
    } catch (_) {}
    return normalizeState({ configured: false, profile: DEFAULT_PROFILE, weighIns: [] });
  }

  function saveState(next = state) {
    state = normalizeState(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
    return state;
  }

  function sortedWeighIns(values = state.weighIns) {
    return [...values].sort((a, b) => a.date.localeCompare(b.date));
  }

  function latestWeighIn(values = state.weighIns) {
    return sortedWeighIns(values).at(-1) || null;
  }

  function mergeWeighIns(existing, incoming) {
    const map = new Map(existing.map(item => [item.date, { ...item }]));
    incoming.forEach(item => {
      const date = normalizeDate(item.date);
      const weight = toNumber(item.weight, NaN);
      if (!date || !Number.isFinite(weight) || weight <= 0) return;
      map.set(date, { id: item.id || map.get(date)?.id || createId(), date, weight });
    });
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  function rollingTrend(values = state.weighIns, windowSize = state.profile.trendWindow || 7) {
    const sorted = sortedWeighIns(values);
    return sorted.map((item, index) => {
      const sample = sorted.slice(Math.max(0, index - windowSize + 1), index + 1);
      return { ...item, trend: sample.reduce((sum, current) => sum + current.weight, 0) / sample.length };
    });
  }

  function regressionRatePerWeek(values = state.weighIns, limit = 21) {
    const points = sortedWeighIns(values).slice(-limit);
    if (points.length < 3) return null;
    const origin = parseDate(points[0].date);
    const data = points.map(item => ({ x: daysBetween(origin, parseDate(item.date)), y: item.weight }));
    const meanX = data.reduce((sum, item) => sum + item.x, 0) / data.length;
    const meanY = data.reduce((sum, item) => sum + item.y, 0) / data.length;
    const numerator = data.reduce((sum, item) => sum + (item.x - meanX) * (item.y - meanY), 0);
    const denominator = data.reduce((sum, item) => sum + (item.x - meanX) ** 2, 0);
    return denominator ? (numerator / denominator) * 7 : null;
  }

  function ageFromBirthDate(value) {
    const birth = parseDate(value);
    const today = new Date();
    if (!birth || birth > today) return null;
    let age = today.getFullYear() - birth.getFullYear();
    if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age -= 1;
    return age >= 18 && age <= 120 ? age : null;
  }

  function mifflin(sex, weight, height, age) {
    return 10 * weight + 6.25 * height - 5 * age + (sex === "female" ? -161 : 5);
  }

  function formulaRmr(profile, weight) {
    const age = ageFromBirthDate(profile.birthDate);
    const height = toNumber(profile.heightCm, NaN);
    const bodyFat = toNumber(profile.bodyFat, NaN);
    if (![age, height, weight].every(Number.isFinite)) return { value: null, used: profile.formula, fallback: false };

    if (profile.formula === "cunningham") {
      if (Number.isFinite(bodyFat) && bodyFat > 1 && bodyFat < 70) {
        const leanMass = weight * (1 - bodyFat / 100);
        return { value: 500 + 22 * leanMass, used: "cunningham", fallback: false };
      }
      return { value: mifflin(profile.sex, weight, height, age), used: "mifflin", fallback: true };
    }

    if (profile.formula === "harris") {
      const value = profile.sex === "female"
        ? 447.593 + 9.247 * weight + 3.098 * height - 4.330 * age
        : 88.362 + 13.397 * weight + 4.799 * height - 5.677 * age;
      return { value, used: "harris", fallback: false };
    }

    return { value: mifflin(profile.sex, weight, height, age), used: "mifflin", fallback: false };
  }

  function autoMacroRule(goalType) {
    if (goalType === "loss") return { proteinPerKg: 1.9, fatPercent: 25 };
    if (goalType === "gain") return { proteinPerKg: 1.7, fatPercent: 25 };
    return { proteinPerKg: 1.6, fatPercent: 25 };
  }

  function deriveTargetWeight(profile, currentWeight) {
    if (profile.goalType === "maintain") return currentWeight;
    if (profile.goalMetric === "bodyFat") {
      const currentBodyFat = toNumber(profile.bodyFat, NaN);
      const targetBodyFat = toNumber(profile.goalBodyFat, NaN);
      if (Number.isFinite(currentBodyFat) && Number.isFinite(targetBodyFat) && currentBodyFat > 0 && targetBodyFat > 0 && targetBodyFat < 70) {
        const leanMass = currentWeight * (1 - currentBodyFat / 100);
        return leanMass / (1 - targetBodyFat / 100);
      }
      return null;
    }
    return toNumber(profile.goalWeight, NaN);
  }

  function rateBounds(goalType) {
    if (goalType === "loss") return { suggestedMin: 0.5, suggestedMax: 1, defaultRate: 0.5 };
    if (goalType === "gain") return { suggestedMin: 0.25, suggestedMax: 0.5, defaultRate: 0.25 };
    return { suggestedMin: 0, suggestedMax: 0, defaultRate: 0 };
  }

  function requiredRateForDate(profile, currentWeight, targetWeight) {
    const deadline = parseDate(profile.goalDate);
    const today = parseDate(todayISO());
    if (!deadline || deadline <= today || !Number.isFinite(targetWeight) || currentWeight <= 0 || targetWeight <= 0 || profile.goalType === "maintain") return null;
    const weeks = daysBetween(today, deadline) / 7;
    if (weeks <= 0) return null;
    if (profile.goalType === "loss" && targetWeight < currentWeight) return (1 - (targetWeight / currentWeight) ** (1 / weeks)) * 100;
    if (profile.goalType === "gain" && targetWeight > currentWeight) return ((targetWeight / currentWeight) ** (1 / weeks) - 1) * 100;
    return null;
  }

  function chooseRate(profile, currentWeight, targetWeight) {
    const bounds = rateBounds(profile.goalType);
    const required = requiredRateForDate(profile, currentWeight, targetWeight);
    if (profile.goalType === "maintain") return { selected: 0, required, bounds, capped: false };
    if (profile.rateMode === "manual") {
      const selected = clamp(toNumber(profile.weeklyRatePct, bounds.defaultRate), 0.01, 2);
      return { selected, required, bounds, capped: selected > bounds.suggestedMax };
    }
    if (Number.isFinite(required) && required > 0) {
      const selected = Math.min(required, bounds.suggestedMax);
      return { selected, required, bounds, capped: required > bounds.suggestedMax };
    }
    return { selected: bounds.defaultRate, required, bounds, capped: false };
  }

  function weeksToTarget(goalType, startWeight, targetWeight, ratePct) {
    if (goalType === "maintain" || !Number.isFinite(startWeight) || !Number.isFinite(targetWeight) || !Number.isFinite(ratePct) || ratePct <= 0) return null;
    if (goalType === "loss" && targetWeight < startWeight) return Math.log(targetWeight / startWeight) / Math.log(1 - ratePct / 100);
    if (goalType === "gain" && targetWeight > startWeight) return Math.log(targetWeight / startWeight) / Math.log(1 + ratePct / 100);
    return null;
  }

  function projectWeight(profile, startWeight, startDate, targetWeight, ratePct, targetDate) {
    if (!startDate || !targetDate || !Number.isFinite(startWeight)) return null;
    const weeks = Math.max(0, daysBetween(startDate, targetDate) / 7);
    let result = startWeight;
    if (profile.goalType === "loss") result = startWeight * (1 - ratePct / 100) ** weeks;
    if (profile.goalType === "gain") result = startWeight * (1 + ratePct / 100) ** weeks;
    if (Number.isFinite(targetWeight)) {
      if (profile.goalType === "loss") result = Math.max(targetWeight, result);
      if (profile.goalType === "gain") result = Math.min(targetWeight, result);
    }
    return result;
  }

  function calculatePlan(profile = state.profile, weighIns = state.weighIns, overrideWeight = null) {
    const latest = latestWeighIn(weighIns);
    const weight = Number.isFinite(toNumber(overrideWeight, NaN)) ? toNumber(overrideWeight) : latest?.weight;
    if (!Number.isFinite(weight)) return emptyPlan(profile);

    const targetWeight = deriveTargetWeight(profile, weight);
    const rate = chooseRate(profile, weight, targetWeight);
    const rmr = formulaRmr(profile, weight);
    const baseMaintenance = Number.isFinite(rmr.value) ? rmr.value * toNumber(profile.activityFactor, 1.35) : null;
    const maintenance = Number.isFinite(baseMaintenance) ? baseMaintenance + toNumber(profile.calibrationOffset, 0) : null;
    const weeklyKg = profile.goalType === "maintain" ? 0 : weight * rate.selected / 100;
    const signedWeeklyKg = profile.goalType === "loss" ? -weeklyKg : profile.goalType === "gain" ? weeklyKg : 0;
    const dailyAdjustment = signedWeeklyKg * KG_KCAL / 7;
    const targetCalories = Number.isFinite(maintenance) ? Math.max(1000, maintenance + dailyAdjustment) : null;

    let proteinG;
    let fatG;
    let carbsG;
    let macroRule;
    if (profile.macroMode === "manual") {
      const pPct = toNumber(profile.proteinPct, NaN);
      const fPct = toNumber(profile.fatPct, NaN);
      const cPct = toNumber(profile.carbPct, NaN);
      proteinG = Number.isFinite(targetCalories) && Number.isFinite(pPct) ? targetCalories * pPct / 100 / 4 : null;
      fatG = Number.isFinite(targetCalories) && Number.isFinite(fPct) ? targetCalories * fPct / 100 / 9 : null;
      carbsG = Number.isFinite(targetCalories) && Number.isFinite(cPct) ? targetCalories * cPct / 100 / 4 : null;
      macroRule = { mode: "manual", proteinPerKg: Number.isFinite(proteinG) ? proteinG / weight : null, fatPercent: fPct };
    } else {
      const auto = autoMacroRule(profile.goalType);
      proteinG = weight * auto.proteinPerKg;
      fatG = Number.isFinite(targetCalories) ? targetCalories * auto.fatPercent / 100 / 9 : null;
      carbsG = Number.isFinite(targetCalories) && Number.isFinite(fatG) ? Math.max(0, (targetCalories - proteinG * 4 - fatG * 9) / 4) : null;
      macroRule = { mode: "auto", ...auto };
    }

    const macroCalories = [proteinG * 4, fatG * 9, carbsG * 4].every(Number.isFinite)
      ? proteinG * 4 + fatG * 9 + carbsG * 4
      : null;
    const proteinPct = Number.isFinite(targetCalories) && targetCalories > 0 && Number.isFinite(proteinG) ? proteinG * 4 / targetCalories * 100 : null;
    const fatPct = Number.isFinite(targetCalories) && targetCalories > 0 && Number.isFinite(fatG) ? fatG * 9 / targetCalories * 100 : null;
    const carbsPct = Number.isFinite(targetCalories) && targetCalories > 0 && Number.isFinite(carbsG) ? carbsG * 4 / targetCalories * 100 : null;

    const heightM = toNumber(profile.heightCm, NaN) / 100;
    const bodyFat = toNumber(profile.bodyFat, NaN);
    const bmi = Number.isFinite(heightM) && heightM > 0 ? weight / heightM ** 2 : null;
    const ffmi = Number.isFinite(bodyFat) && bodyFat > 0 && bodyFat < 70 && Number.isFinite(heightM)
      ? weight * (1 - bodyFat / 100) / heightM ** 2
      : null;
    const estimatedWeeks = weeksToTarget(profile.goalType, weight, targetWeight, rate.selected);
    const estimatedDate = Number.isFinite(estimatedWeeks) ? addDays(parseDate(todayISO()), estimatedWeeks * 7) : null;

    return {
      weight,
      targetWeight,
      rate,
      rmr,
      baseMaintenance,
      maintenance,
      weeklyKg,
      signedWeeklyKg,
      dailyAdjustment,
      targetCalories,
      proteinG,
      fatG,
      carbsG,
      macroRule,
      macroCalories,
      proteinPct,
      fatPct,
      carbsPct,
      bmi,
      ffmi,
      estimatedWeeks,
      estimatedDate
    };
  }

  function emptyPlan(profile) {
    return {
      weight: null, targetWeight: null, rate: chooseRate(profile, 1, 1), rmr: { value: null, used: profile.formula, fallback: false },
      baseMaintenance: null, maintenance: null, weeklyKg: null, signedWeeklyKg: null, dailyAdjustment: null, targetCalories: null,
      proteinG: null, fatG: null, carbsG: null, macroRule: { mode: profile.macroMode }, macroCalories: null,
      proteinPct: null, fatPct: null, carbsPct: null, bmi: null, ffmi: null, estimatedDate: null
    };
  }

  function trendAtDate(date, trends = rollingTrend()) {
    const iso = toISODate(date);
    return [...trends].reverse().find(item => item.date <= iso)?.trend ?? null;
  }

  function expectedAtDate(profile, plan, date) {
    const startDate = parseDate(profile.planStartDate) || parseDate(sortedWeighIns()[0]?.date);
    const startWeight = toNumber(profile.planStartWeight, sortedWeighIns()[0]?.weight);
    if (!startDate || !Number.isFinite(startWeight)) return null;
    return projectWeight(profile, startWeight, startDate, plan.targetWeight, plan.rate.selected, date);
  }

  function bmiCategory(bmi) {
    if (!Number.isFinite(bmi)) return "sin cálculo";
    if (bmi < 18.5) return "bajo según referencia general";
    if (bmi < 25) return "dentro de referencia general";
    if (bmi < 30) return "por encima de referencia general";
    return "alto según referencia general";
  }

  function todayDiary() {
    return state.diary[todayISO()] || [];
  }

  function diaryTotals(entries = todayDiary()) {
    return entries.reduce((totals, item) => {
      totals.calories += toNumber(item.calories, 0);
      totals.protein += toNumber(item.protein, 0);
      totals.fat += toNumber(item.fat, 0);
      totals.carbs += toNumber(item.carbs, 0);
      return totals;
    }, { calories: 0, protein: 0, fat: 0, carbs: 0 });
  }

  function mealLabel(meal) {
    return ({ breakfast: "Desayuno", lunch: "Almuerzo", snack: "Merienda", dinner: "Cena", extras: "Snacks" })[meal] || "Comida";
  }

  function renderDiary(plan) {
    const entries = todayDiary();
    const totals = diaryTotals(entries);
    const target = Number.isFinite(plan.targetCalories) ? plan.targetCalories : 0;
    $("#diary-date-label").textContent = new Intl.DateTimeFormat("es-UY", { weekday: "long", day: "2-digit", month: "long" }).format(new Date());
    $("#diary-calories").textContent = formatNumber(Math.round(totals.calories));
    const remaining = target - totals.calories;
    $("#diary-remaining").textContent = target ? `${formatNumber(Math.abs(Math.round(remaining)))} kcal ${remaining >= 0 ? "disponibles" : "por encima"}` : "Sin objetivo calculado";

    setDiaryProgress("calorie", totals.calories, target, "kcal");
    setDiaryProgress("protein", totals.protein, plan.proteinG, "g");
    setDiaryProgress("fat", totals.fat, plan.fatG, "g");
    setDiaryProgress("carb", totals.carbs, plan.carbsG, "g");

    ["breakfast","lunch","snack","dinner","extras"].forEach(meal => {
      const container = document.querySelector(`[data-meal-items="${meal}"]`);
      const mealEntries = entries.filter(item => item.meal === meal);
      const total = mealEntries.reduce((sum, item) => sum + toNumber(item.calories, 0), 0);
      document.querySelector(`[data-meal-total="${meal}"]`).textContent = `${formatNumber(Math.round(total))} kcal`;
      container.innerHTML = "";
      if (!mealEntries.length) {
        container.innerHTML = '<p class="meal-empty">Todavía no cargaste nada.</p>';
        return;
      }
      mealEntries.forEach(item => {
        const row = document.createElement("div");
        row.className = "meal-item";
        row.innerHTML = `<div><b>${escapeHTML(item.name)}</b><small>${escapeHTML(item.serving || "1 porción")} · P ${formatNumber(item.protein,1)} · G ${formatNumber(item.fat,1)} · C ${formatNumber(item.carbs,1)}</small></div><span>${formatNumber(Math.round(item.calories))} kcal</span><button type="button" data-remove-diary="${item.id}" aria-label="Eliminar ${escapeHTML(item.name)}">×</button>`;
        container.appendChild(row);
      });
    });

    const completed = Boolean(state.completedDays?.[todayISO()]);
    $("#day-reading").hidden = !completed;
    $("#finish-day").textContent = completed ? "Día terminado ✓" : "Terminar día";
    $("#finish-day").classList.toggle("completed", completed);
    if (completed) renderDayProjection(plan, totals);
    if (activeDiaryView === "chart") drawCalorieChart(plan);
  }

  function setDiaryProgress(key, value, target, unit) {
    const safeTarget = Number.isFinite(target) ? target : 0;
    $(`#diary-${key}-progress`).textContent = `${formatNumber(Math.round(value))} / ${safeTarget ? formatNumber(Math.round(safeTarget)) : "—"} ${unit}`;
    $(`#diary-${key}-bar`).style.width = `${safeTarget ? clamp(value / safeTarget * 100, 0, 100) : 0}%`;
  }

  function renderDayProjection(plan, totals = diaryTotals()) {
    const weeks = toNumber($("#day-projection-weeks")?.value, 6);
    const current = latestWeighIn()?.weight;
    if (!Number.isFinite(current) || !Number.isFinite(plan.maintenance) || totals.calories <= 0) {
      $("#day-projection-title").textContent = "Completá el día para ver una proyección.";
      $("#day-projection-text").textContent = "La cuenta compara las calorías registradas con tu mantenimiento estimado. Es orientativa y no reemplaza la tendencia de pesajes.";
      return;
    }
    const dailyDelta = totals.calories - plan.maintenance;
    const projected = current + dailyDelta * weeks * 7 / KG_KCAL;
    const direction = projected < current ? "bajaría" : projected > current ? "subiría" : "se mantendría";
    $("#day-projection-title").textContent = `En ${weeks} semanas, el peso ${direction} hacia ${formatKg(projected,1)}.`;
    $("#day-projection-text").textContent = `Con ${formatNumber(Math.round(totals.calories))} kcal diarias frente a un mantenimiento estimado de ${formatNumber(Math.round(plan.maintenance))} kcal, la diferencia teórica sería ${dailyDelta > 0 ? "+" : ""}${formatNumber(Math.round(dailyDelta))} kcal por día. La adaptación del cuerpo y el registro incompleto pueden cambiar el resultado.`;
  }

  function finishDay() {
    state.completedDays = state.completedDays || {};
    state.completedDays[todayISO()] = true;
    saveState(state);
    $("#day-reading").hidden = false;
    renderDayProjection(calculatePlan(), diaryTotals());
    $("#day-reading").scrollIntoView({ behavior: "smooth", block: "center" });
    render();
  }

  function hideDaySummary() {
    state.completedDays = state.completedDays || {};
    delete state.completedDays[todayISO()];
    saveState(state);
    render();
  }

  function switchDiaryView(view) {
    activeDiaryView = view === "chart" ? "chart" : "record";
    $$('[data-diary-view]').forEach(button => button.classList.toggle("active", button.dataset.diaryView === activeDiaryView));
    $("#diary-record-view").hidden = activeDiaryView !== "record";
    $("#diary-chart-view").hidden = activeDiaryView !== "chart";
    if (activeDiaryView === "chart") requestAnimationFrame(() => drawCalorieChart(calculatePlan()));
  }

  function diaryTotalsForDate(date) {
    return diaryTotals(state.diary[date] || []);
  }

  function calorieChartDays() {
    const end = parseDate(todayISO());
    const days = [];
    for (let offset = calorieRange - 1; offset >= 0; offset -= 1) {
      const date = addDays(end, -offset);
      const iso = toISODate(date);
      const totals = diaryTotalsForDate(iso);
      days.push({ date, iso, calories: totals.calories, hasEntries: (state.diary[iso] || []).length > 0 });
    }
    return days;
  }

  function drawCalorieChart(plan = calculatePlan()) {
    const canvas = $("#calorie-chart");
    if (!canvas || $("#diary-chart-view").hidden) return;
    const prepared = prepareCanvas(canvas);
    if (!prepared) return;
    const { ctx, width, height } = prepared;
    ctx.clearRect(0, 0, width, height);
    const days = calorieChartDays();
    const target = Number.isFinite(plan.targetCalories) ? plan.targetCalories : 0;
    const maxValue = Math.max(target, ...days.map(day => day.calories), 500) * 1.12;
    const margin = { left: 48, right: 16, top: 25, bottom: 46 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const slot = plotWidth / Math.max(1, days.length);
    const barWidth = Math.max(5, Math.min(34, slot * .62));
    const y = value => margin.top + (maxValue - value) / maxValue * plotHeight;

    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i += 1) {
      const value = maxValue * i / 4;
      const py = y(value);
      ctx.strokeStyle = "rgba(23,26,33,.12)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(margin.left, py); ctx.lineTo(width - margin.right, py); ctx.stroke();
      ctx.fillStyle = "rgba(23,26,33,.55)";
      ctx.fillText(formatNumber(value, 0), margin.left - 7, py);
    }

    if (target) {
      ctx.save();
      ctx.strokeStyle = "#171a21";
      ctx.lineWidth = 2;
      ctx.setLineDash([7,5]);
      ctx.beginPath(); ctx.moveTo(margin.left, y(target)); ctx.lineTo(width - margin.right, y(target)); ctx.stroke();
      ctx.restore();
    }

    days.forEach((day, index) => {
      const x = margin.left + slot * index + slot / 2;
      const top = y(day.calories);
      const bottom = y(0);
      ctx.fillStyle = day.hasEntries ? "#8d7cff" : "rgba(23,26,33,.08)";
      ctx.fillRect(x - barWidth / 2, top, barWidth, Math.max(1, bottom - top));
      if (day.hasEntries) {
        ctx.fillStyle = "#171a21";
        ctx.font = "9px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(formatNumber(day.calories, 0), x, Math.max(12, top - 5));
      }
      const showLabel = calorieRange <= 14 || index % Math.ceil(calorieRange / 10) === 0 || index === days.length - 1;
      if (showLabel) {
        ctx.fillStyle = "rgba(23,26,33,.62)";
        ctx.textBaseline = "top";
        ctx.fillText(new Intl.DateTimeFormat("es-UY", { day: "2-digit", month: "2-digit" }).format(day.date), x, height - margin.bottom + 11);
      }
    });

    const logged = days.filter(day => day.hasEntries);
    $("#calorie-chart-empty").hidden = logged.length > 0;
    if (!logged.length || !target) {
      $("#calorie-chart-summary").textContent = "Todavía no hay días completos para comparar.";
      return;
    }
    const average = logged.reduce((sum, day) => sum + day.calories, 0) / logged.length;
    const diff = average - target;
    $("#calorie-chart-summary").textContent = `Promedio registrado: ${formatNumber(Math.round(average))} kcal · ${formatNumber(Math.abs(Math.round(diff)))} kcal ${diff > 0 ? "por encima" : "por debajo"} del objetivo.`;
  }

  function switchAppView(view, scroll = true) {
    activeAppView = view === "progress" ? "progress" : "today";
    $$('[data-app-view]').forEach(button => button.classList.toggle("active", button.dataset.appView === activeAppView));
    $("#today-view").hidden = activeAppView !== "today";
    $("#progress-view").hidden = activeAppView !== "progress";
    if (activeAppView === "progress" && chartPayload) requestAnimationFrame(() => drawWeightChart($("#weight-chart"), chartPayload));
    if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openMealPicker() {
    $("#meal-picker-modal").hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeMealPicker() {
    $("#meal-picker-modal").hidden = true;
    if ($("#food-modal").hidden && $("#settings-modal").hidden) document.body.classList.remove("modal-open");
  }

  function pickMeal(meal) {
    closeMealPicker();
    openFoodModal(meal);
  }

  function showWeightEditor(mode = "today") {
    weightEditorForced = true;
    $("#quick-weight-form").hidden = false;
    $("#today-weight-recorded").hidden = true;
    const isPrevious = mode === "previous";
    $("#alternate-date-wrap").hidden = !isPrevious;
    $("#toggle-date").textContent = isPrevious ? "Usar la fecha de hoy" : "El pesaje es de otro día";
    if (isPrevious) {
      $("#quick-weight").value = "";
      $("#quick-date").value = displayDate(toISODate(addDays(parseDate(todayISO()), -1)));
    } else {
      const todayEntry = state.weighIns.find(item => item.date === todayISO());
      $("#quick-weight").value = todayEntry?.weight || "";
      $("#quick-date").value = displayDate(todayISO());
    }
    setTimeout(() => $("#quick-weight").focus(), 50);
  }

  function updateWeightEntryState() {
    const todayEntry = state.weighIns.find(item => item.date === todayISO());
    const recorded = Boolean(todayEntry);
    $("#today-weight-recorded").hidden = !recorded || weightEditorForced;
    $("#quick-weight-form").hidden = recorded && !weightEditorForced;
    $("#toggle-date").hidden = recorded && !weightEditorForced;
    if (recorded) $("#today-weight-value").textContent = formatKg(todayEntry.weight);
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
  }

  function openFoodModal(meal) {
    activeMeal = meal;
    activeFoodMode = "food";
    $("#food-meal-label").textContent = `Agregar en ${mealLabel(meal)}`;
    $("#food-modal").hidden = false;
    document.body.classList.add("modal-open");
    switchFoodMode("food");
    $("#food-search-input").value = "";
    renderFoodResults();
  }

  function closeFoodModal() {
    $("#food-modal").hidden = true;
    if ($("#food-editor-modal").hidden && $("#recipe-modal").hidden && $("#settings-modal").hidden && $("#meal-picker-modal").hidden) document.body.classList.remove("modal-open");
  }

  function switchFoodMode(mode) {
    activeFoodMode = ["food","quick","recipe"].includes(mode) ? mode : "food";
    $$("[data-food-mode]").forEach(button => button.classList.toggle("active", button.dataset.foodMode === activeFoodMode));
    ["food","quick","recipe"].forEach(name => { $(`#food-mode-${name}`).hidden = name !== activeFoodMode; });
    if (activeFoodMode === "food") renderFoodResults();
    if (activeFoodMode === "recipe") renderRecipeResults();
  }

  function libraryFoods() {
    return [...state.foods, ...state.recipes].sort((a,b) => {
      const useDiff = toNumber(b.uses,0) - toNumber(a.uses,0);
      if (useDiff) return useDiff;
      return String(b.lastUsed || "").localeCompare(String(a.lastUsed || ""));
    });
  }

  function renderFoodResults() {
    const query = normalizeHeader($("#food-search-input")?.value || "");
    const container = $("#food-results");
    container.innerHTML = "";
    const all = libraryFoods().filter(item => !query || normalizeHeader(item.name).includes(query));
    if (!all.length) {
      container.innerHTML = '<p class="empty-message">No hay coincidencias. Podés crear un alimento propio o una receta.</p>';
      return;
    }
    const frequent = all.filter(item => item.uses > 1).slice(0,6);
    const recent = all.filter(item => item.lastUsed).sort((a,b) => String(b.lastUsed).localeCompare(String(a.lastUsed))).slice(0,6);
    const selected = query ? all.slice(0,20) : [...new Map([...recent,...frequent,...all].map(item => [item.id,item])).values()].slice(0,18);
    if (!query && recent.length) container.insertAdjacentHTML("beforeend", '<p class="food-section-label">Recientes y frecuentes</p>');
    selected.forEach(item => container.appendChild(foodResultButton(item)));
  }

  function renderRecipeResults() {
    const container = $("#recipe-results");
    container.innerHTML = "";
    if (!state.recipes.length) {
      container.innerHTML = '<p class="empty-message">Todavía no guardaste recetas.</p>';
      return;
    }
    state.recipes.forEach(item => container.appendChild(foodResultButton(item)));
  }

  function foodResultButton(item) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "food-result";
    button.dataset.addFood = item.id;
    button.dataset.foodKind = item.kind;
    button.innerHTML = `<div><b>${escapeHTML(item.name)}</b><small>${escapeHTML(item.serving)} · P ${formatNumber(item.protein,1)} · G ${formatNumber(item.fat,1)} · C ${formatNumber(item.carbs,1)}</small></div><span>${formatNumber(Math.round(item.calories))} kcal</span>`;
    return button;
  }

  function addLibraryFood(id, kind) {
    const collection = kind === "recipe" ? state.recipes : state.foods;
    const item = collection.find(entry => entry.id === id) || libraryFoods().find(entry => entry.id === id);
    if (!item) return;
    const entry = normalizeDiaryEntry({ ...item, id: createId(), sourceId: item.id, meal: activeMeal });
    state.diary[todayISO()] = [...todayDiary(), entry];
    item.uses = toNumber(item.uses,0) + 1;
    item.lastUsed = todayISO();
    saveState(state);
    closeFoodModal();
    render();
  }

  function addQuickCalories(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const item = normalizeDiaryEntry({
      id: createId(),
      name: form.elements.name.value,
      calories: form.elements.calories.value,
      protein: 0, fat: 0, carbs: 0,
      serving: "carga libre",
      meal: activeMeal
    });
    if (!item) return;
    state.diary[todayISO()] = [...todayDiary(), item];
    saveState(state);
    form.reset();
    closeFoodModal();
    render();
  }

  function openFoodEditor() {
    $("#food-editor-form").reset();
    $("#food-editor-modal").hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeFoodEditor() {
    $("#food-editor-modal").hidden = true;
    if ($("#food-modal").hidden && $("#recipe-modal").hidden && $("#settings-modal").hidden) document.body.classList.remove("modal-open");
  }

  function saveCustomFood(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const item = normalizeFood({
      id: createId(), kind: "food", name: form.elements.name.value,
      calories: form.elements.calories.value, serving: form.elements.serving.value,
      protein: form.elements.protein.value, fat: form.elements.fat.value, carbs: form.elements.carbs.value
    });
    if (!item) return;
    state.foods.push(item);
    saveState(state);
    closeFoodEditor();
    if (!$("#food-modal").hidden) addLibraryFood(item.id, "food");
    else render();
  }

  function openRecipeEditor() {
    $("#recipe-form").reset();
    $("#recipe-modal").hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeRecipeEditor() {
    $("#recipe-modal").hidden = true;
    if ($("#food-modal").hidden && $("#food-editor-modal").hidden && $("#settings-modal").hidden) document.body.classList.remove("modal-open");
  }

  function saveRecipe(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const item = normalizeFood({
      id: createId(), kind: "recipe", name: form.elements.name.value,
      calories: form.elements.calories.value, serving: form.elements.serving.value,
      protein: form.elements.protein.value, fat: form.elements.fat.value, carbs: form.elements.carbs.value
    });
    if (!item) return;
    state.recipes.push(item);
    saveState(state);
    closeRecipeEditor();
    renderFoodResults();
    renderRecipeResults();
  }

  function removeDiaryEntry(event) {
    const button = event.target.closest("[data-remove-diary]");
    if (!button) return;
    state.diary[todayISO()] = todayDiary().filter(item => item.id !== button.dataset.removeDiary);
    saveState(state);
    render();
  }

  function maybeOpenDailyCheckin() {
    if (!state.configured || state.lastCheckinDate === todayISO()) return;
    const alreadyWeighed = state.weighIns.some(item => item.date === todayISO());
    if (alreadyWeighed) {
      state.lastCheckinDate = todayISO();
      saveState(state);
      return;
    }
    $("#daily-checkin-modal").hidden = false;
    document.body.classList.add("modal-open");
  }

  function finishDailyCheckin(weight = null) {
    if (Number.isFinite(weight) && weight > 0) state.weighIns = mergeWeighIns(state.weighIns, [{ date: todayISO(), weight }]);
    state.lastCheckinDate = todayISO();
    saveState(state);
    $("#daily-checkin-modal").hidden = true;
    document.body.classList.remove("modal-open");
    render();
  }

  function submitDailyCheckin(event) {
    event.preventDefault();
    const weight = toNumber(event.currentTarget.elements.weight.value, NaN);
    if (!Number.isFinite(weight) || weight <= 0) {
      event.currentTarget.elements.weight.focus();
      return;
    }
    finishDailyCheckin(weight);
  }

  function syncNativeDatePickers() {
    const form = $("#profile-form");
    $$("[data-native-date]").forEach(picker => {
      const name = picker.dataset.nativeDate;
      const value = normalizeDate(form.elements[name]?.value);
      picker.value = value || "";
      picker.max = name === "birthDate" ? todayISO() : "";
      picker.min = name === "goalDate" ? toISODate(addDays(parseDate(todayISO()),1)) : "";
    });
  }

  function openCalendar(name) {
    const picker = document.querySelector(`[data-native-date="${name}"]`);
    if (!picker) return;
    syncNativeDatePickers();
    if (typeof picker.showPicker === "function") picker.showPicker();
    else picker.click();
  }

  function applyNativeDate(event) {
    const picker = event.target.closest("[data-native-date]");
    if (!picker || !picker.value) return;
    const field = $("#profile-form").elements[picker.dataset.nativeDate];
    field.value = displayDate(picker.value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function render() {
    const configured = state.configured && profileIsComplete(state.profile, state.weighIns);
    $("#empty-state").hidden = configured;
    $("#dashboard").hidden = !configured;
    if (!configured) return;

    const profile = state.profile;
    const weighIns = sortedWeighIns();
    const trends = rollingTrend(weighIns, profile.trendWindow);
    const first = weighIns[0];
    const latest = weighIns.at(-1);
    const latestTrend = trends.at(-1)?.trend;
    const observedWeekly = regressionRatePerWeek(weighIns);
    const plan = calculatePlan(profile, weighIns);
    const person = profile.name ? profile.name.trim() : "";
    const hasCalories = Number.isFinite(plan.targetCalories);
    const hasMaintenance = Number.isFinite(plan.maintenance);

    $("#daily-eyebrow").textContent = person ? `OBJETIVOS DIARIOS DE ${person.toUpperCase()}` : "OBJETIVOS DIARIOS";
    $("#daily-title").textContent = person ? `${person}, estos son tus objetivos de hoy.` : "Tus números de hoy.";
    $("#target-calories").textContent = hasCalories ? formatNumber(Math.round(plan.targetCalories)) : "—";
    $("#maintenance-calories").textContent = hasMaintenance ? `${formatNumber(Math.round(plan.maintenance))} kcal` : "—";
    $("#calorie-adjustment").textContent = Number.isFinite(plan.dailyAdjustment) ? `${plan.dailyAdjustment > 0 ? "+" : ""}${formatNumber(Math.round(plan.dailyAdjustment))} kcal` : "—";
    $("#formula-name").textContent = plan.rmr.fallback ? "Mifflin (respaldo)" : (FORMULA_LABELS[plan.rmr.used] || "—");
    $("#activity-name").textContent = ACTIVITY_LABELS[String(profile.activityFactor)] || formatNumber(profile.activityFactor, 2);

    $("#protein-grams").textContent = Number.isFinite(plan.proteinG) ? `${formatNumber(Math.round(plan.proteinG))} g` : "—";
    $("#fat-grams").textContent = Number.isFinite(plan.fatG) ? `${formatNumber(Math.round(plan.fatG))} g` : "—";
    $("#carb-grams").textContent = Number.isFinite(plan.carbsG) ? `${formatNumber(Math.round(plan.carbsG))} g` : "—";
    $("#protein-detail").textContent = profile.macroMode === "auto"
      ? `${formatNumber(plan.macroRule.proteinPerKg, 1)} g/kg · ${formatNumber(plan.proteinPct, 0)}%`
      : `${formatNumber(plan.proteinPct, 0)}% de las calorías`;
    $("#fat-detail").textContent = `${formatNumber(plan.fatPct, 0)}% de las calorías`;
    $("#carb-detail").textContent = `${formatNumber(plan.carbsPct, 0)}% de las calorías`;
    $("#protein-bar").style.setProperty("--macro-width", `${clamp(plan.proteinPct || 0, 0, 100)}%`);
    $("#fat-bar").style.setProperty("--macro-width", `${clamp(plan.fatPct || 0, 0, 100)}%`);
    $("#carb-bar").style.setProperty("--macro-width", `${clamp(plan.carbsPct || 0, 0, 100)}%`);

    const macroNote = $("#macro-balance-note");
    macroNote.className = "inline-note";
    macroNote.textContent = profile.macroMode === "manual"
      ? `Distribución personalizada: ${formatNumber(plan.proteinPct,0)}% proteína, ${formatNumber(plan.fatPct,0)}% grasas y ${formatNumber(plan.carbsPct,0)}% carbohidratos.`
      : "Distribución automática: proteína según peso, grasas moderadas y carbohidratos con las calorías restantes.";

    $("#current-weight").textContent = formatKg(latest?.weight);
    $("#trend-weight").textContent = formatKg(latestTrend, 2);
    $("#observed-rate").textContent = Number.isFinite(observedWeekly) ? `${observedWeekly > 0 ? "+" : ""}${formatNumber(observedWeekly, 2)} kg/sem` : "Faltan datos";
    $("#current-body-fat").textContent = Number.isFinite(toNumber(profile.bodyFat, NaN)) ? `${formatNumber(profile.bodyFat,1)}%` : "Sin dato";
    $("#weight-context").textContent = latest
      ? `Último registro: ${formatDate(latest.date)}. La tendencia actual está en ${formatKg(latestTrend, 2)}.`
      : "El peso diario puede moverse mucho. La línea de tendencia es la que importa.";
    updateWeightEntryState();

    renderDiary(plan);
    renderPlanStrip(profile, plan);
    renderInsight(profile, plan, weighIns, trends, observedWeekly);
    renderRecalibration(profile, plan, weighIns, trends);
    renderProjection(profile, plan, trends, observedWeekly);
    renderCharts(profile, plan, weighIns, trends, observedWeekly);
    renderHistory(trends);

    $("#stat-change").textContent = first && latest ? formatSignedKg(latest.weight - first.weight) : "—";
    $("#stat-bmi").textContent = formatNumber(plan.bmi, 1);
    $("#stat-bmi-note").textContent = bmiCategory(plan.bmi);
    $("#stat-body-fat").textContent = Number.isFinite(toNumber(profile.bodyFat, NaN)) ? `${formatNumber(profile.bodyFat,1)}%` : "Sin dato";
    $("#stat-ffmi").textContent = formatNumber(plan.ffmi, 1);
    $("#plan-start").textContent = formatDate(profile.planStartDate || first?.date);
    $("#plan-start-weight").textContent = formatKg(toNumber(profile.planStartWeight, first?.weight));
    $("#quick-date").value = displayDate(todayISO());
  }

  function renderPlanStrip(profile, plan) {
    const action = profile.goalType === "loss" ? "Bajar" : profile.goalType === "gain" ? "Subir" : "Mantener";
    $("#plan-kicker").textContent = profile.name ? `PLAN DE ${profile.name.toUpperCase()}` : "PLAN ACTUAL";
    $("#plan-title").textContent = profile.goalType === "maintain"
      ? `Mantener la tendencia cerca de ${formatKg(plan.weight)}.`
      : `${action} con un ritmo de ${formatNumber(plan.rate.selected, 2)}% semanal.`;
    $("#plan-description").textContent = profile.goalDate && Number.isFinite(plan.rate.required)
      ? `La fecha elegida requiere ${formatNumber(plan.rate.required, 2)}% semanal. La app calcula con ${formatNumber(plan.rate.selected, 2)}%.`
      : "El objetivo define la dirección; la tendencia real indica cuándo conviene corregir la estimación.";
    $("#target-weight").textContent = profile.goalType === "maintain" ? "Mantener" : formatKg(plan.targetWeight);
    $("#target-date").textContent = profile.goalDate ? formatDate(profile.goalDate) : "Sin fecha fija";
    $("#estimated-date").textContent = plan.estimatedDate ? formatDate(plan.estimatedDate) : "—";
    $("#required-rate").textContent = `${formatNumber(plan.rate.selected, 2)} %/sem`;

    const signal = $("#goal-status");
    signal.className = "signal";
    let guidance;
    if (profile.goalType === "maintain") {
      signal.textContent = "MANTENIMIENTO";
      guidance = "En mantenimiento importa la banda de varias semanas, no que cada día repita exactamente el mismo peso.";
    } else if (plan.rate.selected > plan.rate.bounds.suggestedMax) {
      signal.textContent = "RITMO ALTO";
      signal.classList.add("alert");
      guidance = `El ritmo manual supera el máximo de referencia de ${formatNumber(plan.rate.bounds.suggestedMax, 2)}% semanal usado por la herramienta.`;
    } else if (plan.rate.capped) {
      signal.textContent = "FECHA EXIGENTE";
      signal.classList.add("warn");
      guidance = `La fecha exige ${formatNumber(plan.rate.required, 2)}% semanal. El cálculo se limita a ${formatNumber(plan.rate.bounds.suggestedMax, 2)}% y estima una llegada posterior.`;
    } else if (plan.rate.selected < plan.rate.bounds.suggestedMin) {
      signal.textContent = "RITMO SUAVE";
      guidance = "El ritmo está por debajo del rango habitual. Puede ser más lento, pero también más fácil de sostener.";
    } else {
      signal.textContent = "RANGO HABITUAL";
      guidance = `El ritmo está dentro de ${formatNumber(plan.rate.bounds.suggestedMin, 2)}–${formatNumber(plan.rate.bounds.suggestedMax, 2)}% semanal.`;
    }
    if (plan.rmr.fallback) guidance += " Cunningham no pudo usarse y se aplicó Mifflin–St Jeor.";
    if (Math.abs(toNumber(profile.calibrationOffset, 0)) >= 1) guidance += ` La estimación incluye una calibración de ${profile.calibrationOffset > 0 ? "+" : ""}${formatNumber(profile.calibrationOffset, 0)} kcal basada en el progreso previo.`;
    $("#goal-guidance").textContent = guidance;
  }

  function renderInsight(profile, plan, weighIns, trends, observedWeekly) {
    const namePrefix = profile.name ? `${profile.name}, ` : "";
    const latest = weighIns.at(-1);
    const latestTrend = trends.at(-1)?.trend;
    const expectedToday = expectedAtDate(profile, plan, parseDate(latest?.date || todayISO()));
    const difference = Number.isFinite(latestTrend) && Number.isFinite(expectedToday) ? latestTrend - expectedToday : null;
    $("#expected-today").textContent = formatKg(expectedToday, 2);
    $("#expected-difference").textContent = formatSignedKg(difference);

    let title = profile.name ? `${profile.name}, todavía faltan datos.` : "Todavía faltan datos.";
    let text = "Con algunos pesajes más se puede separar una variación puntual de una dirección sostenida.";
    if (Number.isFinite(observedWeekly) && weighIns.length >= 5) {
      const desired = plan.signedWeeklyKg;
      const correctDirection = profile.goalType === "maintain"
        ? Math.abs(observedWeekly) < 0.15
        : Math.sign(observedWeekly) === Math.sign(desired);
      const ratio = Math.abs(desired) > 0.02 ? Math.abs(observedWeekly) / Math.abs(desired) : null;

      if (profile.goalType === "maintain") {
        if (Math.abs(observedWeekly) < 0.15) {
          title = profile.name ? `Estable, ${profile.name}.` : "Tendencia estable.";
          text = `El ritmo reciente es ${observedWeekly > 0 ? "+" : ""}${formatNumber(observedWeekly, 2)} kg por semana, suficientemente cerca de una banda de mantenimiento.`;
        } else {
          title = profile.name ? `${profile.name}, salís del mantenimiento.` : "Fuera del mantenimiento.";
          text = `La tendencia reciente cambia ${observedWeekly > 0 ? "+" : ""}${formatNumber(observedWeekly, 2)} kg por semana. Conviene observar si se sostiene antes de corregir calorías.`;
        }
      } else if (!correctDirection) {
        title = profile.name ? `${profile.name}, el rumbo se invirtió.` : "Rumbo contrario al objetivo.";
        text = `El ritmo observado es ${observedWeekly > 0 ? "+" : ""}${formatNumber(observedWeekly, 2)} kg por semana. Unos días pueden engañar; varias semanas en la misma dirección justifican revisar adherencia o cálculo.`;
      } else if (ratio < 0.65) {
        title = profile.name ? `${profile.name}, vas más lento que el plan.` : "Más lento que el plan.";
        text = `La tendencia marca ${formatNumber(Math.abs(observedWeekly), 2)} kg por semana frente a ${formatNumber(Math.abs(desired), 2)} kg previstos. Si la diferencia se mantiene, MASA puede recalibrar la estimación.`;
      } else if (ratio > 1.4) {
        title = profile.name ? `${profile.name}, vas más rápido que el plan.` : "Más rápido que el plan.";
        text = `El ritmo observado es ${formatNumber(Math.abs(observedWeekly), 2)} kg por semana frente a ${formatNumber(Math.abs(desired), 2)} kg previstos. Revisá energía, rendimiento y sostenibilidad antes de buscar todavía más velocidad.`;
      } else {
        title = profile.name ? `Bien alineado, ${profile.name}.` : "Bien alineado con el plan.";
        text = `El ritmo observado es ${formatNumber(Math.abs(observedWeekly), 2)} kg por semana y el previsto es ${formatNumber(Math.abs(desired), 2)} kg. La diferencia entra dentro del ruido esperable del peso diario.`;
      }

      if (Number.isFinite(difference) && Math.abs(difference) >= 0.5) {
        text += ` Hoy la tendencia está ${formatNumber(Math.abs(difference), 2)} kg ${difference > 0 ? "por encima" : "por debajo"} de la proyección original.`;
      }
    }

    $("#chart-insight-title").textContent = title;
    $("#chart-insight").textContent = text;
    $("#chart-insight-meta").textContent = `${weighIns.length} pesajes entre ${formatDate(weighIns[0]?.date)} y ${formatDate(latest?.date)} · tendencia de ${state.profile.trendWindow} pesajes válidos`;
  }

  function buildRecalibrationSuggestion(profile, plan, weighIns, trends) {
    const startDate = parseDate(profile.planStartDate);
    const startWeight = toNumber(profile.planStartWeight, NaN);
    const latest = weighIns.at(-1);
    const latestTrend = trends.at(-1)?.trend;
    if (!startDate || !latest || !Number.isFinite(startWeight) || !Number.isFinite(latestTrend)) return null;
    const relevant = weighIns.filter(item => parseDate(item.date) >= startDate);
    const elapsed = daysBetween(startDate, parseDate(latest.date));
    if (elapsed < 18 || relevant.length < 8) return null;
    const expected = projectWeight(profile, startWeight, startDate, plan.targetWeight, plan.rate.selected, parseDate(latest.date));
    const deviation = latestTrend - expected;
    const threshold = Math.max(0.7, startWeight * 0.009);
    if (!Number.isFinite(deviation) || Math.abs(deviation) < threshold) return null;
    const observedWeekly = regressionRatePerWeek(relevant, 28);
    if (!Number.isFinite(observedWeekly) || !Number.isFinite(plan.targetCalories) || !Number.isFinite(plan.baseMaintenance)) return null;
    const estimatedMaintenance = plan.targetCalories - observedWeekly * KG_KCAL / 7;
    const newOffset = clamp(Math.round(estimatedMaintenance - plan.baseMaintenance), -900, 900);
    const change = newOffset - toNumber(profile.calibrationOffset, 0);
    if (Math.abs(change) < 70) return null;
    return { deviation, expected, latestTrend, observedWeekly, estimatedMaintenance, newOffset, change, latest };
  }

  function renderRecalibration(profile, plan, weighIns, trends) {
    recalibrationSuggestion = buildRecalibrationSuggestion(profile, plan, weighIns, trends);
    const panel = $("#recalibration-panel");
    panel.hidden = !recalibrationSuggestion;
    if (!recalibrationSuggestion) return;
    const suggestion = recalibrationSuggestion;
    const direction = suggestion.deviation > 0 ? "por encima" : "por debajo";
    $("#recalibration-title").textContent = `${profile.name ? `${profile.name}, la` : "La"} tendencia ya permite revisar la estimación.`;
    $("#recalibration-text").textContent = `La tendencia está ${formatNumber(Math.abs(suggestion.deviation), 2)} kg ${direction} del plan. Si tu ingesta estuvo cerca del objetivo, el mantenimiento observado sería aproximadamente ${formatNumber(Math.round(suggestion.estimatedMaintenance))} kcal, un ajuste de ${suggestion.change > 0 ? "+" : ""}${formatNumber(suggestion.change)} kcal sobre la calibración actual.`;
  }

  function applyRecalibration() {
    if (!recalibrationSuggestion) return;
    state.profile.calibrationOffset = recalibrationSuggestion.newOffset;
    state.profile.planStartDate = recalibrationSuggestion.latest.date;
    state.profile.planStartWeight = Number(recalibrationSuggestion.latestTrend.toFixed(2));
    saveState(state);
    render();
  }

  function renderProjection(profile, plan, trends, observedWeekly) {
    const tbody = $("#projection-body");
    tbody.innerHTML = "";
    const today = parseDate(todayISO());
    const planStart = parseDate(profile.planStartDate) || parseDate(sortedWeighIns()[0]?.date) || today;
    const startWeight = toNumber(profile.planStartWeight, sortedWeighIns()[0]?.weight || plan.weight);
    const latest = latestWeighIn();
    const latestTrend = trends.at(-1)?.trend;
    const requestedEnd = parseDate(profile.goalDate);
    const estimatedEnd = plan.estimatedDate;
    let endDate = requestedEnd && estimatedEnd ? (requestedEnd > estimatedEnd ? requestedEnd : estimatedEnd) : requestedEnd || estimatedEnd || addMonths(today, 8);
    if (endDate < today) endDate = today;
    const maxEnd = addMonths(today, 36);
    if (endDate > maxEnd) endDate = maxEnd;
    $("#projection-until").textContent = `La tabla llega hasta ${formatDate(endDate)}, tomando la fecha objetivo o la fecha estimada más lejana.`;

    let cursor = endOfMonth(new Date(planStart.getFullYear(), planStart.getMonth(), 1));
    const endMonth = endOfMonth(endDate);
    let rows = 0;
    while (cursor <= endMonth && rows < 40) {
      const planned = projectWeight(profile, startWeight, planStart, plan.targetWeight, plan.rate.selected, cursor);
      const isCurrentMonth = cursor.getMonth() === today.getMonth() && cursor.getFullYear() === today.getFullYear();
      const actual = cursor <= today ? trendAtDate(cursor, trends) : (isCurrentMonth ? latestTrend : null);
      let currentPath = null;
      if (Number.isFinite(observedWeekly) && Number.isFinite(latestTrend) && latest) {
        const weeks = daysBetween(parseDate(latest.date), cursor) / 7;
        currentPath = latestTrend + observedWeekly * weeks;
      }
      const tr = document.createElement("tr");
      if (isCurrentMonth) tr.classList.add("current-month");
      tr.innerHTML = `
        <td>${formatMonth(cursor)}</td>
        <td>${formatKg(planned, 1)}</td>
        <td>${Number.isFinite(actual) ? formatKg(actual, 1) : "—"}</td>
        <td>${Number.isFinite(currentPath) ? formatKg(currentPath, 1) : "—"}</td>`;
      tbody.appendChild(tr);
      cursor = endOfMonth(addMonths(cursor, 1));
      rows += 1;
    }
  }

  function renderCharts(profile, plan, weighIns, trends, observedWeekly) {
    const planProjection = [];
    const currentProjection = [];
    const planStart = parseDate(profile.planStartDate) || parseDate(weighIns[0]?.date);
    const planStartWeight = toNumber(profile.planStartWeight, weighIns[0]?.weight);
    if (planStart && Number.isFinite(planStartWeight)) {
      const weeks = Math.min(104, Math.max(26, Math.ceil(plan.estimatedWeeks || 52)));
      for (let week = 0; week <= weeks; week += 1) {
        const date = addDays(planStart, week * 7);
        const weight = projectWeight(profile, planStartWeight, planStart, plan.targetWeight, plan.rate.selected, date);
        planProjection.push({ date: toISODate(date), weight });
        if (Number.isFinite(plan.targetWeight) && Math.abs(weight - plan.targetWeight) < 0.03 && date > new Date()) break;
      }
    }

    const latest = latestWeighIn(weighIns);
    const latestTrend = trends.at(-1)?.trend;
    if (latest && Number.isFinite(latestTrend) && Number.isFinite(observedWeekly)) {
      for (let week = 0; week <= 52; week += 1) {
        const date = addDays(parseDate(latest.date), week * 7);
        currentProjection.push({ date: toISODate(date), weight: clamp(latestTrend + observedWeekly * week, 20, 400) });
      }
    }

    chartPayload = { profile, plan, weighIns, trends, planProjection, currentProjection };
    drawWeightChart($("#weight-chart"), chartPayload);
    $("#weight-chart-empty").hidden = weighIns.length >= 2;
  }

  function visibleChartPoints(payload) {
    const latest = parseDate(payload.weighIns.at(-1)?.date) || new Date();
    let start = null;
    let end = null;
    if (chartRange !== "all") {
      const months = { "1m": 1, "3m": 3, "6m": 6 }[chartRange] || 3;
      start = addMonths(latest, -months);
      end = addMonths(latest, months);
    }
    const within = item => {
      const date = parseDate(item.date);
      return date && (!start || date >= start) && (!end || date <= end);
    };
    return {
      weighIns: payload.weighIns.filter(within),
      trends: payload.trends.filter(within),
      planProjection: payload.planProjection.filter(within),
      currentProjection: payload.currentProjection.filter(within),
      start,
      end
    };
  }

  function prepareCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { ctx, width: rect.width, height: rect.height };
  }

  function drawWeightChart(canvas, payload) {
    const prepared = prepareCanvas(canvas);
    if (!prepared) return;
    const { ctx, width, height } = prepared;
    ctx.clearRect(0, 0, width, height);
    const visible = visibleChartPoints(payload);
    const series = [
      ...visible.weighIns.map(item => ({ date: parseDate(item.date), value: item.weight })),
      ...visible.planProjection.map(item => ({ date: parseDate(item.date), value: item.weight })),
      ...visible.currentProjection.map(item => ({ date: parseDate(item.date), value: item.weight }))
    ].filter(item => item.date && Number.isFinite(item.value));
    if (series.length < 2) return;

    const margin = { left: 48, right: 18, top: 22, bottom: 36 };
    let minDate = Math.min(...series.map(item => item.date.getTime()));
    let maxDate = Math.max(...series.map(item => item.date.getTime()));
    if (visible.start) minDate = visible.start.getTime();
    if (visible.end) maxDate = visible.end.getTime();
    let minY = Math.min(...series.map(item => item.value));
    let maxY = Math.max(...series.map(item => item.value));
    if (Number.isFinite(payload.plan.targetWeight)) {
      minY = Math.min(minY, payload.plan.targetWeight);
      maxY = Math.max(maxY, payload.plan.targetWeight);
    }
    const padY = Math.max(0.7, (maxY - minY) * 0.14);
    minY -= padY;
    maxY += padY;
    const x = date => margin.left + (date.getTime() - minDate) / Math.max(1, maxDate - minDate) * (width - margin.left - margin.right);
    const y = value => margin.top + (maxY - value) / Math.max(0.1, maxY - minY) * (height - margin.top - margin.bottom);

    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i += 1) {
      const value = minY + (maxY - minY) * i / 4;
      const py = y(value);
      ctx.strokeStyle = "rgba(242,239,230,.12)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(margin.left, py); ctx.lineTo(width - margin.right, py); ctx.stroke();
      ctx.fillStyle = "rgba(242,239,230,.55)";
      ctx.fillText(formatNumber(value, 1), margin.left - 8, py);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i <= 5; i += 1) {
      const timestamp = minDate + (maxDate - minDate) * i / 5;
      const date = new Date(timestamp);
      ctx.fillStyle = "rgba(242,239,230,.48)";
      ctx.fillText(new Intl.DateTimeFormat("es-UY", { month: "short", year: chartRange === "all" ? "2-digit" : undefined }).format(date), x(date), height - margin.bottom + 11);
    }

    if (Number.isFinite(payload.plan.targetWeight)) {
      ctx.strokeStyle = "rgba(141,124,255,.82)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(margin.left, y(payload.plan.targetWeight)); ctx.lineTo(width - margin.right, y(payload.plan.targetWeight)); ctx.stroke();
      ctx.setLineDash([]);
    }

    drawLine(ctx, visible.weighIns.map(item => ({ date: parseDate(item.date), value: item.weight })), x, y, "rgba(242,239,230,.38)", 1.4, false);
    drawPoints(ctx, visible.weighIns.map(item => ({ date: parseDate(item.date), value: item.weight })), x, y, "#f2efe6", 2.4);
    drawLine(ctx, visible.trends.map(item => ({ date: parseDate(item.date), value: item.trend })), x, y, "#c8ff46", 3, false);
    drawLine(ctx, visible.planProjection.map(item => ({ date: parseDate(item.date), value: item.weight })), x, y, "#ff6b52", 2.3, true);
    drawLine(ctx, visible.currentProjection.map(item => ({ date: parseDate(item.date), value: item.weight })), x, y, "#64d8e7", 2.3, true, [3, 6]);
  }

  function drawLine(ctx, points, x, y, color, width, dashed, dashPattern = [8, 7]) {
    const valid = points.filter(point => point.date && Number.isFinite(point.value));
    if (valid.length < 2) return;
    ctx.save();
    ctx.beginPath();
    valid.forEach((point, index) => index ? ctx.lineTo(x(point.date), y(point.value)) : ctx.moveTo(x(point.date), y(point.value)));
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (dashed) ctx.setLineDash(dashPattern);
    ctx.stroke();
    ctx.restore();
  }

  function drawPoints(ctx, points, x, y, color, radius) {
    ctx.fillStyle = color;
    points.forEach(point => {
      if (!point.date || !Number.isFinite(point.value)) return;
      ctx.beginPath(); ctx.arc(x(point.date), y(point.value), radius, 0, Math.PI * 2); ctx.fill();
    });
  }

  function renderHistory(trends) {
    const list = $("#history-list");
    list.innerHTML = "";
    const rows = [...trends].reverse();
    $("#history-empty").hidden = rows.length > 0;
    $("#history-count").textContent = `${rows.length} ${rows.length === 1 ? "registro" : "registros"}`;
    rows.forEach(item => {
      const row = document.createElement("article");
      row.className = "history-row";
      row.dataset.id = item.id;
      row.innerHTML = `
        <label><span>Fecha</span><input class="date-input" data-field="date" type="text" inputmode="numeric" maxlength="10" value="${displayDate(item.date)}" aria-label="Fecha del pesaje"></label>
        <label><span>Peso</span><input data-field="weight" type="number" min="20" max="400" step="0.1" value="${item.weight}" aria-label="Peso en kg"></label>
        <div class="history-trend"><span>Tendencia</span><b>${formatKg(item.trend, 2)}</b></div>
        <button class="history-delete" type="button" data-delete-weight="${item.id}">Eliminar</button>`;
      list.appendChild(row);
    });
  }

  function openSettings(required = false, tab = "profile") {
    settingsRequired = required || !state.configured;
    fillProfileForm();
    $("#settings-modal").hidden = false;
    $("#close-settings").hidden = settingsRequired;
    $("#cancel-profile").hidden = settingsRequired;
    document.body.classList.add("modal-open");
    switchSettingsTab(tab);
    updateProfilePreview();
  }

  function closeSettings() {
    if (settingsRequired) return;
    $("#settings-modal").hidden = true;
    document.body.classList.remove("modal-open");
  }

  function switchSettingsTab(tab) {
    const chosen = tab === "weights" ? "weights" : "profile";
    $$('[data-settings-tab]').forEach(button => button.classList.toggle("active", button.dataset.settingsTab === chosen));
    $("#settings-profile").hidden = chosen !== "profile";
    $("#settings-weights").hidden = chosen !== "weights";
  }

  function fillProfileForm() {
    fillingProfileForm = true;
    const form = $("#profile-form");
    const profile = state.profile;
    const latest = latestWeighIn();
    form.elements.name.value = profile.name || "";
    form.elements.birthDate.value = displayDate(profile.birthDate);
    form.elements.sex.value = profile.sex || "male";
    form.elements.heightCm.value = profile.heightCm || "";
    form.elements.currentWeight.value = latest?.weight || "";
    form.elements.bodyFat.value = profile.bodyFat || "";
    const formula = form.querySelector(`[name="formula"][value="${profile.formula}"]`) || form.querySelector('[name="formula"][value="mifflin"]');
    formula.checked = true;
    form.elements.activityFactor.value = String(profile.activityFactor || 1.35);
    form.elements.goalType.value = profile.goalType || "loss";
    form.elements.goalMetric.value = profile.goalMetric || "weight";
    form.elements.goalWeight.value = profile.goalWeight || "";
    form.elements.goalBodyFat.value = profile.goalBodyFat || "";
    form.elements.goalDate.value = displayDate(profile.goalDate);
    form.elements.rateMode.value = profile.rateMode || "auto";
    form.elements.weeklyRatePct.value = profile.weeklyRatePct || 0.5;
    form.elements.macroMode.value = profile.macroMode || "auto";
    const currentPlan = calculatePlan(profile, state.weighIns);
    form.elements.proteinPct.value = profile.macroMode === "manual" ? Math.round(profile.proteinPct) : Math.round(currentPlan.proteinPct || 25);
    form.elements.fatPct.value = profile.macroMode === "manual" ? Math.round(profile.fatPct) : Math.round(currentPlan.fatPct || 25);
    form.elements.carbPct.value = profile.macroMode === "manual" ? Math.round(profile.carbPct) : Math.round(currentPlan.carbsPct || 50);
    $("#profile-import-callout").hidden = state.configured;
    syncNativeDatePickers();
    setTimeout(() => { fillingProfileForm = false; }, 0);
  }

  function profileFromForm() {
    const form = $("#profile-form");
    return normalizeProfile({
      ...state.profile,
      name: form.elements.name.value,
      birthDate: normalizeDate(form.elements.birthDate.value),
      sex: form.elements.sex.value,
      heightCm: form.elements.heightCm.value,
      bodyFat: form.elements.bodyFat.value,
      formula: form.elements.formula.value,
      activityFactor: form.elements.activityFactor.value,
      goalType: form.elements.goalType.value,
      goalMetric: form.elements.goalMetric.value,
      goalWeight: form.elements.goalWeight.value,
      goalBodyFat: form.elements.goalBodyFat.value,
      goalDate: normalizeDate(form.elements.goalDate.value),
      rateMode: form.elements.rateMode.value,
      weeklyRatePct: form.elements.weeklyRatePct.value,
      macroMode: form.elements.macroMode.value,
      proteinPct: form.elements.proteinPct.value,
      fatPct: form.elements.fatPct.value,
      carbPct: form.elements.carbPct.value
    }, state.weighIns);
  }

  function updateProfileControls() {
    const form = $("#profile-form");
    const bodyFat = toNumber(form.elements.bodyFat.value, NaN);
    const cunningham = form.querySelector('[name="formula"][value="cunningham"]');
    cunningham.disabled = !Number.isFinite(bodyFat);
    $("#cunningham-choice").classList.toggle("disabled", cunningham.disabled);
    if (cunningham.disabled && cunningham.checked) form.querySelector('[name="formula"][value="mifflin"]').checked = true;

    const goalType = form.elements.goalType.value;
    const goalMetric = form.elements.goalMetric.value;
    const maintain = goalType === "maintain";
    form.elements.goalMetric.disabled = maintain;
    $("#goal-weight-field").hidden = maintain || goalMetric !== "weight";
    $("#goal-bodyfat-field").hidden = maintain || goalMetric !== "bodyFat";
    $("#manual-rate-field").hidden = maintain || form.elements.rateMode.value !== "manual";
    form.elements.goalDate.disabled = maintain;
    form.elements.rateMode.disabled = maintain;
    $("#activity-explanation").textContent = `${ACTIVITY_EXPLANATIONS[form.elements.activityFactor.value] || ""} Elegilo por la rutina completa, no solamente por el entrenamiento.`;

    const sum = ["proteinPct","fatPct","carbPct"].reduce((total, name) => total + toNumber(form.elements[name].value, 0), 0);
    $("#macro-percent-sum").textContent = `${formatNumber(sum,0)}%`;
    $("#macro-percent-sum").closest(".macro-sum-line").classList.toggle("invalid", Math.abs(sum - 100) > 0.01);
    $("#macro-mode-label").textContent = form.elements.macroMode.value === "manual" ? "personalizada" : "automática";
  }

  function updateProfilePreview(event) {
    const form = $("#profile-form");
    if (!fillingProfileForm && event?.target?.matches('[name="proteinPct"],[name="fatPct"],[name="carbPct"]')) {
      form.elements.macroMode.value = "manual";
    }
    updateProfileControls();
    const draft = profileFromForm();
    const currentWeight = toNumber(form.elements.currentWeight.value, NaN);
    const temporaryWeighIns = Number.isFinite(currentWeight)
      ? mergeWeighIns(state.weighIns, [{ date: todayISO(), weight: currentWeight }])
      : state.weighIns;
    const plan = calculatePlan(draft, temporaryWeighIns, currentWeight);
    $("#preview-maintenance").textContent = Number.isFinite(plan.maintenance) ? `${formatNumber(Math.round(plan.maintenance))} kcal` : "—";
    $("#preview-calories").textContent = Number.isFinite(plan.targetCalories) ? `${formatNumber(Math.round(plan.targetCalories))} kcal` : "—";
    $("#preview-protein").textContent = Number.isFinite(plan.proteinG) ? `${formatNumber(Math.round(plan.proteinG))} g` : "—";
    $("#preview-fat").textContent = Number.isFinite(plan.fatG) ? `${formatNumber(Math.round(plan.fatG))} g` : "—";
    $("#preview-carbs").textContent = Number.isFinite(plan.carbsG) ? `${formatNumber(Math.round(plan.carbsG))} g` : "—";
    $("#preview-date").textContent = plan.estimatedDate ? formatDate(plan.estimatedDate) : "—";
    renderGoalExplanation(draft, plan);
    renderMacroExplanation(draft, plan);
  }

  function renderGoalExplanation(profile, plan) {
    const box = $("#goal-explanation");
    box.className = "explanation-box";
    if (profile.goalType === "maintain") {
      box.textContent = "En mantenimiento no se aplica déficit ni superávit. La referencia es sostener una tendencia estable.";
      return;
    }
    if (profile.goalMetric === "bodyFat" && !Number.isFinite(toNumber(profile.bodyFat, NaN))) {
      box.textContent = "Para usar porcentaje de grasa como objetivo necesitás una estimación actual. Si no la conocés, elegí peso corporal.";
      box.classList.add("alert");
      return;
    }
    if (!profile.goalDate) {
      box.textContent = "Definí una fecha objetivo. Si escribís solo día y mes, MASA usa el año actual.";
      box.classList.add("alert");
      return;
    }
    if (!Number.isFinite(plan.targetWeight)) {
      box.textContent = "Falta un objetivo válido.";
      box.classList.add("alert");
      return;
    }
    if (plan.rate.capped) {
      box.textContent = `La fecha elegida exige ${formatNumber(plan.rate.required, 2)}% semanal. En automático se usa el máximo de referencia de ${formatNumber(plan.rate.bounds.suggestedMax, 2)}%.`;
      box.classList.add("warn");
      return;
    }
    if (plan.rate.selected > plan.rate.bounds.suggestedMax) {
      box.textContent = `El ritmo manual supera ${formatNumber(plan.rate.bounds.suggestedMax, 2)}% semanal. La cuenta se muestra, pero queda marcada como agresiva.`;
      box.classList.add("alert");
      return;
    }
    box.textContent = `Ritmo usado: ${formatNumber(plan.rate.selected, 2)}% semanal. La fecha objetivo y el ritmo se validan por separado.`;
  }

  function renderMacroExplanation(profile, plan) {
    const box = $("#macro-explanation");
    box.className = "explanation-box";
    const sum = toNumber(profile.proteinPct, 0) + toNumber(profile.fatPct, 0) + toNumber(profile.carbPct, 0);
    if (profile.macroMode === "auto") {
      box.textContent = `Automático: ${formatNumber(plan.macroRule.proteinPerKg, 1)} g/kg de proteína, ${formatNumber(plan.macroRule.fatPercent, 0)}% en grasas y el resto en carbohidratos. Modificar un porcentaje lo convierte en personalizado.`;
      return;
    }
    if (Math.abs(sum - 100) > 0.01) {
      box.textContent = `Los tres porcentajes suman ${formatNumber(sum,0)}%. Deben sumar exactamente 100%.`;
      box.classList.add("alert");
      return;
    }
    box.textContent = `Personalizado: ${formatNumber(profile.proteinPct,0)}% proteína, ${formatNumber(profile.fatPct,0)}% grasas y ${formatNumber(profile.carbPct,0)}% carbohidratos.`;
  }

  function validateProfile(profile, currentWeight) {
    const birth = parseDate(profile.birthDate);
    const today = parseDate(todayISO());
    if (!birth) return { message: "Ingresá una fecha de nacimiento válida en formato dd/mm/aaaa.", field: "birthDate" };
    if (birth > today) return { message: "La fecha de nacimiento no puede ser posterior a hoy.", field: "birthDate" };
    if (!Number.isFinite(toNumber(profile.heightCm, NaN))) return { message: "Ingresá tu altura.", field: "heightCm" };
    if (!Number.isFinite(currentWeight) || currentWeight <= 0) return { message: "Ingresá tu peso actual.", field: "currentWeight" };
    if (profile.formula === "cunningham" && !Number.isFinite(toNumber(profile.bodyFat, NaN))) return { message: "Cunningham necesita un porcentaje de grasa.", field: "bodyFat" };
    if (profile.goalType !== "maintain") {
      if (profile.goalMetric === "weight" && !Number.isFinite(toNumber(profile.goalWeight, NaN))) return { message: "Ingresá un peso objetivo.", field: "goalWeight" };
      if (profile.goalMetric === "bodyFat" && !Number.isFinite(toNumber(profile.goalBodyFat, NaN))) return { message: "Ingresá el porcentaje de grasa objetivo.", field: "goalBodyFat" };
      if (profile.goalMetric === "bodyFat" && !Number.isFinite(toNumber(profile.bodyFat, NaN))) return { message: "Para un objetivo de grasa necesitás indicar el porcentaje actual.", field: "bodyFat" };
      if (!profile.goalDate) return { message: "Ingresá una fecha objetivo.", field: "goalDate" };
      if (parseDate(profile.goalDate) <= today) return { message: "La fecha objetivo debe ser futura.", field: "goalDate" };
    }
    if (profile.macroMode === "manual") {
      const values = [profile.proteinPct, profile.fatPct, profile.carbPct].map(value => toNumber(value, NaN));
      if (!values.every(Number.isFinite)) return { message: "Completá los tres porcentajes de macros.", field: "proteinPct" };
      if (Math.abs(values.reduce((a,b) => a+b, 0) - 100) > 0.01) return { message: "Los porcentajes de macros deben sumar 100%.", field: "proteinPct" };
    }
    return null;
  }

  function focusProfileField(name) {
    switchSettingsTab("profile");
    const field = $("#profile-form").elements[name];
    if (!field) return;
    field.classList.add("invalid-field");
    field.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => field.focus(), 280);
  }

  function saveProfile(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const currentWeight = toNumber(form.elements.currentWeight.value, NaN);
    const profile = profileFromForm();
    $$("#profile-form .invalid-field").forEach(field => field.classList.remove("invalid-field"));
    const error = validateProfile(profile, currentWeight);
    if (error) {
      setFeedback($("#profile-feedback"), error.message, true);
      focusProfileField(error.field);
      return;
    }

    state.weighIns = mergeWeighIns(state.weighIns, [{ date: todayISO(), weight: currentWeight }]);
    const first = sortedWeighIns(state.weighIns)[0];
    if (!profile.planStartDate) profile.planStartDate = first.date;
    if (!Number.isFinite(toNumber(profile.planStartWeight, NaN))) profile.planStartWeight = first.weight;
    state.profile = profile;
    state.configured = true;
    saveState(state);
    settingsRequired = false;
    $("#settings-modal").hidden = true;
    document.body.classList.remove("modal-open");
    setFeedback($("#profile-feedback"), "");
    render();
  }

  function addQuickWeight(event) {
    event.preventDefault();
    const weight = toNumber($("#quick-weight").value, NaN);
    const alternate = !$("#alternate-date-wrap").hidden;
    const date = alternate ? normalizeDate($("#quick-date").value) : todayISO();
    if (!Number.isFinite(weight) || weight <= 0 || !date) {
      setFeedback($("#weight-feedback"), "Revisá el peso y la fecha.", true);
      return;
    }
    state.weighIns = mergeWeighIns(state.weighIns, [{ date, weight }]);
    saveState(state);
    weightEditorForced = false;
    $("#quick-weight").value = "";
    $("#alternate-date-wrap").hidden = true;
    setFeedback($("#weight-feedback"), `Registrado: ${formatKg(weight)} · ${formatDate(date)}.`);
    render();
  }

  function updateHistoryRow(event) {
    const input = event.target.closest("input[data-field]");
    if (!input) return;
    const row = input.closest(".history-row");
    const item = state.weighIns.find(entry => entry.id === row?.dataset.id);
    if (!item) return;
    const date = normalizeDate(row.querySelector('[data-field="date"]').value);
    const weight = toNumber(row.querySelector('[data-field="weight"]').value, NaN);
    if (!date || !Number.isFinite(weight) || weight <= 0) return;
    state.weighIns = state.weighIns.filter(entry => entry.id !== item.id);
    state.weighIns = mergeWeighIns(state.weighIns, [{ id: item.id, date, weight }]);
    saveState(state);
    render();
  }

  function deleteHistoryRow(event) {
    const button = event.target.closest("[data-delete-weight]");
    if (!button) return;
    state.weighIns = state.weighIns.filter(item => item.id !== button.dataset.deleteWeight);
    saveState(state);
    render();
    if (!state.configured) openSettings(true, "profile");
  }

  function openImport(mode) {
    importMode = mode;
    $("#import-file").value = "";
    $("#import-file").click();
  }

  async function handleImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const isJson = file.name.toLowerCase().endsWith(".json") || text.trim().startsWith("{") || text.trim().startsWith("[");
      if (isJson) {
        const parsed = JSON.parse(text);
        const imported = normalizeState(parsed);
        if (importMode === "profile" && profileIsComplete(imported.profile, imported.weighIns)) {
          state = saveState({ ...imported, configured: true });
          settingsRequired = false;
          $("#settings-modal").hidden = true;
          document.body.classList.remove("modal-open");
          render();
          return;
        }
        if (imported.weighIns.length) {
          state.weighIns = mergeWeighIns(state.weighIns, imported.weighIns);
          if (importMode === "profile" && parsed.profile) state.profile = normalizeProfile(parsed.profile, state.weighIns);
          state.configured = profileIsComplete(state.profile, state.weighIns);
          saveState(state);
          render();
          if (!state.configured) openSettings(true, "profile");
          else switchSettingsTab("weights");
          return;
        }
        throw new Error("No se encontraron datos válidos.");
      }

      const weights = parseWeightTable(text);
      if (!weights.length) throw new Error("No se encontraron columnas de fecha y peso.");
      state.weighIns = mergeWeighIns(state.weighIns, weights);
      if (!state.profile.planStartDate) {
        const first = sortedWeighIns(state.weighIns)[0];
        state.profile.planStartDate = first.date;
        state.profile.planStartWeight = first.weight;
      }
      state.configured = profileIsComplete(state.profile, state.weighIns);
      saveState(state);
      render();
      if (!state.configured) openSettings(true, "profile");
      else switchSettingsTab("weights");
    } catch (error) {
      window.alert(error.message || "No se pudo importar el archivo.");
    }
  }

  function parseWeightTable(text) {
    const clean = text.replace(/^\uFEFF/, "").trim();
    if (!clean) return [];
    const lines = clean.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return [];
    const first = lines[0];
    const delimiter = first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";
    const headers = splitDelimited(first, delimiter).map(normalizeHeader);
    let dateIndex = headers.findIndex(header => ["fecha", "date", "dia"].some(key => header.includes(key)));
    let weightIndex = headers.findIndex(header => ["peso", "weight", "kg"].some(key => header.includes(key)));
    if (dateIndex < 0 || weightIndex < 0) { dateIndex = 0; weightIndex = 1; }
    return lines.slice(1).map(line => {
      const parts = splitDelimited(line, delimiter);
      return { date: normalizeDate(parts[dateIndex]), weight: toNumber(parts[weightIndex], NaN) };
    }).filter(item => item.date && Number.isFinite(item.weight) && item.weight > 0);
  }

  function splitDelimited(line, delimiter) {
    const values = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') { current += '"'; i += 1; }
        else quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        values.push(current.trim()); current = "";
      } else current += char;
    }
    values.push(current.trim());
    return values;
  }

  function normalizeHeader(value) {
    return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  }

  function exportHistory() {
    downloadText("datos-masa.json", JSON.stringify({ ...state, version: 6 }, null, 2), "application/json");
  }

  function exportBackup() {
    downloadText("perfil-masa.json", JSON.stringify({ ...state, version: 6 }, null, 2), "application/json");
  }

  function downloadText(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function openConfirm() {
    $("#confirm-modal").hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeConfirm() {
    $("#confirm-modal").hidden = true;
  }

  function resetAll() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      LEGACY_KEYS.forEach(key => localStorage.removeItem(key));
    } catch (_) {}
    state = normalizeState({ configured: false, profile: DEFAULT_PROFILE, weighIns: [] });
    closeConfirm();
    $("#settings-modal").hidden = true;
    document.body.classList.remove("modal-open");
    render();
  }

  function setFeedback(element, text, error = false) {
    element.textContent = text;
    element.classList.toggle("error", error);
  }

  function formatDateTyping(event) {
    const input = event.target.closest(".date-input");
    if (!input) return;
    const digits = input.value.replace(/\D/g, "").slice(0, 8);
    input.value = digits.length <= 2 ? digits : digits.length <= 4 ? `${digits.slice(0,2)}/${digits.slice(2)}` : `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4)}`;
  }

  function normalizeDateField(event) {
    const input = event.target.closest(".date-input");
    if (!input || !input.value.trim()) return;
    const iso = normalizeDate(input.value);
    if (iso) input.value = displayDate(iso);
  }

  function bindEvents() {
    $("#begin-setup").addEventListener("click", () => openSettings(true, "profile"));
    $("#welcome-import").addEventListener("click", () => openImport("profile"));
    $("#open-profile").addEventListener("click", () => openSettings(false, "profile"));
    $("#brand-home").addEventListener("click", () => switchAppView("today"));
    $$('[data-app-view]').forEach(button => button.addEventListener("click", () => switchAppView(button.dataset.appView)));
    $("#close-settings").addEventListener("click", closeSettings);
    $("#cancel-profile").addEventListener("click", closeSettings);
    $$('[data-close-settings]').forEach(element => element.addEventListener("click", closeSettings));
    $$('[data-settings-tab]').forEach(button => button.addEventListener("click", () => switchSettingsTab(button.dataset.settingsTab)));
    $("#profile-form").addEventListener("submit", saveProfile);
    $("#profile-form").addEventListener("input", updateProfilePreview);
    $("#profile-form").addEventListener("change", updateProfilePreview);
    document.addEventListener("input", formatDateTyping);
    document.addEventListener("blur", normalizeDateField, true);
    $$("[data-calendar-for]").forEach(button => button.addEventListener("click", () => openCalendar(button.dataset.calendarFor)));
    $$("[data-native-date]").forEach(picker => picker.addEventListener("change", applyNativeDate));

    $("#quick-weight-form").addEventListener("submit", addQuickWeight);
    $("#edit-today-weight").addEventListener("click", () => showWeightEditor("today"));
    $("#add-previous-weight").addEventListener("click", () => showWeightEditor("previous"));
    $("#toggle-date").addEventListener("click", () => {
      $("#alternate-date-wrap").hidden = !$("#alternate-date-wrap").hidden;
      $("#toggle-date").textContent = $("#alternate-date-wrap").hidden ? "El pesaje es de otro día" : "Usar la fecha de hoy";
      if (!$("#alternate-date-wrap").hidden) $("#quick-date").value = displayDate(todayISO());
    });

    $("#toggle-history-manager").addEventListener("click", () => {
      const button = $("#toggle-history-manager");
      const expanded = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!expanded));
      button.querySelector("i").textContent = expanded ? "＋" : "−";
      $("#history-manager").hidden = expanded;
    });
    $("#history-list").addEventListener("change", updateHistoryRow);
    $("#history-list").addEventListener("click", deleteHistoryRow);
    $("#profile-import").addEventListener("click", () => openImport("profile"));
    $("#import-history").addEventListener("click", () => openImport("history"));
    $("#import-file").addEventListener("change", handleImport);
    $("#export-history").addEventListener("click", exportHistory);
    $("#start-over").addEventListener("click", openConfirm);
    $("#cancel-confirm").addEventListener("click", () => { closeConfirm(); document.body.classList.add("modal-open"); });
    $("#confirm-action").addEventListener("click", resetAll);
    $("#apply-recalibration").addEventListener("click", applyRecalibration);

    $$("[data-add-meal]").forEach(button => button.addEventListener("click", () => openFoodModal(button.dataset.addMeal)));
    $("#global-add-intake").addEventListener("click", openMealPicker);
    $("#close-meal-picker").addEventListener("click", closeMealPicker);
    $$("[data-close-meal-picker]").forEach(element => element.addEventListener("click", closeMealPicker));
    $$("[data-pick-meal]").forEach(button => button.addEventListener("click", () => pickMeal(button.dataset.pickMeal)));
    $("#change-active-meal").addEventListener("click", () => { closeFoodModal(); openMealPicker(); });
    $$("[data-diary-view]").forEach(button => button.addEventListener("click", () => switchDiaryView(button.dataset.diaryView)));
    $$("[data-calorie-range]").forEach(button => button.addEventListener("click", () => {
      calorieRange = toNumber(button.dataset.calorieRange, 14);
      $$("[data-calorie-range]").forEach(item => item.classList.toggle("active", item === button));
      drawCalorieChart(calculatePlan());
    }));
    $("#finish-day").addEventListener("click", finishDay);
    $("#hide-day-summary").addEventListener("click", hideDaySummary);
    $("#meal-grid").addEventListener("click", removeDiaryEntry);
    $("#close-food").addEventListener("click", closeFoodModal);
    $$("[data-close-food]").forEach(element => element.addEventListener("click", closeFoodModal));
    $$("[data-food-mode]").forEach(button => button.addEventListener("click", () => switchFoodMode(button.dataset.foodMode)));
    $("#food-search-input").addEventListener("input", renderFoodResults);
    $("#food-results").addEventListener("click", event => {
      const button = event.target.closest("[data-add-food]");
      if (button) addLibraryFood(button.dataset.addFood, button.dataset.foodKind);
    });
    $("#recipe-results").addEventListener("click", event => {
      const button = event.target.closest("[data-add-food]");
      if (button) addLibraryFood(button.dataset.addFood, button.dataset.foodKind);
    });
    $("#quick-calorie-form").addEventListener("submit", addQuickCalories);
    $("#new-custom-food").addEventListener("click", openFoodEditor);
    $("#new-recipe").addEventListener("click", openRecipeEditor);
    $("#new-recipe-secondary").addEventListener("click", openRecipeEditor);
    $("#close-food-editor").addEventListener("click", closeFoodEditor);
    $$("[data-close-food-editor]").forEach(element => element.addEventListener("click", closeFoodEditor));
    $("#food-editor-form").addEventListener("submit", saveCustomFood);
    $("#close-recipe").addEventListener("click", closeRecipeEditor);
    $$("[data-close-recipe]").forEach(element => element.addEventListener("click", closeRecipeEditor));
    $("#recipe-form").addEventListener("submit", saveRecipe);
    $("#day-projection-weeks").addEventListener("change", () => renderDayProjection(calculatePlan(), diaryTotals()));
    $("#daily-checkin-form").addEventListener("submit", submitDailyCheckin);
    $("#skip-daily-weight").addEventListener("click", () => finishDailyCheckin());

    $$('[data-chart-range]').forEach(button => button.addEventListener("click", () => {
      chartRange = button.dataset.chartRange;
      $$('[data-chart-range]').forEach(item => item.classList.toggle("active", item === button));
      if (chartPayload) drawWeightChart($("#weight-chart"), chartPayload);
    }));
    window.addEventListener("resize", debounce(() => {
      if (chartPayload && activeAppView === "progress") drawWeightChart($("#weight-chart"), chartPayload);
      if (activeDiaryView === "chart") drawCalorieChart(calculatePlan());
    }, 100));
  }

  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function init() {
    bindEvents();
    $$(".help-dot[data-tooltip]").forEach(button => { button.title = button.dataset.tooltip; });
    render();
    switchAppView("today", false);
    switchDiaryView("record");
    setTimeout(maybeOpenDailyCheckin, 180);
    if (navigator.serviceWorker?.register && location.protocol !== "file:") {
      navigator.serviceWorker.register("/masa/service-worker.js", { scope: "/masa/" }).catch(() => {});
    }
  }

  init();
})();
