(() => {
  "use strict";

  const STORAGE_KEY = "masa-state-v10";
  const LEGACY_KEYS = ["masa-state-v9", "masa-state-v8", "masa-state-v7", "masa-state-v6", "masa-state-v5", "peso-claro-state-v2", "peso-claro-state-v1"];
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
    macroMode: "athletic",
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
  let activeProgressChart = "weight";
  let recalibrationSuggestion = null;
  let fillingProfileForm = false;
  let activeMeal = "breakfast";
  let activeFoodMode = "food";
  let activeAppView = "today";
  let activeDiaryView = "record";
  let calorieRange = 14;
  let weightEditorForced = false;
  let selectedDiaryDate = todayISO();

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
    const rawMacroMode = raw.macroMode === "manual" ? "custom" : raw.macroMode === "auto" ? "athletic" : raw.macroMode;
    const macroMode = rawMacroMode === "custom" && (hasPercentMacros || hasOldMacros)
      ? "custom"
      : ["balanced", "athletic"].includes(rawMacroMode) ? rawMacroMode : "athletic";
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
      proteinPct: macroMode === "custom" ? clamp(migratedProteinPct, 5, 70) : "",
      fatPct: macroMode === "custom" ? clamp(migratedFatPct, 10, 70) : "",
      carbPct: macroMode === "custom" ? clamp(migratedCarbPct, 5, 80) : "",
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
      version: 10,
      configured,
      profile,
      weighIns: sorted,
      foods,
      recipes,
      diary,
      completedDays,
      calibrationHistory: Array.isArray(input.calibrationHistory) ? input.calibrationHistory.slice(-20) : [],
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

  function athleticMacroRule(goalType) {
    if (goalType === "loss") return { proteinPerKg: 2.2, fatPerKg: 1 };
    if (goalType === "gain") return { proteinPerKg: 1.8, fatPerKg: 1 };
    return { proteinPerKg: 1.8, fatPerKg: 1 };
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
    if (profile.macroMode === "custom") {
      const pPct = toNumber(profile.proteinPct, NaN);
      const fPct = toNumber(profile.fatPct, NaN);
      const cPct = toNumber(profile.carbPct, NaN);
      proteinG = Number.isFinite(targetCalories) && Number.isFinite(pPct) ? targetCalories * pPct / 100 / 4 : null;
      fatG = Number.isFinite(targetCalories) && Number.isFinite(fPct) ? targetCalories * fPct / 100 / 9 : null;
      carbsG = Number.isFinite(targetCalories) && Number.isFinite(cPct) ? targetCalories * cPct / 100 / 4 : null;
      macroRule = { mode: "custom", proteinPerKg: Number.isFinite(proteinG) ? proteinG / weight : null, fatPercent: fPct };
    } else if (profile.macroMode === "balanced") {
      const distribution = { proteinPct: 20, fatPct: 30, carbPct: 50 };
      proteinG = Number.isFinite(targetCalories) ? targetCalories * distribution.proteinPct / 100 / 4 : null;
      fatG = Number.isFinite(targetCalories) ? targetCalories * distribution.fatPct / 100 / 9 : null;
      carbsG = Number.isFinite(targetCalories) ? targetCalories * distribution.carbPct / 100 / 4 : null;
      macroRule = { mode: "balanced", ...distribution };
    } else {
      const athletic = athleticMacroRule(profile.goalType);
      proteinG = weight * athletic.proteinPerKg;
      const requestedFatG = weight * athletic.fatPerKg;
      const availableForFat = Number.isFinite(targetCalories) ? Math.max(0, targetCalories - proteinG * 4) : null;
      fatG = Number.isFinite(availableForFat) ? Math.min(requestedFatG, availableForFat / 9) : null;
      carbsG = Number.isFinite(targetCalories) && Number.isFinite(fatG) ? Math.max(0, (targetCalories - proteinG * 4 - fatG * 9) / 4) : null;
      macroRule = { mode: "athletic", ...athletic, effectiveFatPerKg: Number.isFinite(fatG) ? fatG / weight : null };
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
    return state.diary[selectedDiaryDate] || [];
  }

  function diaryDateStatus(date = selectedDiaryDate) {
    if (date === todayISO()) return "Hoy";
    const yesterday = toISODate(addDays(parseDate(todayISO()), -1));
    if (date === yesterday) return "Ayer";
    return formatDate(date);
  }

  function setSelectedDiaryDate(value, scroll = false) {
    const iso = normalizeDate(value);
    if (!iso) return;
    selectedDiaryDate = iso > todayISO() ? todayISO() : iso;
    weightEditorForced = false;
    renderDiary(calculatePlan());
    renderRecordWeight();
    if (activeDiaryView === "chart") requestAnimationFrame(() => drawCalorieChart(calculatePlan()));
    if (scroll) $("#daily-diary")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function changeDiaryDay(delta) {
    const current = parseDate(selectedDiaryDate) || new Date();
    setSelectedDiaryDate(toISODate(addDays(current, delta)));
  }

  function openDiaryCalendar() {
    const picker = $("#diary-native-date");
    picker.max = todayISO();
    picker.value = selectedDiaryDate;
    if (typeof picker.showPicker === "function") picker.showPicker();
    else picker.click();
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
    const selected = parseDate(selectedDiaryDate) || new Date();
    $("#diary-date-label").textContent = new Intl.DateTimeFormat("es-UY", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(selected);
    $("#diary-date-status").textContent = diaryDateStatus();
    $("#diary-native-date").value = selectedDiaryDate;
    $("#diary-native-date").max = todayISO();
    $("#diary-next-day").disabled = selectedDiaryDate >= todayISO();
    $("#diary-today-button").hidden = selectedDiaryDate === todayISO();

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

    const completed = Boolean(state.completedDays?.[selectedDiaryDate]);
    $("#day-reading").hidden = !completed;
    $("#finish-day").textContent = completed ? "Día terminado ✓" : selectedDiaryDate === todayISO() ? "Terminar día" : "Terminar este día";
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
    state.completedDays[selectedDiaryDate] = true;
    saveState(state);
    $("#day-reading").hidden = false;
    renderDayProjection(calculatePlan(), diaryTotals());
    $("#day-reading").scrollIntoView({ behavior: "smooth", block: "center" });
    render();
  }

  function hideDaySummary() {
    state.completedDays = state.completedDays || {};
    delete state.completedDays[selectedDiaryDate];
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
    const end = parseDate(selectedDiaryDate);
    const days = [];
    for (let offset = calorieRange - 1; offset >= 0; offset -= 1) {
      const date = addDays(end, -offset);
      const iso = toISODate(date);
      const totals = diaryTotalsForDate(iso);
      days.push({ date, iso, calories: totals.calories, hasEntries: (state.diary[iso] || []).length > 0, completed: Boolean(state.completedDays?.[iso]) });
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
    const analysis = buildCalorieAnalysis(plan, sortedWeighIns(), days);
    if (!Number.isFinite(analysis.average)) {
      $("#calorie-chart-summary").textContent = "Todavía no hay días suficientes para comparar.";
      return;
    }
    const diff = analysis.difference;
    const weightText = Number.isFinite(analysis.observedWeekly)
      ? ` · el peso ${analysis.observedWeekly < -0.05 ? "baja" : analysis.observedWeekly > 0.05 ? "sube" : "se mantiene"} ${Math.abs(analysis.observedWeekly) >= 0.05 ? `${formatNumber(Math.abs(analysis.observedWeekly), 2)} kg/sem` : ""}`
      : "";
    $("#calorie-chart-summary").textContent = `Promedio: ${formatNumber(Math.round(analysis.average))} kcal · ${formatNumber(Math.abs(Math.round(diff)))} kcal ${diff > 0 ? "sobre" : "bajo"} el objetivo${weightText}.`;
  }

  function switchAppView(view, scroll = true) {
    activeAppView = view === "progress" ? "progress" : "today";
    $$('[data-app-view]').forEach(button => button.classList.toggle("active", button.dataset.appView === activeAppView));
    $("#today-view").hidden = activeAppView !== "today";
    $("#progress-view").hidden = activeAppView !== "progress";
    if (activeAppView === "progress" && chartPayload) requestAnimationFrame(renderActiveProgressChart);
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

  function showWeightEditor() {
    weightEditorForced = true;
    const entry = state.weighIns.find(item => item.date === selectedDiaryDate);
    $("#quick-weight").value = entry?.weight || "";
    renderRecordWeight();
    setTimeout(() => $("#quick-weight")?.focus(), 50);
  }

  function renderRecordWeight() {
    const entry = state.weighIns.find(item => item.date === selectedDiaryDate);
    const recorded = Boolean(entry);
    const selectedLabel = selectedDiaryDate === todayISO() ? "hoy" : `el ${formatDate(selectedDiaryDate)}`;
    $("#record-weight-title").textContent = recorded ? `Peso de ${selectedLabel}` : `Registrar peso de ${selectedLabel}`;
    $("#weight-context").textContent = recorded
      ? `Este dato forma parte de la tendencia y puede editarse sin salir del registro diario.`
      : "Es opcional. Un dato aislado puede variar mucho; la tendencia necesita varias mediciones.";
    $("#today-weight-recorded").hidden = !recorded || weightEditorForced;
    $("#quick-weight-form").hidden = recorded && !weightEditorForced;
    if (recorded) $("#today-weight-value").textContent = formatKg(entry.weight);
    if (!weightEditorForced && !recorded) $("#quick-weight").value = "";
  }

  function updateWeightEntryState() {
    renderRecordWeight();
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
  }

  function openFoodModal(meal) {
    activeMeal = meal;
    activeFoodMode = "food";
    $("#food-meal-label").textContent = `Agregar en ${mealLabel(meal)} · ${formatDate(selectedDiaryDate)}`;
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
    state.diary[selectedDiaryDate] = [...todayDiary(), entry];
    item.uses = toNumber(item.uses,0) + 1;
    item.lastUsed = selectedDiaryDate;
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
    state.diary[selectedDiaryDate] = [...todayDiary(), item];
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
    state.diary[selectedDiaryDate] = todayDiary().filter(item => item.id !== button.dataset.removeDiary);
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
    $("#daily-title").textContent = person ? `${person}, este es tu plan diario.` : "Tu plan diario.";
    $("#target-calories").textContent = hasCalories ? formatNumber(Math.round(plan.targetCalories)) : "—";
    $("#maintenance-calories").textContent = hasMaintenance ? `${formatNumber(Math.round(plan.maintenance))} kcal` : "—";
    $("#calorie-adjustment").textContent = Number.isFinite(plan.dailyAdjustment) ? `${plan.dailyAdjustment > 0 ? "+" : ""}${formatNumber(Math.round(plan.dailyAdjustment))} kcal` : "—";
    $("#formula-name").textContent = plan.rmr.fallback ? "Mifflin (respaldo)" : (FORMULA_LABELS[plan.rmr.used] || "—");
    $("#activity-name").textContent = ACTIVITY_LABELS[String(profile.activityFactor)] || formatNumber(profile.activityFactor, 2);

    $("#protein-grams").textContent = Number.isFinite(plan.proteinG) ? `${formatNumber(Math.round(plan.proteinG))} g` : "—";
    $("#fat-grams").textContent = Number.isFinite(plan.fatG) ? `${formatNumber(Math.round(plan.fatG))} g` : "—";
    $("#carb-grams").textContent = Number.isFinite(plan.carbsG) ? `${formatNumber(Math.round(plan.carbsG))} g` : "—";
    $("#protein-detail").textContent = profile.macroMode === "athletic"
      ? `${formatNumber(plan.macroRule.proteinPerKg, 1)} g/kg · ${formatNumber(plan.proteinPct, 0)}%`
      : `${formatNumber(plan.proteinPct, 0)}% de las calorías`;
    $("#fat-detail").textContent = profile.macroMode === "athletic"
      ? `${formatNumber(plan.macroRule.effectiveFatPerKg, 1)} g/kg · ${formatNumber(plan.fatPct, 0)}%`
      : `${formatNumber(plan.fatPct, 0)}% de las calorías`;
    $("#carb-detail").textContent = profile.macroMode === "athletic"
      ? `calorías restantes · ${formatNumber(plan.carbsPct, 0)}%`
      : `${formatNumber(plan.carbsPct, 0)}% de las calorías`;
    $("#protein-bar").style.setProperty("--macro-width", `${clamp(plan.proteinPct || 0, 0, 100)}%`);
    $("#fat-bar").style.setProperty("--macro-width", `${clamp(plan.fatPct || 0, 0, 100)}%`);
    $("#carb-bar").style.setProperty("--macro-width", `${clamp(plan.carbsPct || 0, 0, 100)}%`);

    const macroNote = $("#macro-balance-note");
    macroNote.className = "inline-note";
    macroNote.textContent = profile.macroMode === "custom"
      ? `Distribución personalizada: ${formatNumber(plan.proteinPct,0)}% proteína, ${formatNumber(plan.fatPct,0)}% grasas y ${formatNumber(plan.carbsPct,0)}% carbohidratos.`
      : profile.macroMode === "balanced"
        ? "Modo balanceado: 20% proteína, 30% grasas y 50% carbohidratos."
        : "Modo atlético: proteína y grasas según peso; carbohidratos con la energía restante.";

    $("#current-weight").textContent = formatKg(latest?.weight);
    $("#trend-weight").textContent = formatKg(latestTrend, 2);
    $("#observed-rate").textContent = Number.isFinite(observedWeekly) ? `${observedWeekly > 0 ? "+" : ""}${formatNumber(observedWeekly, 2)} kg/sem` : "Faltan datos";
    $("#current-body-fat").textContent = Number.isFinite(toNumber(profile.bodyFat, NaN)) ? `${formatNumber(profile.bodyFat,1)}%` : "Sin dato";
    $("#weight-context").textContent = latest
      ? `Último registro: ${formatDate(latest.date)}. La tendencia actual está en ${formatKg(latestTrend, 2)}.`
      : "El peso diario puede moverse mucho. La línea de tendencia es la que importa.";
    updateWeightEntryState();

    renderDiary(plan);
    renderRecordWeight();
    renderPlanStrip(profile, plan);
    renderRecalibration(profile, plan, weighIns);
    renderCharts(profile, plan, weighIns, trends, observedWeekly);
    renderHistory(trends);

    $("#stat-change").textContent = first && latest ? formatSignedKg(latest.weight - first.weight) : "—";
    $("#stat-bmi").textContent = formatNumber(plan.bmi, 1);
    $("#stat-bmi-note").textContent = bmiCategory(plan.bmi);
    $("#stat-body-fat").textContent = Number.isFinite(toNumber(profile.bodyFat, NaN)) ? `${formatNumber(profile.bodyFat,1)}%` : "Sin dato";
    $("#stat-ffmi").textContent = formatNumber(plan.ffmi, 1);
    $("#plan-start").textContent = formatDate(profile.planStartDate || first?.date);
    $("#plan-start-weight").textContent = formatKg(toNumber(profile.planStartWeight, first?.weight));
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

  function setInsightFact(index, label, value) {
    $(`#insight-fact-label-${index}`).textContent = label;
    const valueIds = ["expected-today", "expected-difference", "stat-change"];
    $(`#${valueIds[index - 1]}`).textContent = value;
  }

  function renderWeightInsight(profile, plan, weighIns, trends, observedWeekly) {
    $(".progress-model-data").hidden = false;
    const latest = weighIns.at(-1);
    const first = weighIns[0];
    const latestTrend = trends.at(-1)?.trend;
    const expectedToday = expectedAtDate(profile, plan, parseDate(latest?.date || todayISO()));
    const difference = Number.isFinite(latestTrend) && Number.isFinite(expectedToday) ? latestTrend - expectedToday : null;
    setInsightFact(1, "Esperado hoy", formatKg(expectedToday, 2));
    setInsightFact(2, "Diferencia", formatSignedKg(difference));
    setInsightFact(3, "Cambio total", first && latest ? formatSignedKg(latest.weight - first.weight) : "—");

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
    $("#chart-insight-meta").textContent = weighIns.length
      ? `${weighIns.length} pesajes entre ${formatDate(weighIns[0]?.date)} y ${formatDate(latest?.date)} · tendencia de ${state.profile.trendWindow} pesajes válidos`
      : "Todavía no hay pesajes suficientes.";
  }

  function automaticAdjustmentData(profile = state.profile, plan = calculatePlan(profile, state.weighIns), weighIns = state.weighIns) {
    const allLogged = Object.keys(state.diary || {}).sort().map(iso => {
      const totals = diaryTotalsForDate(iso);
      return {
        iso,
        date: parseDate(iso),
        calories: totals.calories,
        completed: Boolean(state.completedDays?.[iso]),
        hasEntries: (state.diary[iso] || []).length > 0
      };
    }).filter(day => day.date && day.hasEntries && Number.isFinite(day.calories) && day.calories > 0);

    if (!allLogged.length) {
      return { ready: false, reason: "Todavía no hay ingestas registradas.", intakeDays: 0, weighInCount: weighIns.length };
    }

    const latestDate = allLogged.at(-1).date;
    const recentStart = addDays(latestDate, -41);
    const recentLogged = allLogged.filter(day => day.date >= recentStart && day.date <= latestDate);
    const recentCompleted = recentLogged.filter(day => day.completed);
    const used = recentCompleted.length >= 14 ? recentCompleted : recentLogged;
    const completedOnly = recentCompleted.length >= 14;

    if (used.length < 14) {
      return {
        ready: false,
        reason: `Faltan ${14 - used.length} días de ingestas para una primera estimación.`,
        intakeDays: used.length,
        completedDays: recentCompleted.length,
        weighInCount: weighIns.length
      };
    }

    const firstDate = used[0].date;
    const lastDate = used.at(-1).date;
    const spanDays = Math.round(daysBetween(firstDate, lastDate)) + 1;
    if (spanDays < 18) {
      return {
        ready: false,
        reason: `Los registros todavía cubren solo ${spanDays} días. Se necesitan al menos 18 para separar ruido de tendencia.`,
        intakeDays: used.length,
        completedDays: recentCompleted.length,
        weighInCount: weighIns.length,
        spanDays
      };
    }

    const relatedWeighIns = [...weighIns].filter(item => {
      const date = parseDate(item.date);
      return date && date >= addDays(firstDate, -3) && date <= addDays(lastDate, 3);
    }).sort((a, b) => a.date.localeCompare(b.date));

    if (relatedWeighIns.length < 8) {
      return {
        ready: false,
        reason: `Hay ${relatedWeighIns.length} pesajes en el período. Se necesitan al menos 8.`,
        intakeDays: used.length,
        completedDays: recentCompleted.length,
        weighInCount: relatedWeighIns.length,
        spanDays
      };
    }

    const observedWeekly = regressionRatePerWeek(relatedWeighIns, 60);
    if (!Number.isFinite(observedWeekly) || !Number.isFinite(plan.targetCalories) || !Number.isFinite(plan.dailyAdjustment)) {
      return {
        ready: false,
        reason: "No se pudo calcular una tendencia estable con los datos actuales.",
        intakeDays: used.length,
        completedDays: recentCompleted.length,
        weighInCount: relatedWeighIns.length,
        spanDays
      };
    }

    const averageCalories = used.reduce((sum, day) => sum + day.calories, 0) / used.length;
    const observedMaintenance = averageCalories - observedWeekly * KG_KCAL / 7;
    if (!Number.isFinite(observedMaintenance) || observedMaintenance < 1000 || observedMaintenance > 6000) {
      return {
        ready: false,
        reason: "Los datos producen un mantenimiento fuera de un rango plausible. Revisá que los días estén completos y que los pesajes sean correctos.",
        intakeDays: used.length,
        completedDays: recentCompleted.length,
        weighInCount: relatedWeighIns.length,
        spanDays
      };
    }
    const recommendedTarget = observedMaintenance + plan.dailyAdjustment;
    const rawChange = recommendedTarget - plan.targetCalories;
    const limitedChange = clamp(Math.round(rawChange), -250, 250);
    const currentOffset = toNumber(profile.calibrationOffset, 0);
    const newOffset = clamp(currentOffset + limitedChange, -900, 900);
    const appliedChange = newOffset - currentOffset;
    const trends = rollingTrend(relatedWeighIns, profile.trendWindow);
    const latestTrend = trends.at(-1)?.trend ?? relatedWeighIns.at(-1)?.weight;

    return {
      ready: true,
      intakeDays: used.length,
      completedDays: recentCompleted.length,
      completedOnly,
      weighInCount: relatedWeighIns.length,
      spanDays,
      firstDate,
      lastDate,
      averageCalories,
      observedWeekly,
      observedMaintenance,
      currentTarget: plan.targetCalories,
      recommendedTarget,
      rawChange,
      appliedChange,
      newOffset,
      latest: relatedWeighIns.at(-1),
      latestTrend,
      limited: Math.abs(rawChange) > 250
    };
  }

  function buildRecalibrationSuggestion(profile, plan, weighIns) {
    const suggestion = automaticAdjustmentData(profile, plan, weighIns);
    if (!suggestion.ready || Math.abs(suggestion.appliedChange) < 50) return null;
    return suggestion;
  }

  function automaticAdjustmentSummary(suggestion) {
    if (!suggestion?.ready) return suggestion?.reason || "Todavía no hay datos suficientes.";
    const direction = suggestion.observedWeekly < 0 ? "bajando" : suggestion.observedWeekly > 0 ? "subiendo" : "estable";
    const changeText = Math.abs(suggestion.appliedChange) < 30
      ? "El objetivo actual ya está suficientemente cerca de lo observado."
      : `El objetivo pasaría de ${formatNumber(Math.round(suggestion.currentTarget))} a ${formatNumber(Math.round(suggestion.currentTarget + suggestion.appliedChange))} kcal por día (${suggestion.appliedChange > 0 ? "+" : ""}${formatNumber(suggestion.appliedChange)}).`;
    const sourceText = suggestion.completedOnly
      ? `${suggestion.intakeDays} días terminados`
      : `${suggestion.intakeDays} días con ingestas; completar los días mejora la confianza`;
    return `Con ${sourceText} y ${suggestion.weighInCount} pesajes, consumiste ${formatNumber(Math.round(suggestion.averageCalories))} kcal en promedio y el peso viene ${direction} ${formatNumber(Math.abs(suggestion.observedWeekly), 2)} kg/semana. El mantenimiento observado es de aproximadamente ${formatNumber(Math.round(suggestion.observedMaintenance))} kcal. ${changeText}${suggestion.limited ? " Por seguridad, MASA limita cada ajuste automático a 250 kcal." : ""}`;
  }

  function renderAutomaticAdjustmentPreview(profile, plan, weighIns = state.weighIns) {
    const suggestion = automaticAdjustmentData(profile, plan, weighIns);
    const summary = $("#automatic-adjustment-summary");
    const facts = $("#automatic-adjustment-facts");
    const button = $("#run-auto-adjustment");
    if (!summary || !facts || !button) return;
    summary.textContent = automaticAdjustmentSummary(suggestion);
    facts.innerHTML = `<div><span>Ingestas útiles</span><b>${suggestion.intakeDays || 0} días</b></div><div><span>Pesajes útiles</span><b>${suggestion.weighInCount || 0}</b></div><div><span>Período</span><b>${suggestion.spanDays || 0} días</b></div>`;
    button.disabled = !suggestion.ready || Math.abs(suggestion.appliedChange) < 30;
    button.textContent = suggestion.ready && Math.abs(suggestion.appliedChange) < 30 ? "Sin ajuste necesario" : "Ajustar automáticamente";
    return suggestion;
  }

  function applyAutomaticAdjustment(suggestion, profile = state.profile) {
    if (!suggestion?.ready || Math.abs(suggestion.appliedChange) < 30) return false;
    profile.calibrationOffset = suggestion.newOffset;
    profile.planStartDate = suggestion.latest?.date || todayISO();
    profile.planStartWeight = Number(toNumber(suggestion.latestTrend, suggestion.latest?.weight).toFixed(2));
    state.calibrationHistory = [...(state.calibrationHistory || []), {
      date: todayISO(),
      intakeDays: suggestion.intakeDays,
      weighInCount: suggestion.weighInCount,
      averageCalories: Math.round(suggestion.averageCalories),
      observedWeekly: Number(suggestion.observedWeekly.toFixed(3)),
      observedMaintenance: Math.round(suggestion.observedMaintenance),
      previousTarget: Math.round(suggestion.currentTarget),
      targetChange: suggestion.appliedChange,
      newOffset: suggestion.newOffset
    }].slice(-20);
    return true;
  }

  function runAutomaticAdjustment() {
    const form = $("#profile-form");
    const currentWeight = toNumber(form.elements.currentWeight.value, NaN);
    const draft = profileFromForm();
    const temporaryWeighIns = Number.isFinite(currentWeight)
      ? mergeWeighIns(state.weighIns, [{ date: todayISO(), weight: currentWeight }])
      : state.weighIns;
    const plan = calculatePlan(draft, temporaryWeighIns, currentWeight);
    const feedback = $("#automatic-adjustment-feedback");
    const validationError = validateProfile(draft, currentWeight);
    if (validationError) {
      setFeedback(feedback, `Antes de ajustar: ${validationError.message}`, true);
      focusProfileField(validationError.field);
      return;
    }
    const suggestion = automaticAdjustmentData(draft, plan, temporaryWeighIns);
    if (!suggestion.ready) {
      setFeedback(feedback, suggestion.reason, true);
      return;
    }
    if (Math.abs(suggestion.appliedChange) < 30) {
      setFeedback(feedback, "El objetivo actual ya está suficientemente cerca de lo observado.");
      return;
    }
    const nextTarget = Math.round(suggestion.currentTarget + suggestion.appliedChange);
    const accepted = window.confirm(`MASA propone llevar el objetivo diario a ${formatNumber(nextTarget)} kcal. El cálculo usa ${suggestion.intakeDays} días de ingestas y ${suggestion.weighInCount} pesajes. ¿Aplicar el ajuste?`);
    if (!accepted) return;
    state.weighIns = temporaryWeighIns;
    state.profile = draft;
    applyAutomaticAdjustment(suggestion, state.profile);
    state.configured = true;
    saveState(state);
    fillProfileForm();
    updateProfilePreview();
    setFeedback(feedback, `Ajuste aplicado. Nuevo objetivo aproximado: ${formatNumber(nextTarget)} kcal por día.`);
    render();
  }

  function renderRecalibration(profile, plan, weighIns) {
    recalibrationSuggestion = buildRecalibrationSuggestion(profile, plan, weighIns);
    const panel = $("#recalibration-panel");
    panel.hidden = !recalibrationSuggestion;
    if (!recalibrationSuggestion) return;
    $("#recalibration-title").textContent = `${profile.name ? `${profile.name}, tus` : "Tus"} registros permiten recalibrar el objetivo.`;
    $("#recalibration-text").textContent = automaticAdjustmentSummary(recalibrationSuggestion);
  }

  function applyRecalibration() {
    if (!recalibrationSuggestion) return;
    if (!applyAutomaticAdjustment(recalibrationSuggestion, state.profile)) return;
    saveState(state);
    render();
  }

  function latestChartDate(payload) {
    const dates = [
      ...payload.weighIns.map(item => item.date),
      ...Object.keys(state.diary || {})
    ].map(parseDate).filter(Boolean);
    return dates.length ? new Date(Math.max(...dates.map(date => date.getTime()))) : parseDate(todayISO());
  }

  function chartBounds(payload, includeFuture = false) {
    if (chartRange === "all") return { start: null, end: null };
    const months = { "1m": 1, "3m": 3, "6m": 6 }[chartRange] || 3;
    const latest = latestChartDate(payload);
    return {
      start: addMonths(latest, -months),
      end: includeFuture ? addMonths(latest, months) : latest
    };
  }

  function withinBounds(date, bounds) {
    return date && (!bounds.start || date >= bounds.start) && (!bounds.end || date <= bounds.end);
  }

  function calorieDaysForBounds(bounds) {
    return Object.keys(state.diary || {}).sort().map(iso => {
      const date = parseDate(iso);
      const totals = diaryTotalsForDate(iso);
      return {
        date,
        iso,
        calories: totals.calories,
        hasEntries: (state.diary[iso] || []).length > 0,
        completed: Boolean(state.completedDays?.[iso])
      };
    }).filter(day => day.hasEntries && withinBounds(day.date, bounds));
  }

  function buildCalorieAnalysis(plan, weighIns, days) {
    const logged = (days || []).filter(day => day.hasEntries && Number.isFinite(day.calories));
    const completed = logged.filter(day => day.completed);
    const used = completed.length >= 3 ? completed : logged;
    if (!used.length || !Number.isFinite(plan.targetCalories)) {
      return { logged, used, completedOnly: false, average: null, difference: null, observedWeekly: null, spanDays: 0, remainingReviewDays: 21 };
    }

    const average = used.reduce((sum, day) => sum + day.calories, 0) / used.length;
    const difference = average - plan.targetCalories;
    const firstDate = used[0].date;
    const lastDate = used.at(-1).date;
    const spanDays = Math.max(1, Math.round(daysBetween(firstDate, lastDate)) + 1);
    const relatedWeighIns = weighIns.filter(item => {
      const date = parseDate(item.date);
      return date >= addDays(firstDate, -4) && date <= addDays(lastDate, 4);
    });
    const observedWeekly = regressionRatePerWeek(relatedWeighIns, 100);
    const estimatedMaintenance = Number.isFinite(observedWeekly)
      ? average - observedWeekly * KG_KCAL / 7
      : null;
    const recommendedTarget = Number.isFinite(estimatedMaintenance) && Number.isFinite(plan.dailyAdjustment)
      ? estimatedMaintenance + plan.dailyAdjustment
      : null;
    const targetAdjustment = Number.isFinite(recommendedTarget)
      ? recommendedTarget - plan.targetCalories
      : null;

    return {
      logged,
      used,
      completedOnly: completed.length >= 3,
      average,
      difference,
      observedWeekly,
      estimatedMaintenance,
      recommendedTarget,
      targetAdjustment,
      spanDays,
      remainingReviewDays: Math.max(0, 21 - spanDays),
      firstDate,
      lastDate,
      weighInCount: relatedWeighIns.length
    };
  }

  function relationshipSamples(payload) {
    const bounds = chartBounds(payload, false);
    const trends = payload.trends.filter(item => withinBounds(parseDate(item.date), bounds));
    const samples = [];
    trends.forEach((current, index) => {
      if (index === 0) return;
      const currentDate = parseDate(current.date);
      let prior = null;
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const candidate = trends[cursor];
        const elapsed = daysBetween(parseDate(candidate.date), currentDate);
        if (elapsed >= 5) { prior = candidate; break; }
      }
      if (!prior) return;
      const priorDate = parseDate(prior.date);
      const elapsed = daysBetween(priorDate, currentDate);
      if (elapsed > 16) return;
      const diaryDays = calorieDaysForBounds({ start: addDays(priorDate, 1), end: currentDate });
      if (diaryDays.length < 3 || !Number.isFinite(payload.plan.targetCalories)) return;
      const averageCalories = diaryDays.reduce((sum, day) => sum + day.calories, 0) / diaryDays.length;
      const weeklyWeightChange = (current.trend - prior.trend) * 7 / elapsed;
      if (samples.length && daysBetween(samples.at(-1).date, currentDate) < 5) return;
      samples.push({
        date: currentDate,
        calorieDifference: averageCalories - payload.plan.targetCalories,
        weeklyWeightChange,
        loggedDays: diaryDays.length
      });
    });
    return samples;
  }

  function correlationCoefficient(points) {
    if (points.length < 3) return null;
    const meanX = points.reduce((sum, point) => sum + point.calorieDifference, 0) / points.length;
    const meanY = points.reduce((sum, point) => sum + point.weeklyWeightChange, 0) / points.length;
    const numerator = points.reduce((sum, point) => sum + (point.calorieDifference - meanX) * (point.weeklyWeightChange - meanY), 0);
    const denomX = Math.sqrt(points.reduce((sum, point) => sum + (point.calorieDifference - meanX) ** 2, 0));
    const denomY = Math.sqrt(points.reduce((sum, point) => sum + (point.weeklyWeightChange - meanY) ** 2, 0));
    return denomX && denomY ? numerator / (denomX * denomY) : null;
  }

  function configureProgressChart(kind) {
    const copy = {
      weight: {
        eyebrow: "PLAN VS REALIDAD",
        title: "Tu peso real frente al camino previsto.",
        description: "La línea sólida muestra la tendencia real. La punteada conserva el plan original.",
        legend: ["Peso real", "Tendencia", "Plan", "Objetivo"],
        classes: ["legend-real", "legend-trend", "legend-plan", "legend-goal"]
      },
      calories: {
        eyebrow: "CONSUMO VS OBJETIVO",
        title: "Las calorías que registrás frente al número del plan.",
        description: "El promedio se calcula con días terminados cuando hay suficientes; de lo contrario usa todos los días con ingestas.",
        legend: ["Consumidas", "Objetivo", "", ""],
        classes: ["legend-trend", "legend-plan", "", ""]
      },
      relationship: {
        eyebrow: "ENERGÍA VS CAMBIO",
        title: "Cómo se mueve el peso según las calorías registradas.",
        description: "Cada punto resume un período: calorías sobre o bajo el objetivo y variación de tendencia en kg por semana.",
        legend: ["Cada punto = un período", "Centro = objetivo", "", ""],
        classes: ["legend-trend", "legend-goal", "", ""]
      }
    }[kind];
    $("#progress-chart-eyebrow").textContent = copy.eyebrow;
    $("#progress-chart-title").textContent = copy.title;
    $("#progress-chart-description").textContent = copy.description;
    copy.legend.forEach((label, index) => {
      const element = $(`#progress-legend-${index + 1}`);
      element.textContent = label;
      element.hidden = !label;
      element.className = copy.classes[index] || "";
    });
    $$('[data-progress-chart]').forEach(button => button.classList.toggle("active", button.dataset.progressChart === kind));
  }

  function renderCalorieInsight(payload) {
    $(".progress-model-data").hidden = true;
    const days = calorieDaysForBounds(chartBounds(payload, false));
    const analysis = buildCalorieAnalysis(payload.plan, payload.weighIns, days);
    if (!Number.isFinite(analysis.average)) {
      setInsightFact(1, "Promedio", "—");
      setInsightFact(2, "Diferencia", "—");
      setInsightFact(3, "Ritmo de peso", "—");
      $("#chart-insight-title").textContent = "Faltan días comparables.";
      $("#chart-insight").textContent = "Registrá ingestas en varios días y algunos pesajes dentro del mismo período para comparar consumo, objetivo y cambio de peso.";
      $("#chart-insight-meta").textContent = "La lectura mejora al terminar los días y registrar el peso con cierta regularidad.";
      return;
    }

    const diff = analysis.difference;
    const weightRate = analysis.observedWeekly;
    setInsightFact(1, "Promedio", `${formatNumber(Math.round(analysis.average))} kcal`);
    setInsightFact(2, "Diferencia", `${diff > 0 ? "+" : ""}${formatNumber(Math.round(diff))} kcal`);
    setInsightFact(3, "Ritmo de peso", Number.isFinite(weightRate) ? `${weightRate > 0 ? "+" : ""}${formatNumber(weightRate, 2)} kg/sem` : "Faltan pesajes");

    const intakePhrase = Math.abs(diff) < 50
      ? "estás prácticamente en el objetivo"
      : `consumís en promedio ${formatNumber(Math.abs(Math.round(diff)))} kcal ${diff > 0 ? "más" : "menos"} que el objetivo`;
    const weightPhrase = !Number.isFinite(weightRate)
      ? "todavía no hay suficientes pesajes del mismo período"
      : Math.abs(weightRate) < 0.05
        ? "el peso se mantiene prácticamente estable"
        : `el peso ${weightRate < 0 ? "sigue bajando" : "sigue subiendo"} a ${formatNumber(Math.abs(weightRate), 2)} kg por semana`;

    $("#chart-insight-title").textContent = `${intakePhrase.charAt(0).toUpperCase()}${intakePhrase.slice(1)}.`;
    let text = `${intakePhrase}, y ${weightPhrase}.`;
    if (Number.isFinite(analysis.targetAdjustment) && analysis.weighInCount >= 3) {
      const roundedAdjustment = Math.round(analysis.targetAdjustment / 25) * 25;
      if (Math.abs(roundedAdjustment) < 50) {
        text += " El objetivo actual está razonablemente alineado con lo observado; no aparece un ajuste relevante por ahora.";
      } else if (analysis.remainingReviewDays > 0) {
        text += ` Si este patrón se mantiene unos ${analysis.remainingReviewDays} días más, tendría sentido revisar el objetivo en aproximadamente ${roundedAdjustment > 0 ? "+" : ""}${formatNumber(roundedAdjustment)} kcal por día.`;
      } else {
        text += ` El período ya alcanza tres semanas: el modelo sugiere revisar el objetivo en aproximadamente ${roundedAdjustment > 0 ? "+" : ""}${formatNumber(roundedAdjustment)} kcal por día, antes de aplicar cambios automáticamente.`;
      }
    } else {
      const remaining = Math.max(1, analysis.remainingReviewDays);
      text += ` Mantené registros durante aproximadamente ${remaining} días más junto con pesajes para estimar si el objetivo necesita una corrección.`;
    }
    $("#chart-insight").textContent = text;
    $("#chart-insight-meta").textContent = `${analysis.used.length} días usados · ${analysis.completedOnly ? "solo días terminados" : "días con alguna ingesta"} · período de ${analysis.spanDays} días`;
  }

  function renderRelationshipInsight(payload) {
    $(".progress-model-data").hidden = true;
    const samples = relationshipSamples(payload);
    const correlation = correlationCoefficient(samples);
    if (!samples.length) {
      setInsightFact(1, "Períodos", "0");
      setInsightFact(2, "Desvío medio", "—");
      setInsightFact(3, "Cambio medio", "—");
      $("#chart-insight-title").textContent = "Todavía no se pueden cruzar los datos.";
      $("#chart-insight").textContent = "Hacen falta varios períodos que contengan tanto ingestas como pesajes. La gráfica usa ventanas de aproximadamente una semana para reducir el ruido diario.";
      $("#chart-insight-meta").textContent = "Como referencia, tres o cuatro semanas completas empiezan a producir una lectura útil.";
      return;
    }
    const averageDifference = samples.reduce((sum, item) => sum + item.calorieDifference, 0) / samples.length;
    const averageChange = samples.reduce((sum, item) => sum + item.weeklyWeightChange, 0) / samples.length;
    setInsightFact(1, "Períodos", String(samples.length));
    setInsightFact(2, "Desvío medio", `${averageDifference > 0 ? "+" : ""}${formatNumber(Math.round(averageDifference))} kcal`);
    setInsightFact(3, "Cambio medio", `${averageChange > 0 ? "+" : ""}${formatNumber(averageChange, 2)} kg/sem`);

    if (!Number.isFinite(correlation) || samples.length < 4) {
      $("#chart-insight-title").textContent = "La relación empieza a aparecer.";
      $("#chart-insight").textContent = "Ya existen períodos comparables, pero todavía son pocos para describir una relación estable entre el desvío calórico y la variación de peso.";
    } else {
      const strength = Math.abs(correlation) < 0.25 ? "débil" : Math.abs(correlation) < 0.55 ? "moderada" : "marcada";
      const direction = correlation > 0
        ? "los períodos con más calorías tienden a acompañarse de una variación de peso más alta"
        : "los períodos con más calorías no se están reflejando todavía en una variación de peso más alta";
      $("#chart-insight-title").textContent = `Relación ${strength} en tus datos.`;
      $("#chart-insight").textContent = `En estos períodos, ${direction}. Es una asociación descriptiva y no demuestra causalidad: agua, horarios y días incompletos pueden mover mucho el resultado.`;
    }
    $("#chart-insight-meta").textContent = `${samples.length} períodos comparables · cada punto exige al menos 3 días con ingestas entre dos tendencias de peso`;
  }

  function renderActiveProgressChart() {
    if (!chartPayload) return;
    configureProgressChart(activeProgressChart);
    const canvas = $("#progress-chart");
    let hasData = false;
    if (activeProgressChart === "calories") {
      hasData = drawProgressCalorieChart(canvas, chartPayload);
      renderCalorieInsight(chartPayload);
    } else if (activeProgressChart === "relationship") {
      hasData = drawRelationshipChart(canvas, chartPayload);
      renderRelationshipInsight(chartPayload);
    } else {
      hasData = drawWeightChart(canvas, chartPayload);
      renderWeightInsight(chartPayload.profile, chartPayload.plan, chartPayload.weighIns, chartPayload.trends, chartPayload.observedWeekly);
    }
    $("#progress-chart-empty").hidden = hasData;
  }

  function changeProgressChart(direction) {
    const order = ["weight", "calories", "relationship"];
    const index = order.indexOf(activeProgressChart);
    activeProgressChart = order[(index + direction + order.length) % order.length];
    renderActiveProgressChart();
  }

  function renderCharts(profile, plan, weighIns, trends, observedWeekly) {
    const planProjection = [];
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
    chartPayload = { profile, plan, weighIns, trends, planProjection, observedWeekly };
    renderActiveProgressChart();
  }

  function visibleChartPoints(payload) {
    const bounds = chartBounds(payload, true);
    const within = item => withinBounds(parseDate(item.date), bounds);
    return {
      weighIns: payload.weighIns.filter(within),
      trends: payload.trends.filter(within),
      planProjection: payload.planProjection.filter(within),
      start: bounds.start,
      end: bounds.end
    };
  }

  function prepareCanvas(canvas) {
    if (!canvas) return null;
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
    if (!prepared) return payload.weighIns.length >= 2;
    const { ctx, width, height } = prepared;
    ctx.clearRect(0, 0, width, height);
    const visible = visibleChartPoints(payload);
    const series = [
      ...visible.weighIns.map(item => ({ date: parseDate(item.date), value: item.weight })),
      ...visible.planProjection.map(item => ({ date: parseDate(item.date), value: item.weight }))
    ].filter(item => item.date && Number.isFinite(item.value));
    if (series.length < 2) return false;

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
    return true;
  }

  function drawProgressCalorieChart(canvas, payload) {
    const bounds = chartBounds(payload, false);
    const days = calorieDaysForBounds(bounds);
    const prepared = prepareCanvas(canvas);
    if (!prepared) return days.length > 0;
    const { ctx, width, height } = prepared;
    ctx.clearRect(0, 0, width, height);
    if (!days.length || !Number.isFinite(payload.plan.targetCalories)) return false;
    const target = payload.plan.targetCalories;
    const maxValue = Math.max(target, ...days.map(day => day.calories), 500) * 1.12;
    const margin = { left: 52, right: 18, top: 22, bottom: 40 };
    const minDate = bounds.start?.getTime() ?? days[0].date.getTime();
    const maxDate = bounds.end?.getTime() ?? days.at(-1).date.getTime();
    const x = date => margin.left + (date.getTime() - minDate) / Math.max(DAY_MS, maxDate - minDate) * (width - margin.left - margin.right);
    const y = value => margin.top + (maxValue - value) / maxValue * (height - margin.top - margin.bottom);
    const available = width - margin.left - margin.right;
    const barWidth = Math.max(3, Math.min(22, available / Math.max(days.length * 1.7, 12)));

    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i += 1) {
      const value = maxValue * i / 4;
      const py = y(value);
      ctx.strokeStyle = "rgba(242,239,230,.12)";
      ctx.beginPath(); ctx.moveTo(margin.left, py); ctx.lineTo(width - margin.right, py); ctx.stroke();
      ctx.fillStyle = "rgba(242,239,230,.52)";
      ctx.fillText(formatNumber(value, 0), margin.left - 7, py);
    }

    ctx.save();
    ctx.strokeStyle = "#ff6b52";
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.beginPath(); ctx.moveTo(margin.left, y(target)); ctx.lineTo(width - margin.right, y(target)); ctx.stroke();
    ctx.restore();

    days.forEach(day => {
      const px = x(day.date);
      const top = y(day.calories);
      ctx.fillStyle = day.completed ? "#c8ff46" : "#8d7cff";
      ctx.fillRect(px - barWidth / 2, top, barWidth, y(0) - top);
    });

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i <= 5; i += 1) {
      const date = new Date(minDate + (maxDate - minDate) * i / 5);
      ctx.fillStyle = "rgba(242,239,230,.48)";
      ctx.fillText(new Intl.DateTimeFormat("es-UY", { month: "short", day: chartRange === "1m" ? "2-digit" : undefined }).format(date), x(date), height - margin.bottom + 10);
    }
    return true;
  }

  function drawRelationshipChart(canvas, payload) {
    const samples = relationshipSamples(payload);
    const prepared = prepareCanvas(canvas);
    if (!prepared) return samples.length > 0;
    const { ctx, width, height } = prepared;
    ctx.clearRect(0, 0, width, height);
    if (!samples.length) return false;
    const margin = { left: 58, right: 22, top: 24, bottom: 48 };
    let minX = Math.min(0, ...samples.map(item => item.calorieDifference));
    let maxX = Math.max(0, ...samples.map(item => item.calorieDifference));
    let minY = Math.min(0, ...samples.map(item => item.weeklyWeightChange));
    let maxY = Math.max(0, ...samples.map(item => item.weeklyWeightChange));
    const padX = Math.max(100, (maxX - minX) * .15);
    const padY = Math.max(.12, (maxY - minY) * .18);
    minX -= padX; maxX += padX; minY -= padY; maxY += padY;
    const x = value => margin.left + (value - minX) / Math.max(1, maxX - minX) * (width - margin.left - margin.right);
    const y = value => margin.top + (maxY - value) / Math.max(.01, maxY - minY) * (height - margin.top - margin.bottom);

    ctx.font = "10px ui-monospace, monospace";
    for (let i = 0; i <= 4; i += 1) {
      const xv = minX + (maxX - minX) * i / 4;
      const yv = minY + (maxY - minY) * i / 4;
      ctx.strokeStyle = "rgba(242,239,230,.1)";
      ctx.beginPath(); ctx.moveTo(x(xv), margin.top); ctx.lineTo(x(xv), height - margin.bottom); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(margin.left, y(yv)); ctx.lineTo(width - margin.right, y(yv)); ctx.stroke();
      ctx.fillStyle = "rgba(242,239,230,.5)";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(`${xv > 0 ? "+" : ""}${formatNumber(xv, 0)}`, x(xv), height - margin.bottom + 9);
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText(`${yv > 0 ? "+" : ""}${formatNumber(yv, 2)}`, margin.left - 8, y(yv));
    }
    ctx.strokeStyle = "rgba(255,107,82,.82)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x(0), margin.top); ctx.lineTo(x(0), height - margin.bottom); ctx.stroke();
    ctx.strokeStyle = "rgba(141,124,255,.82)";
    ctx.beginPath(); ctx.moveTo(margin.left, y(0)); ctx.lineTo(width - margin.right, y(0)); ctx.stroke();

    samples.forEach(point => {
      ctx.beginPath();
      ctx.arc(x(point.calorieDifference), y(point.weeklyWeightChange), 5, 0, Math.PI * 2);
      ctx.fillStyle = point.calorieDifference > 0 ? "#ff6b52" : "#c8ff46";
      ctx.fill();
      ctx.strokeStyle = "#10131a";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
    ctx.fillStyle = "rgba(242,239,230,.55)";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText("kcal/día frente al objetivo", margin.left + (width - margin.left - margin.right) / 2, height - 3);
    return true;
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
    form.elements.macroMode.value = profile.macroMode || "athletic";
    const currentPlan = calculatePlan(profile, state.weighIns);
    form.elements.proteinPct.value = profile.macroMode === "custom" ? Math.round(profile.proteinPct) : 20;
    form.elements.fatPct.value = profile.macroMode === "custom" ? Math.round(profile.fatPct) : 30;
    form.elements.carbPct.value = profile.macroMode === "custom" ? Math.round(profile.carbPct) : 50;
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

    const customMacros = form.elements.macroMode.value === "custom";
    $("#custom-macro-fields").hidden = !customMacros;
    $("#macro-sum-line").hidden = !customMacros;
    const sum = ["proteinPct","fatPct","carbPct"].reduce((total, name) => total + toNumber(form.elements[name].value, 0), 0);
    $("#macro-percent-sum").textContent = `${formatNumber(sum,0)}%`;
    $("#macro-percent-sum").closest(".macro-sum-line").classList.toggle("invalid", customMacros && Math.abs(sum - 100) > 0.01);
    const modeLabels = { balanced: "balanceado", athletic: "atlético", custom: "personalizado" };
    $("#macro-mode-label").textContent = modeLabels[form.elements.macroMode.value] || "atlético";
  }

  function updateProfilePreview(event) {
    const form = $("#profile-form");
    if (!fillingProfileForm && event?.target?.matches('[name="proteinPct"],[name="fatPct"],[name="carbPct"]')) {
      form.elements.macroMode.value = "custom";
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
    renderAutomaticAdjustmentPreview(draft, plan, temporaryWeighIns);
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
    if (profile.macroMode === "balanced") {
      box.textContent = "Balanceado: 20% de proteína, 30% de grasas y 50% de carbohidratos. Replica una distribución general por porcentajes.";
      return;
    }
    if (profile.macroMode === "athletic") {
      box.textContent = `Atlético: ${formatNumber(plan.macroRule.proteinPerKg, 1)} g/kg de proteína, ${formatNumber(plan.macroRule.effectiveFatPerKg, 1)} g/kg de grasas y carbohidratos con las calorías restantes.`;
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
    if (profile.macroMode === "custom") {
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
    const date = selectedDiaryDate;
    if (!Number.isFinite(weight) || weight <= 0 || !date) {
      setFeedback($("#weight-feedback"), "Revisá el peso.", true);
      return;
    }
    state.weighIns = mergeWeighIns(state.weighIns, [{ date, weight }]);
    saveState(state);
    weightEditorForced = false;
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

  let xlsxLoader = null;

  async function loadXLSX() {
    if (globalThis.XLSX) return globalThis.XLSX;
    if (!xlsxLoader) {
      xlsxLoader = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
        script.async = true;
        script.onload = () => globalThis.XLSX ? resolve(globalThis.XLSX) : reject(new Error("El módulo de Excel no quedó disponible."));
        script.onerror = () => reject(new Error("No se pudo cargar el módulo de Excel. Revisá la conexión y volvé a intentarlo."));
        document.head.appendChild(script);
      }).catch(error => {
        xlsxLoader = null;
        throw error;
      });
    }
    return xlsxLoader;
  }

  function spreadsheetDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return toISODate(value);
    if (typeof value === "number" && globalThis.XLSX?.SSF?.parse_date_code) {
      const parsed = globalThis.XLSX.SSF.parse_date_code(value);
      if (parsed) return normalizeDate(`${parsed.d}/${parsed.m}/${parsed.y}`);
    }
    return normalizeDate(value);
  }

  async function spreadsheetRows(file, preferredNames = []) {
    const XLSX = await loadXLSX();
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const sheetName = preferredNames.find(name => workbook.SheetNames.includes(name)) || workbook.SheetNames[0];
    if (!sheetName) return [];
    return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: true });
  }

  function findColumn(row, aliases) {
    const entries = Object.keys(row || {}).map(key => [key, normalizeHeader(key)]);
    return entries.find(([, normalized]) => aliases.some(alias => normalized === alias || (alias.length >= 4 && normalized.includes(alias))))?.[0] || null;
  }

  function parseWeightRows(rows) {
    if (!Array.isArray(rows) || !rows.length) return [];
    const sample = rows.find(row => row && Object.keys(row).length) || {};
    const dateKey = findColumn(sample, ["fecha", "date", "dia"]);
    const weightKey = findColumn(sample, ["pesokg", "peso", "weight", "kg"]);
    if (!dateKey || !weightKey) return [];
    return rows.map(row => ({ date: spreadsheetDate(row[dateKey]), weight: toNumber(row[weightKey], NaN) }))
      .filter(item => item.date && Number.isFinite(item.weight) && item.weight > 0);
  }

  function mealFromValue(value) {
    const normalized = normalizeHeader(value);
    if (["desayuno", "breakfast"].includes(normalized)) return "breakfast";
    if (["almuerzo", "lunch"].includes(normalized)) return "lunch";
    if (["merienda", "snack", "afternoonsnack"].includes(normalized)) return "snack";
    if (["cena", "dinner"].includes(normalized)) return "dinner";
    return "extras";
  }

  function spreadsheetBoolean(value) {
    const normalized = normalizeHeader(value);
    return value === true || value === 1 || ["si", "yes", "true", "terminado", "completo"].includes(normalized);
  }

  function parseIntakeRows(rows) {
    if (!Array.isArray(rows) || !rows.length) return [];
    const sample = rows.find(row => row && Object.keys(row).length) || {};
    const keys = {
      id: findColumn(sample, ["id"]),
      date: findColumn(sample, ["fecha", "date", "dia"]),
      meal: findColumn(sample, ["comida", "meal"]),
      name: findColumn(sample, ["descripcion", "alimento", "nombre", "food"]),
      serving: findColumn(sample, ["porcion", "serving"]),
      calories: findColumn(sample, ["calorias", "calories", "kcal"]),
      protein: findColumn(sample, ["proteinag", "proteina", "protein"]),
      fat: findColumn(sample, ["grasasg", "grasa", "grasas", "fat"]),
      carbs: findColumn(sample, ["carbohidratosg", "carbohidratos", "carbs"]),
      completed: findColumn(sample, ["diaterminado", "terminado", "completed"])
    };
    if (!keys.date || !keys.name || !keys.calories) return [];
    return rows.map(row => {
      const entry = normalizeDiaryEntry({
        id: String(keys.id ? row[keys.id] : "").trim() || createId(),
        name: row[keys.name],
        calories: row[keys.calories],
        protein: keys.protein ? row[keys.protein] : 0,
        fat: keys.fat ? row[keys.fat] : 0,
        carbs: keys.carbs ? row[keys.carbs] : 0,
        serving: keys.serving ? row[keys.serving] : "1 porción",
        meal: mealFromValue(keys.meal ? row[keys.meal] : "")
      });
      return entry ? { date: spreadsheetDate(row[keys.date]), entry, completed: keys.completed ? spreadsheetBoolean(row[keys.completed]) : false } : null;
    }).filter(item => item?.date);
  }

  function replaceDiaryEntry(date, entry) {
    Object.keys(state.diary).forEach(key => {
      state.diary[key] = (state.diary[key] || []).filter(item => item.id !== entry.id);
      if (!state.diary[key].length) delete state.diary[key];
    });
    state.diary[date] = [...(state.diary[date] || []), entry];
  }

  async function exportIntakes() {
    try {
      const XLSX = await loadXLSX();
      const rows = [];
      Object.keys(state.diary).sort().forEach(date => {
        (state.diary[date] || []).forEach(item => rows.push({
          ID: item.id,
          Fecha: parseDate(date),
          Comida: mealLabel(item.meal),
          "Descripción": item.name,
          "Porción": item.serving || "1 porción",
          "Calorías": toNumber(item.calories, 0),
          "Proteína (g)": toNumber(item.protein, 0),
          "Grasas (g)": toNumber(item.fat, 0),
          "Carbohidratos (g)": toNumber(item.carbs, 0),
          "Día terminado": state.completedDays?.[date] ? "Sí" : "No"
        }));
      });
      const allDates = [...new Set([...Object.keys(state.diary), ...Object.keys(state.completedDays || {})])].sort();
      const summary = allDates.map(date => {
        const totals = diaryTotalsForDate(date);
        return {
          Fecha: parseDate(date),
          Calorías: Math.round(totals.calories),
          "Proteína (g)": Number(totals.protein.toFixed(1)),
          "Grasas (g)": Number(totals.fat.toFixed(1)),
          "Carbohidratos (g)": Number(totals.carbs.toFixed(1)),
          "Día terminado": state.completedDays?.[date] ? "Sí" : "No"
        };
      });
      const workbook = XLSX.utils.book_new();
      const recordsSheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ ID: "", Fecha: "", Comida: "", "Descripción": "", "Porción": "", "Calorías": "", "Proteína (g)": "", "Grasas (g)": "", "Carbohidratos (g)": "", "Día terminado": "" }], { cellDates: true });
      recordsSheet["!cols"] = [{wch:38},{wch:13},{wch:14},{wch:34},{wch:18},{wch:11},{wch:14},{wch:12},{wch:18},{wch:16}];
      recordsSheet["!autofilter"] = { ref: recordsSheet["!ref"] };
      const recordsRange = XLSX.utils.decode_range(recordsSheet["!ref"]);
      for (let row = 1; row <= recordsRange.e.r; row += 1) {
        const cell = recordsSheet[XLSX.utils.encode_cell({ r: row, c: 1 })];
        if (cell) cell.z = "dd/mm/yyyy";
      }
      const summarySheet = XLSX.utils.json_to_sheet(summary.length ? summary : [{ Fecha: "", Calorías: "", "Proteína (g)": "", "Grasas (g)": "", "Carbohidratos (g)": "", "Día terminado": "" }], { cellDates: true });
      summarySheet["!cols"] = [{wch:13},{wch:12},{wch:14},{wch:12},{wch:18},{wch:16}];
      summarySheet["!autofilter"] = { ref: summarySheet["!ref"] };
      const summaryRange = XLSX.utils.decode_range(summarySheet["!ref"]);
      for (let row = 1; row <= summaryRange.e.r; row += 1) {
        const cell = summarySheet[XLSX.utils.encode_cell({ r: row, c: 0 })];
        if (cell) cell.z = "dd/mm/yyyy";
      }
      XLSX.utils.book_append_sheet(workbook, recordsSheet, "Registros");
      XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumen diario");
      XLSX.writeFile(workbook, `consumo-masa-${todayISO()}.xlsx`, { compression: true });
    } catch (error) {
      window.alert(error.message || "No se pudo exportar el consumo.");
    }
  }

  async function handleIntakeImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      let rows;
      if (/\.(xlsx|xls)$/i.test(file.name)) rows = await spreadsheetRows(file, ["Registros"]);
      else rows = parseDelimitedObjects(await file.text());
      const imported = parseIntakeRows(rows);
      if (!imported.length) throw new Error("No se encontraron filas válidas de ingestas.");
      imported.forEach(({ date, entry, completed }) => {
        replaceDiaryEntry(date, entry);
        if (completed) state.completedDays[date] = true;
      });
      saveState(state);
      setSelectedDiaryDate(imported.at(-1).date);
      switchAppView("today");
      window.alert(`Se importaron ${imported.length} ingestas.`);
    } catch (error) {
      window.alert(error.message || "No se pudo importar el consumo.");
    } finally {
      event.target.value = "";
    }
  }

  function parseDelimitedObjects(text) {
    const clean = String(text || "").replace(/^\uFEFF/, "").trim();
    if (!clean) return [];
    const lines = clean.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return [];
    const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
    const headers = splitDelimited(lines[0], delimiter);
    return lines.slice(1).map(line => {
      const values = splitDelimited(line, delimiter);
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    });
  }

  function openImport(mode) {
    importMode = mode;
    const input = $("#import-file");
    input.value = "";
    input.accept = mode === "profile" ? ".json,application/json" : ".xlsx,.xls,.csv,.tsv,.txt,.json";
    input.click();
  }

  async function handleImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        if (importMode === "profile") throw new Error("El perfil completo se importa desde un archivo JSON exportado por MASA.");
        const weights = parseWeightRows(await spreadsheetRows(file, ["Pesajes"]));
        if (!weights.length) throw new Error("No se encontraron columnas de fecha y peso en la planilla.");
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
        return;
      }

      const text = await file.text();
      const isJson = file.name.toLowerCase().endsWith(".json") || text.trim().startsWith("{") || text.trim().startsWith("[");
      if (isJson) {
        const parsed = JSON.parse(text);
        const imported = normalizeState(parsed);
        if (importMode === "profile") {
          if (!profileIsComplete(imported.profile, imported.weighIns)) {
            throw new Error("El archivo no contiene un perfil completo válido de MASA.");
          }
          state = saveState({ ...imported, configured: true });
          settingsRequired = false;
          $("#settings-modal").hidden = true;
          document.body.classList.remove("modal-open");
          render();
          return;
        }
        if (imported.weighIns.length) {
          state.weighIns = mergeWeighIns(state.weighIns, imported.weighIns);
          state.configured = profileIsComplete(state.profile, state.weighIns);
          saveState(state);
          render();
          if (!state.configured) openSettings(true, "profile");
          else switchSettingsTab("weights");
          return;
        }
        throw new Error("No se encontraron pesajes válidos.");
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
    } finally {
      event.target.value = "";
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

  async function exportWeights() {
    try {
      const XLSX = await loadXLSX();
      const rows = sortedWeighIns().map(item => ({
        Fecha: parseDate(item.date),
        "Peso (kg)": toNumber(item.weight, 0)
      }));
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Fecha: "", "Peso (kg)": "" }], { cellDates: true });
      sheet["!cols"] = [{ wch: 14 }, { wch: 14 }];
      sheet["!autofilter"] = { ref: sheet["!ref"] };
      const range = XLSX.utils.decode_range(sheet["!ref"]);
      for (let row = 1; row <= range.e.r; row += 1) {
        const dateCell = sheet[XLSX.utils.encode_cell({ r: row, c: 0 })];
        if (dateCell) dateCell.z = "dd/mm/yyyy";
        const weightCell = sheet[XLSX.utils.encode_cell({ r: row, c: 1 })];
        if (weightCell) weightCell.z = "0.0";
      }
      XLSX.utils.book_append_sheet(workbook, sheet, "Pesajes");
      XLSX.writeFile(workbook, `pesajes-masa-${todayISO()}.xlsx`, { compression: true });
    } catch (error) {
      window.alert(error.message || "No se pudieron exportar los pesajes.");
    }
  }

  function exportHistory() {
    downloadText("datos-masa.json", JSON.stringify({ ...state, version: 10 }, null, 2), "application/json");
  }

  function exportBackup() {
    downloadText(`perfil-completo-masa-${todayISO()}.json`, JSON.stringify({ ...state, version: 10 }, null, 2), "application/json");
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

  function showHelpTooltip(button) {
    const tooltip = $("#floating-tooltip");
    if (!tooltip || !button?.dataset.tooltip) return;
    tooltip.textContent = button.dataset.tooltip;
    tooltip.hidden = false;
    const rect = button.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const margin = 10;
    let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
    left = clamp(left, margin, window.innerWidth - tooltipRect.width - margin);
    let top = rect.top - tooltipRect.height - 10;
    if (top < margin) top = rect.bottom + 10;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.dataset.owner = button.id || button.getAttribute("aria-label") || "help";
  }

  function hideHelpTooltip() {
    const tooltip = $("#floating-tooltip");
    if (tooltip) tooltip.hidden = true;
  }

  function bindHelpTooltips() {
    $$(".help-dot[data-tooltip]").forEach(button => {
      button.addEventListener("mouseenter", () => showHelpTooltip(button));
      button.addEventListener("focus", () => showHelpTooltip(button));
      button.addEventListener("mouseleave", hideHelpTooltip);
      button.addEventListener("blur", hideHelpTooltip);
      button.addEventListener("click", event => {
        event.stopPropagation();
        const tooltip = $("#floating-tooltip");
        if (!tooltip.hidden && tooltip.dataset.owner === (button.id || button.getAttribute("aria-label") || "help")) hideHelpTooltip();
        else showHelpTooltip(button);
      });
    });
    document.addEventListener("click", hideHelpTooltip);
    window.addEventListener("scroll", hideHelpTooltip, { passive: true });
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

    $("#diary-prev-day").addEventListener("click", () => changeDiaryDay(-1));
    $("#diary-next-day").addEventListener("click", () => changeDiaryDay(1));
    $("#diary-today-button").addEventListener("click", () => setSelectedDiaryDate(todayISO()));
    $("#diary-date-button").addEventListener("click", openDiaryCalendar);
    $("#diary-native-date").addEventListener("change", event => setSelectedDiaryDate(event.target.value));

    $("#quick-weight-form").addEventListener("submit", addQuickWeight);
    $("#edit-today-weight").addEventListener("click", showWeightEditor);

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
    $("#import-full-profile").addEventListener("click", () => openImport("profile"));
    $("#export-full-profile").addEventListener("click", exportBackup);
    $("#import-history").addEventListener("click", () => openImport("history"));
    $("#export-weights").addEventListener("click", exportWeights);
    $("#import-file").addEventListener("change", handleImport);
    $("#export-intakes").addEventListener("click", exportIntakes);
    $("#import-intakes").addEventListener("click", () => { $("#intake-import-file").value = ""; $("#intake-import-file").click(); });
    $("#intake-import-file").addEventListener("change", handleIntakeImport);

    $("#start-over").addEventListener("click", openConfirm);
    $("#cancel-confirm").addEventListener("click", () => { closeConfirm(); document.body.classList.add("modal-open"); });
    $("#confirm-action").addEventListener("click", resetAll);
    $("#apply-recalibration").addEventListener("click", applyRecalibration);
    $("#run-auto-adjustment").addEventListener("click", runAutomaticAdjustment);

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

    $("#previous-progress-chart").addEventListener("click", () => changeProgressChart(-1));
    $("#next-progress-chart").addEventListener("click", () => changeProgressChart(1));
    $$('[data-progress-chart]').forEach(button => button.addEventListener("click", () => {
      activeProgressChart = button.dataset.progressChart;
      renderActiveProgressChart();
    }));
    $$('[data-chart-range]').forEach(button => button.addEventListener("click", () => {
      chartRange = button.dataset.chartRange;
      $$('[data-chart-range]').forEach(item => item.classList.toggle("active", item === button));
      if (chartPayload) renderActiveProgressChart();
    }));
    window.addEventListener("resize", debounce(() => {
      if (chartPayload && activeAppView === "progress") renderActiveProgressChart();
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
    bindHelpTooltips();
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
