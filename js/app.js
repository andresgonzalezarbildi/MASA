(() => {
  "use strict";

  const STORAGE_KEY = "masa-state-v5";
  const LEGACY_KEYS = ["peso-claro-state-v2", "peso-claro-state-v1"];
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
    proteinGrams: "",
    fatGrams: "",
    carbGrams: "",
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
    match = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (match) {
      let year = Number(match[3]);
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
    const explicitManualMacros = [raw.proteinGrams, raw.fatGrams, raw.carbGrams].some(value => Number.isFinite(toNumber(value, NaN)));
    const legacyProtein = toNumber(raw.proteinTarget, NaN);
    const legacyFatPercent = toNumber(raw.fatPercent, NaN);
    const approximateWeight = latest?.weight || first?.weight || 70;

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
      macroMode: raw.macroMode === "manual" && explicitManualMacros ? "manual" : "auto",
      proteinGrams: explicitManualMacros
        ? clamp(toNumber(raw.proteinGrams, Number.isFinite(legacyProtein) ? legacyProtein * approximateWeight : 130), 20, 400)
        : "",
      fatGrams: explicitManualMacros
        ? clamp(toNumber(raw.fatGrams, Number.isFinite(legacyFatPercent) ? 60 : 60), 10, 300)
        : "",
      carbGrams: explicitManualMacros ? clamp(toNumber(raw.carbGrams, 250), 0, 1000) : "",
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
    const configured = input.configured === true && profileIsComplete(profile, sorted)
      ? true
      : profileIsComplete(profile, sorted);
    return { version: 5, configured, profile, weighIns: sorted };
  }

  function profileIsComplete(profile, weighIns) {
    return Boolean(
      parseDate(profile.birthDate) &&
      Number(profile.heightCm) > 0 &&
      ["male", "female"].includes(profile.sex) &&
      Array.isArray(weighIns) && weighIns.length > 0 &&
      (profile.goalType === "maintain" || Number(profile.goalWeight) > 0 || Number(profile.goalBodyFat) > 0)
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
      proteinG = toNumber(profile.proteinGrams, NaN);
      fatG = toNumber(profile.fatGrams, NaN);
      carbsG = toNumber(profile.carbGrams, NaN);
      macroRule = { mode: "manual", proteinPerKg: Number.isFinite(proteinG) ? proteinG / weight : null, fatPercent: null };
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

    $("#daily-eyebrow").textContent = person ? `OBJETIVOS DIARIOS DE ${person.toUpperCase()}` : "OBJETIVOS DIARIOS";
    $("#daily-title").textContent = person ? `${person}, este es tu punto de partida.` : "Tus números de hoy.";
    $("#target-calories").textContent = formatNumber(Math.round(plan.targetCalories));
    $("#maintenance-calories").textContent = `${formatNumber(Math.round(plan.maintenance))} kcal`;
    $("#calorie-adjustment").textContent = `${plan.dailyAdjustment > 0 ? "+" : ""}${formatNumber(Math.round(plan.dailyAdjustment))} kcal`;
    $("#formula-name").textContent = plan.rmr.fallback ? "Mifflin (respaldo)" : FORMULA_LABELS[plan.rmr.used];
    $("#activity-name").textContent = ACTIVITY_LABELS[String(profile.activityFactor)] || formatNumber(profile.activityFactor, 2);

    $("#protein-grams").textContent = `${formatNumber(Math.round(plan.proteinG))} g`;
    $("#fat-grams").textContent = `${formatNumber(Math.round(plan.fatG))} g`;
    $("#carb-grams").textContent = `${formatNumber(Math.round(plan.carbsG))} g`;
    $("#protein-detail").textContent = profile.macroMode === "auto"
      ? `${formatNumber(plan.macroRule.proteinPerKg, 1)} g/kg · ${formatNumber(plan.proteinPct, 0)}%`
      : `${formatNumber(plan.proteinPct, 0)}% de las calorías objetivo`;
    $("#fat-detail").textContent = `${formatNumber(plan.fatPct, 0)}% de las calorías objetivo`;
    $("#carb-detail").textContent = `${formatNumber(plan.carbsPct, 0)}% de las calorías objetivo`;
    $("#protein-bar").style.setProperty("--macro-width", `${clamp(plan.proteinPct || 0, 0, 100)}%`);
    $("#fat-bar").style.setProperty("--macro-width", `${clamp(plan.fatPct || 0, 0, 100)}%`);
    $("#carb-bar").style.setProperty("--macro-width", `${clamp(plan.carbsPct || 0, 0, 100)}%`);

    const macroDelta = Number.isFinite(plan.macroCalories) && Number.isFinite(plan.targetCalories) ? plan.macroCalories - plan.targetCalories : null;
    const macroNote = $("#macro-balance-note");
    macroNote.className = "inline-note";
    if (profile.macroMode === "manual" && Number.isFinite(macroDelta)) {
      macroNote.textContent = `Tus macros personalizados suman ${formatNumber(Math.round(plan.macroCalories))} kcal, ${Math.abs(macroDelta) < 40 ? "prácticamente igual" : `${formatNumber(Math.abs(Math.round(macroDelta)))} kcal ${macroDelta > 0 ? "por encima" : "por debajo"}`} del objetivo calculado.`;
      macroNote.classList.toggle("warning", Math.abs(macroDelta) >= 100);
    } else {
      macroNote.textContent = "Distribución automática: proteína según peso, grasas moderadas y carbohidratos con las calorías restantes.";
    }

    $("#current-weight").textContent = formatKg(latest?.weight);
    $("#trend-weight").textContent = formatKg(latestTrend, 2);
    $("#observed-rate").textContent = Number.isFinite(observedWeekly) ? `${observedWeekly > 0 ? "+" : ""}${formatNumber(observedWeekly, 2)} kg/sem` : "Faltan datos";
    $("#weight-context").textContent = latest
      ? `Último registro: ${formatDate(latest.date)}. La tendencia actual está en ${formatKg(latestTrend, 2)}.`
      : "El peso diario puede moverse mucho. La línea de tendencia es la que importa.";

    renderPlanStrip(profile, plan);
    renderInsight(profile, plan, weighIns, trends, observedWeekly);
    renderRecalibration(profile, plan, weighIns, trends);
    renderProjection(profile, plan, trends, observedWeekly);
    renderCharts(profile, plan, weighIns, trends, observedWeekly);
    renderHistory(trends);

    $("#stat-change").textContent = first && latest ? formatSignedKg(latest.weight - first.weight) : "—";
    $("#stat-bmi").textContent = formatNumber(plan.bmi, 1);
    $("#stat-bmi-note").textContent = bmiCategory(plan.bmi);
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

    let title = `${namePrefix}todavía falta información para leer el ritmo.`;
    let text = "Con algunos pesajes más se puede separar una variación puntual de una dirección sostenida.";
    if (Number.isFinite(observedWeekly) && weighIns.length >= 5) {
      const desired = plan.signedWeeklyKg;
      const correctDirection = profile.goalType === "maintain"
        ? Math.abs(observedWeekly) < 0.15
        : Math.sign(observedWeekly) === Math.sign(desired);
      const ratio = Math.abs(desired) > 0.02 ? Math.abs(observedWeekly) / Math.abs(desired) : null;

      if (profile.goalType === "maintain") {
        if (Math.abs(observedWeekly) < 0.15) {
          title = `${namePrefix}la tendencia está razonablemente estable.`;
          text = `El ritmo reciente es ${observedWeekly > 0 ? "+" : ""}${formatNumber(observedWeekly, 2)} kg por semana, suficientemente cerca de una banda de mantenimiento.`;
        } else {
          title = `${namePrefix}el promedio se está moviendo fuera del mantenimiento.`;
          text = `La tendencia reciente cambia ${observedWeekly > 0 ? "+" : ""}${formatNumber(observedWeekly, 2)} kg por semana. Conviene observar si se sostiene antes de corregir calorías.`;
        }
      } else if (!correctDirection) {
        title = `${namePrefix}la tendencia reciente va en sentido contrario al objetivo.`;
        text = `El ritmo observado es ${observedWeekly > 0 ? "+" : ""}${formatNumber(observedWeekly, 2)} kg por semana. Unos días pueden engañar; varias semanas en la misma dirección justifican revisar adherencia o cálculo.`;
      } else if (ratio < 0.65) {
        title = `${namePrefix}vas hacia el objetivo, pero más lento que el plan.`;
        text = `La tendencia marca ${formatNumber(Math.abs(observedWeekly), 2)} kg por semana frente a ${formatNumber(Math.abs(desired), 2)} kg previstos. Si la diferencia se mantiene, MASA puede recalibrar la estimación.`;
      } else if (ratio > 1.4) {
        title = `${namePrefix}la tendencia avanza más rápido que la cuenta inicial.`;
        text = `El ritmo observado es ${formatNumber(Math.abs(observedWeekly), 2)} kg por semana frente a ${formatNumber(Math.abs(desired), 2)} kg previstos. Revisá energía, rendimiento y sostenibilidad antes de buscar todavía más velocidad.`;
      } else {
        title = `${namePrefix}la tendencia está bastante alineada con el plan.`;
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
    const recentStart = addMonths(today, -2);
    let cursor = endOfMonth(planStart > recentStart ? planStart : recentStart);

    for (let row = 0; row < 8; row += 1) {
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
    form.elements.proteinGrams.value = profile.proteinGrams || (Number.isFinite(currentPlan.proteinG) ? Math.round(currentPlan.proteinG) : "");
    form.elements.fatGrams.value = profile.fatGrams || (Number.isFinite(currentPlan.fatG) ? Math.round(currentPlan.fatG) : "");
    form.elements.carbGrams.value = profile.carbGrams || (Number.isFinite(currentPlan.carbsG) ? Math.round(currentPlan.carbsG) : "");
    $("#profile-import-callout").hidden = state.configured;
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
      proteinGrams: form.elements.proteinGrams.value,
      fatGrams: form.elements.fatGrams.value,
      carbGrams: form.elements.carbGrams.value
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
    $("#manual-macros").hidden = form.elements.macroMode.value !== "manual";
    $("#activity-explanation").textContent = `${ACTIVITY_EXPLANATIONS[form.elements.activityFactor.value] || ""} Elegilo por la rutina completa, no solamente por el entrenamiento.`;
  }

  function updateProfilePreview() {
    updateProfileControls();
    const form = $("#profile-form");
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
    box.textContent = `Ritmo usado: ${formatNumber(plan.rate.selected, 2)}% semanal. La fecha es una meta separada y no obliga a usar un ritmo fuera del rango elegido.`;
  }

  function renderMacroExplanation(profile, plan) {
    const box = $("#macro-explanation");
    box.className = "explanation-box";
    if (profile.macroMode === "auto") {
      box.textContent = `Automático: ${formatNumber(plan.macroRule.proteinPerKg, 1)} g/kg de proteína, ${formatNumber(plan.macroRule.fatPercent, 0)}% de calorías en grasas y el resto en carbohidratos.`;
      return;
    }
    if (![plan.proteinG, plan.fatG, plan.carbsG].every(Number.isFinite)) {
      box.textContent = "Completá proteína, grasas y carbohidratos.";
      box.classList.add("alert");
      return;
    }
    const delta = plan.macroCalories - plan.targetCalories;
    box.textContent = `Los tres macros suman ${formatNumber(Math.round(plan.macroCalories))} kcal, ${Math.abs(delta) < 40 ? "alineadas" : `${formatNumber(Math.abs(Math.round(delta)))} kcal ${delta > 0 ? "por encima" : "por debajo"}`} del objetivo calculado.`;
    if (Math.abs(delta) >= 100) box.classList.add("warn");
  }

  function validateProfile(profile, currentWeight) {
    if (!parseDate(profile.birthDate)) return "Ingresá una fecha de nacimiento válida en formato dd/mm/aaaa.";
    if (!Number.isFinite(toNumber(profile.heightCm, NaN))) return "Ingresá tu altura.";
    if (!Number.isFinite(currentWeight) || currentWeight <= 0) return "Ingresá tu peso actual.";
    if (profile.formula === "cunningham" && !Number.isFinite(toNumber(profile.bodyFat, NaN))) return "Cunningham necesita un porcentaje de grasa.";
    if (profile.goalType !== "maintain") {
      if (profile.goalMetric === "weight" && !Number.isFinite(toNumber(profile.goalWeight, NaN))) return "Ingresá un peso objetivo.";
      if (profile.goalMetric === "bodyFat" && !Number.isFinite(toNumber(profile.goalBodyFat, NaN))) return "Ingresá el porcentaje de grasa objetivo.";
      if (profile.goalMetric === "bodyFat" && !Number.isFinite(toNumber(profile.bodyFat, NaN))) return "Para un objetivo de grasa necesitás indicar el porcentaje actual.";
    }
    if (profile.goalDate && parseDate(profile.goalDate) <= parseDate(todayISO())) return "La fecha objetivo debe ser futura.";
    if (profile.macroMode === "manual" && ![profile.proteinGrams, profile.fatGrams, profile.carbGrams].every(value => Number.isFinite(toNumber(value, NaN)))) return "Completá los tres macros personalizados.";
    return "";
  }

  function saveProfile(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const currentWeight = toNumber(form.elements.currentWeight.value, NaN);
    const profile = profileFromForm();
    const error = validateProfile(profile, currentWeight);
    if (error) {
      setFeedback($("#profile-feedback"), error, true);
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
    $("#quick-weight").value = "";
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
    const rows = ["fecha;peso_kg", ...sortedWeighIns().map(item => `${displayDate(item.date)};${String(item.weight).replace(".", ",")}`)];
    downloadText("pesajes-masa.csv", rows.join("\n"), "text/csv;charset=utf-8");
  }

  function exportBackup() {
    downloadText("perfil-masa.json", JSON.stringify({ ...state, version: 5 }, null, 2), "application/json");
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

  function bindEvents() {
    $("#begin-setup").addEventListener("click", () => openSettings(true, "profile"));
    $("#welcome-import").addEventListener("click", () => openImport("profile"));
    $("#open-profile").addEventListener("click", () => openSettings(false, "profile"));
    $("#brand-home").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    $("#close-settings").addEventListener("click", closeSettings);
    $("#cancel-profile").addEventListener("click", closeSettings);
    $$('[data-close-settings]').forEach(element => element.addEventListener("click", closeSettings));
    $$('[data-settings-tab]').forEach(button => button.addEventListener("click", () => switchSettingsTab(button.dataset.settingsTab)));
    $("#profile-form").addEventListener("submit", saveProfile);
    $("#profile-form").addEventListener("input", updateProfilePreview);
    $("#profile-form").addEventListener("change", updateProfilePreview);
    document.addEventListener("input", formatDateTyping);
    $("#quick-weight-form").addEventListener("submit", addQuickWeight);
    $("#toggle-date").addEventListener("click", () => {
      $("#alternate-date-wrap").hidden = !$("#alternate-date-wrap").hidden;
      $("#toggle-date").textContent = $("#alternate-date-wrap").hidden ? "El pesaje es de otro día" : "Usar la fecha de hoy";
      if (!$("#alternate-date-wrap").hidden) $("#quick-date").value = displayDate(todayISO());
    });
    $("#history-list").addEventListener("change", updateHistoryRow);
    $("#history-list").addEventListener("click", deleteHistoryRow);
    $("#profile-import").addEventListener("click", () => openImport("profile"));
    $("#import-history").addEventListener("click", () => openImport("history"));
    $("#import-file").addEventListener("change", handleImport);
    $("#export-history").addEventListener("click", exportHistory);
    $("#export-backup").addEventListener("click", exportBackup);
    $("#start-over").addEventListener("click", openConfirm);
    $("#cancel-confirm").addEventListener("click", () => { closeConfirm(); document.body.classList.add("modal-open"); });
    $("#confirm-action").addEventListener("click", resetAll);
    $("#apply-recalibration").addEventListener("click", applyRecalibration);
    $$('[data-chart-range]').forEach(button => button.addEventListener("click", () => {
      chartRange = button.dataset.chartRange;
      $$('[data-chart-range]').forEach(item => item.classList.toggle("active", item === button));
      if (chartPayload) drawWeightChart($("#weight-chart"), chartPayload);
    }));
    window.addEventListener("resize", debounce(() => chartPayload && drawWeightChart($("#weight-chart"), chartPayload), 100));
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
    if (navigator.serviceWorker?.register && location.protocol !== "file:") {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    }
  }

  init();
})();
