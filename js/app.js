(() => {
  "use strict";

  const STORAGE_KEY = "masa-state-v10";
  const TIPS_SEEN_KEY = "masa-tips-seen-v1";
  const LEGACY_KEYS = ["masa-state-v9", "masa-state-v8", "masa-state-v7", "masa-state-v6", "masa-state-v5", "peso-claro-state-v2", "peso-claro-state-v1"];
  const DAY_MS = 86_400_000;
  const KG_KCAL = 7700;
  // MASA_ADAPTIVE_EXPENDITURE_V1
  const EXPENDITURE_CONFIG = Object.freeze({
    emaAlpha: 0.10,
    windowDays: 42,
    minIntakeDays: 14,
    minSpanDays: 18,
    minWeighIns: 8,
    reviewIntervalDays: 7,
    minNewIntakeDays: 3,
    minNewWeighIns: 2,
    maxAdjustment: 250,
    minMeaningfulAdjustment: 30
  });
  const MEAL_USAGE_KEYS = ["breakfast", "lunch", "snack", "dinner", "extras"];
  const EXTERNAL_FOOD_CATALOG_URL = new URL(
    "../data/opennutrition-es-general.json",
    document.currentScript?.src || window.location.href
  ).href;
  const OPEN_FOOD_FACTS_PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product";
  const OPEN_FOOD_FACTS_PROXY_URL = new URL("/api/open-food-facts/", window.location.origin).href;

  let externalFoodCatalog = [];
  let externalFoodCatalogById = new Map();
  let externalFoods = [];
  let externalFoodsById = new Map();
  let externalFoodSearchIndex = [];
  let externalFoodsStatus = "idle";
  let externalFoodsError = "";
  let externalFoodsLoadPromise = null;
  let activeFoodSelection = null;
  let foodSearchTimer = null;
  let recipeSearchTimer = null;
  let libraryCatalogSearchTimer = null;
  let activeRecipeIngredientSelection = null;
  let recipeDraftIngredients = [];
  let editingFoodId = null;
  let editingCatalogFoodId = null;
  let editingRecipeId = null;
  let foodEditorReturnTarget = "";
  let recipeEditorReturnTarget = "";
  let libraryReturnTarget = "";
  let foodEditorPrefill = null;
  let barcodeReader = null;
  let barcodeScannerControls = null;
  let barcodeReturnTarget = "food";
  let barcodeLookupBusy = false;
  let barcodeTorchOn = false;

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

  let state;
  let stateRevision = 0;
  let settingsRequired = false;
  let importMode = "history";
  let chartPayload = null;
  let chartRange = "3m";
  let activeProgressChart = "weight";
  let recalibrationSuggestion = null;
  let fillingProfileForm = false;
  let activeMeal = "breakfast";
  let activeFoodMode = "recent";
  let activeAppView = "today";
  let activeDiaryView = "record";
  let calorieRange = 14;
  let weightEditorForced = false;
  let editingDiaryEntryId = null;
  let selectedDiaryDate = todayISO();
  let selectedHistoryId = null;

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

  function roundEditorNumber(value, digits = 0) {
    const number = toNumber(value, 0);
    const factor = 10 ** digits;
    return Math.round((number + Number.EPSILON) * factor) / factor;
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

  function normalizeTimestamp(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }

  function normalizeRecipeIngredient(item = {}) {
    const name = String(item.name || "").trim();
    const amount = Math.max(0, toNumber(item.amount, 0));
    const calories = Math.max(0, toNumber(item.calories, 0));
    if (!name || amount <= 0) return null;
    return {
      id: item.id || createId(),
      sourceId: String(item.sourceId || item.foodId || "").trim(),
      foodId: String(item.foodId || "").trim(),
      kind: ["food", "external"].includes(item.kind) ? item.kind : "food",
      name,
      amount,
      unit: String(item.unit || "serving").trim() || "serving",
      serving: String(item.serving || "").trim(),
      calories,
      protein: Math.max(0, toNumber(item.protein, 0)),
      fat: Math.max(0, toNumber(item.fat, 0)),
      carbs: Math.max(0, toNumber(item.carbs, 0))
    };
  }

  function normalizeCatalogOverride(item = {}, fallbackId = "") {
    const id = String(item.id || fallbackId || "").trim();
    if (!id) return null;
    const result = { id, hidden: Boolean(item.hidden) };
    const name = String(item.name || "").trim();
    const calories = toNumber(item.calories, NaN);
    const servingAmount = toNumber(item.servingAmount, NaN);
    if (name) result.name = name;
    if (Number.isFinite(calories) && calories >= 0) result.calories = calories;
    ["protein", "fat", "carbs"].forEach(key => {
      const value = toNumber(item[key], NaN);
      if (Number.isFinite(value) && value >= 0) result[key] = value;
    });
    if (Number.isFinite(servingAmount) && servingAmount > 0) result.servingAmount = servingAmount;
    if (item.servingUnit) result.servingUnit = String(item.servingUnit);
    if (item.servingUnitCustom) result.servingUnitCustom = String(item.servingUnitCustom).trim();
    if (item.serving) result.serving = String(item.serving).trim();
    result.updatedAt = normalizeTimestamp(item.updatedAt) || new Date().toISOString();
    return result;
  }

  function normalizeBarcode(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function validBarcode(value) {
    const code = normalizeBarcode(value);
    if (![8, 12, 13, 14].includes(code.length)) return false;
    const digits = [...code].map(Number);
    const check = digits.pop();
    let sum = 0;
    for (let index = digits.length - 1, position = 0; index >= 0; index--, position++) {
      sum += digits[index] * (position % 2 === 0 ? 3 : 1);
    }
    return (10 - (sum % 10)) % 10 === check;
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

    const foodUsage = {};
    Object.entries(input.foodUsage || {}).forEach(([sourceId, usage]) => {
      const amount = toNumber(usage?.amount, NaN);
      if (!sourceId || !Number.isFinite(amount) || amount <= 0) return;
      foodUsage[sourceId] = {
        amount,
        unit: String(usage?.unit || "").trim(),
        uses: Math.max(0, Math.round(toNumber(usage?.uses, 0))),
        lastUsed: normalizeDate(usage?.lastUsed),
        lastUsedAt: normalizeTimestamp(usage?.lastUsedAt || usage?.lastUsed)
      };
    });
    // MASA_MEAL_USAGE_NORMALIZATION_V1
    const legacyMealUsageKeys = new Set();
    Object.entries(foodUsage).forEach(([sourceId, usage]) => {
      const rawUsage = input.foodUsage?.[sourceId] || {};
      const byMeal = {};
      MEAL_USAGE_KEYS.forEach(meal => {
        const mealUsage = rawUsage?.byMeal?.[meal] || usage?.byMeal?.[meal];
        const mealAmount = toNumber(mealUsage?.amount, NaN);
        const mealUses = Math.max(0, Math.round(toNumber(mealUsage?.uses, 0)));
        if (!mealUsage || (!Number.isFinite(mealAmount) && mealUses <= 0)) return;
        byMeal[meal] = {
          amount: Number.isFinite(mealAmount) && mealAmount > 0 ? mealAmount : toNumber(usage?.amount, 1),
          unit: String(mealUsage?.unit || usage?.unit || "").trim(),
          uses: mealUses,
          lastUsed: normalizeDate(mealUsage?.lastUsed),
          lastUsedAt: normalizeTimestamp(mealUsage?.lastUsedAt || mealUsage?.lastUsed)
        };
      });
      if (!Object.keys(byMeal).length) legacyMealUsageKeys.add(sourceId);
      usage.byMeal = byMeal;
    });
    if (legacyMealUsageKeys.size) {
      Object.entries(diary).forEach(([date, entries]) => {
        entries.forEach((entry, index) => {
          const sourceId = String(entry?.sourceId || "").trim();
          const meal = MEAL_USAGE_KEYS.includes(entry?.meal) ? entry.meal : "extras";
          if (!sourceId || !legacyMealUsageKeys.has(sourceId) || !foodUsage[sourceId]) return;
          const usage = foodUsage[sourceId];
          const previous = usage.byMeal[meal] || {};
          const entryAmount = toNumber(entry?.quantity, usage.amount);
          const entryUnit = String(entry?.quantityUnit || usage.unit || "").trim();
          const parsedDate = parseDate(date);
          const usedAt = parsedDate
            ? new Date(parsedDate.getTime() + index * 1000).toISOString()
            : `${date}T12:00:00.000Z`;
          const isLatest = !previous.lastUsedAt || usedAt > previous.lastUsedAt;
          usage.byMeal[meal] = {
            amount: isLatest && entryAmount > 0 ? entryAmount : toNumber(previous.amount, usage.amount),
            unit: isLatest && entryUnit ? entryUnit : String(previous.unit || usage.unit || ""),
            uses: Math.max(0, Math.round(toNumber(previous.uses, 0))) + 1,
            lastUsed: isLatest ? date : previous.lastUsed,
            lastUsedAt: isLatest ? usedAt : previous.lastUsedAt
          };
        });
      });
    }

    const catalogOverrides = {};
    const rawCatalogOverrides = input.catalogOverrides || input.externalFoodOverrides || {};
    Object.entries(rawCatalogOverrides).forEach(([id, value]) => {
      const normalized = normalizeCatalogOverride(value, id);
      if (normalized) catalogOverrides[normalized.id] = normalized;
    });

    const configured = profileIsComplete(profile, sorted);
    return {
      version: 20,
      configured,
      profile,
      weighIns: sorted,
      foods,
      recipes,
      diary,
      completedDays,
      foodUsage,
      catalogOverrides,
      calibrationHistory: Array.isArray(input.calibrationHistory) ? input.calibrationHistory.slice(-20) : [],
      lastCheckinDate: normalizeDate(input.lastCheckinDate)
    };
  }

  function normalizeFood(item = {}) {
    const name = String(item.name || "").trim();
    const calories = toNumber(item.calories, NaN);
    if (!name || !Number.isFinite(calories) || calories < 0) return null;
    const kind = item.kind === "recipe" ? "recipe" : "food";
    const ingredients = kind === "recipe" && Array.isArray(item.ingredients)
      ? item.ingredients.map(normalizeRecipeIngredient).filter(Boolean)
      : [];
    const rawServing = String(item.serving || "1 porción").trim() || "1 porción";
    const parsedServing = parseServingDefinition(rawServing);
    const servingAmount = Math.max(0.01, toNumber(item.servingAmount ?? item.recipeServingAmount, parsedServing.baseAmount) || parsedServing.baseAmount);
    const storedUnit = String(item.servingUnit || item.recipeYieldUnit || parsedServing.unitKey || "serving").trim();
    const servingUnit = ["g", "kg", "ml", "l", "unit", "serving", "cup", "tablespoon", "teaspoon", "plate", "slice", "package", "custom"].includes(storedUnit)
      ? storedUnit
      : canonicalEditableUnit(storedUnit);
    const servingUnitCustom = String(item.servingUnitCustom || item.recipeYieldUnitCustom || parsedServing.customUnit || "").trim();
    return {
      id: item.id || createId(),
      name,
      calories,
      barcode: normalizeBarcode(item.barcode || item.code),
      brand: String(item.brand || item.brands || "").trim(),
      source: String(item.source || "").trim(),
      sourceUrl: String(item.sourceUrl || "").trim(),
      sourceImportedAt: normalizeTimestamp(item.sourceImportedAt),
      imageUrl: String(item.imageUrl || "").trim(),
      protein: Math.max(0, toNumber(item.protein, 0)),
      fat: Math.max(0, toNumber(item.fat, 0)),
      carbs: Math.max(0, toNumber(item.carbs, 0)),
      serving: rawServing,
      servingAmount,
      servingUnit,
      servingUnitCustom,
      kind,
      ingredients,
      recipeYield: kind === "recipe" ? Math.max(0.01, toNumber(item.recipeYield, 1) || 1) : 1,
      recipeYieldUnit: kind === "recipe" ? servingUnit : "",
      recipeYieldUnitCustom: kind === "recipe" ? servingUnitCustom : "",
      recipeServingAmount: kind === "recipe" ? servingAmount : 0,
      uses: Math.max(0, Math.round(toNumber(item.uses, 0))),
      lastUsed: normalizeDate(item.lastUsed),
      lastUsedAt: normalizeTimestamp(item.lastUsedAt || item.lastUsed)
    };
  }

  function normalizeExternalFood(item = {}) {
    const name = String(item.name || "").trim();
    const per100g = item.per100g && typeof item.per100g === "object" ? item.per100g : {};
    const caloriesPer100g = toNumber(per100g.calories, NaN);

    if (!name || !Number.isFinite(caloriesPer100g) || caloriesPer100g < 0) return null;

    const metricQuantity = Math.max(
      0.1,
      toNumber(item.serving?.metric?.quantity, 100) || 100
    );
    const commonQuantity = Math.max(
      0,
      toNumber(item.serving?.common?.quantity, 0) || 0
    );
    const commonUnit = String(item.serving?.common?.unit || "").trim();
    const factor = metricQuantity / 100;

    const aliases = Array.isArray(item.aliases)
      ? [...new Set(
          item.aliases
            .map(alias => String(alias || "").trim())
            .filter(Boolean)
        )]
      : [];

    return {
      id: `external:${item.id || createId()}`,
      catalogId: String(item.id || ""),
      name,
      aliases,
      barcode: normalizeBarcode(item.barcode || item.code),
      brand: String(item.brand || item.brands || "").trim(),
      sourceName: String(item.sourceName || item.brand || item.brands || "").trim(),
      metricQuantity,
      commonQuantity,
      commonUnit,
      calories: Math.max(0, caloriesPer100g * factor),
      protein: Math.max(0, toNumber(per100g.protein, 0) * factor),
      fat: Math.max(0, toNumber(per100g.fat, 0) * factor),
      carbs: Math.max(0, toNumber(per100g.carbs, 0) * factor),
      serving: `${formatNumber(metricQuantity, metricQuantity % 1 ? 1 : 0)} g`,
      kind: "external",
      uses: 0,
      lastUsed: ""
    };
  }

  function effectiveCatalogFood(base, override = null) {
    if (!base || !override) return base;
    const servingAmount = Math.max(0.01, toNumber(override.servingAmount, base.metricQuantity || 100));
    const unit = override.servingUnit || "g";
    const customUnit = override.servingUnitCustom || "";
    return {
      ...base,
      name: override.name || base.name,
      calories: Number.isFinite(toNumber(override.calories, NaN)) ? toNumber(override.calories) : base.calories,
      protein: Number.isFinite(toNumber(override.protein, NaN)) ? toNumber(override.protein) : base.protein,
      fat: Number.isFinite(toNumber(override.fat, NaN)) ? toNumber(override.fat) : base.fat,
      carbs: Number.isFinite(toNumber(override.carbs, NaN)) ? toNumber(override.carbs) : base.carbs,
      serving: override.serving || servingLabel(servingAmount, unit, customUnit),
      servingAmount,
      servingUnit: unit,
      servingUnitCustom: customUnit,
      userOverride: true
    };
  }

  function rebuildExternalFoodCatalog() {
    const overrides = state?.catalogOverrides || {};
    externalFoods = externalFoodCatalog
      .filter(base => !overrides[base.id]?.hidden)
      .map(base => effectiveCatalogFood(base, overrides[base.id]));
    externalFoodsById = new Map(externalFoods.map(item => [item.id, item]));
    externalFoodSearchIndex = externalFoods.map(item => ({
      item,
      nameText: normalizeHeader(item.name),
      searchText: foodSearchText(item)
    }));
  }

  function catalogFoodForEditing(id) {
    const base = externalFoodCatalogById.get(id);
    if (!base) return null;
    return effectiveCatalogFood(base, state.catalogOverrides?.[id]);
  }

  async function loadExternalFoods() {
    externalFoodsStatus = "loading";
    externalFoodsError = "";

    try {
      let raw = [];
      let source = "Supabase";

      try {
        raw = await window.MASA_CLOUD.loadGlobalFoods();
      } catch (cloudError) {
        console.warn("No se pudo cargar el catálogo desde Supabase; se usará la copia local.", cloudError);
      }

      if (!Array.isArray(raw) || !raw.length) {
        source = "copia local";
        const response = await fetch(EXTERNAL_FOOD_CATALOG_URL, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status} al cargar el catálogo`);
        raw = await response.json();
      }

      if (!Array.isArray(raw)) throw new Error("El catálogo no contiene una lista JSON");

      externalFoodCatalog = raw.map(normalizeExternalFood).filter(Boolean);
      externalFoodCatalogById = new Map(externalFoodCatalog.map(item => [item.id, item]));
      rebuildExternalFoodCatalog();
      externalFoodsStatus = "ready";
      console.info(`Catálogo cargado desde ${source}: ${externalFoods.length.toLocaleString("es-UY")} alimentos.`);
    } catch (error) {
      externalFoodCatalog = [];
      externalFoodCatalogById = new Map();
      externalFoods = [];
      externalFoodsById = new Map();
      externalFoodSearchIndex = [];
      externalFoodsStatus = "error";
      externalFoodsError = error instanceof Error ? error.message : String(error);
      console.error("No se pudo cargar el catálogo:", error);
    }

    if (!$("#food-modal")?.hidden) renderActiveFoodMode();
    if (!$("#library-modal")?.hidden) renderLibraryManager();
    if (!$("#recipe-modal")?.hidden) {
      renderRecipeIngredientResults();
      renderRecipeIngredientList();
    }
  }

  function normalizeDiaryEntry(item = {}) {
    const food = normalizeFood(item);
    if (!food) return null;
    const { ingredients: _ingredients, recipeYield: _recipeYield, ...entryFood } = food;
    return {
      ...entryFood,
      id: item.id || createId(),
      sourceId: item.sourceId || "",
      quantity: Math.max(0, toNumber(item.quantity, 0)),
      quantityUnit: String(item.quantityUnit || "").trim(),
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

  function emptyState() {
    return normalizeState({ configured: false, profile: DEFAULT_PROFILE, weighIns: [] });
  }

  function loadLegacyState() {
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      if (current) return normalizeState(JSON.parse(current));
      for (const key of LEGACY_KEYS) {
        const legacy = localStorage.getItem(key);
        if (legacy) return normalizeState(JSON.parse(legacy));
      }
    } catch (_) {}
    return emptyState();
  }

  function hasMeaningfulState(value) {
    return Boolean(
      value?.configured ||
      value?.weighIns?.length ||
      value?.foods?.length ||
      value?.recipes?.length ||
      Object.values(value?.diary || {}).some(entries => entries?.length)
    );
  }

  function clearLegacyState() {
    try {
      const original = localStorage.getItem(STORAGE_KEY);
      if (original) localStorage.setItem(`masa-legacy-backup-${Date.now()}`, original);
      localStorage.removeItem(STORAGE_KEY);
      LEGACY_KEYS.forEach(key => localStorage.removeItem(key));
    } catch (_) {}
  }

  function saveState(next = state) {
    state = normalizeState(next);
    stateRevision += 1;
    if (externalFoodCatalog.length) rebuildExternalFoodCatalog();
    if (window.MASA_CLOUD?.isAuthenticated()) {
      window.MASA_CLOUD.scheduleStateSync(state);
    } else {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
    }
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

  function regressionRatePerWeek(values = state.weighIns, limit = 21, valueKey = "weight") {
    const points = sortedWeighIns(values).slice(-limit);
    if (points.length < 3) return null;
    const origin = parseDate(points[0].date);
    const data = points.map(item => ({
      x: daysBetween(origin, parseDate(item.date)),
      y: toNumber(item[valueKey], NaN)
    })).filter(item => Number.isFinite(item.x) && Number.isFinite(item.y));
    if (data.length < 3) return null;
    const meanX = data.reduce((sum, item) => sum + item.x, 0) / data.length;
    const meanY = data.reduce((sum, item) => sum + item.y, 0) / data.length;
    const numerator = data.reduce((sum, item) => sum + (item.x - meanX) * (item.y - meanY), 0);
    const denominator = data.reduce((sum, item) => sum + (item.x - meanX) ** 2, 0);
    return denominator ? (numerator / denominator) * 7 : null;
  }
  function exponentialWeightTrend(values = state.weighIns, alpha = EXPENDITURE_CONFIG.emaAlpha) {
    const sorted = sortedWeighIns(values);
    let trend = null;
    let previousDate = null;
    return sorted.map(item => {
      const date = parseDate(item.date);
      if (!Number.isFinite(trend)) {
        trend = item.weight;
      } else {
        const elapsedDays = Math.max(1, Math.round(daysBetween(previousDate, date)));
        const effectiveAlpha = 1 - (1 - alpha) ** elapsedDays;
        trend += effectiveAlpha * (item.weight - trend);
      }
      previousDate = date;
      return { ...item, trend };
    });
  }
  function expenditureRatePerWeek(values = state.weighIns, limit = 60) {
    return regressionRatePerWeek(exponentialWeightTrend(values), limit, "trend");
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
        const editing = editingDiaryEntryId === item.id;
        row.className = `meal-item${editing ? " editing" : ""}`;
        if (editing) {
          const source = diaryEntrySource(item);
          const options = source ? foodQuantityOptions(source) : [parseServingDefinition(item.serving)];
          const selectedOption = options.find(option => option.value === item.quantityUnit) || options[0];
          row.innerHTML = `<form class="meal-inline-edit" data-diary-edit-form="${escapeHTML(item.id)}">
            <div class="meal-inline-edit-title"><b>${escapeHTML(item.name)}</b><small data-diary-edit-preview>${formatNumber(Math.round(item.calories))} kcal</small></div>
            <label><span>Cantidad</span><input name="amount" type="number" min="0.01" step="any" inputmode="decimal" value="${escapeHTML(item.quantity || selectedOption.baseAmount)}" required></label>
            <label><span>Unidad</span><select name="unit" ${options.length === 1 ? "disabled" : ""}>${options.map(option => `<option value="${escapeHTML(option.value)}" ${option.value === selectedOption.value ? "selected" : ""}>${escapeHTML(option.plural)}</option>`).join("")}</select></label>
            <div class="meal-inline-edit-actions"><button class="primary-action" type="submit">Guardar</button></div>
          </form>`;
        } else {
          const canEditQuantity = toNumber(item.quantity, 0) > 0;
          if (canEditQuantity) {
            row.classList.add("meal-item-editable");
            row.dataset.editDiary = item.id;
            row.setAttribute("aria-label", `Editar cantidad de ${item.name}`);
          }
          row.innerHTML = `<div><b>${escapeHTML(item.name)}</b><small><span class="meal-serving">${escapeHTML(item.serving || "1 porción")}</span> · P ${formatNumber(item.protein,1)} · G ${formatNumber(item.fat,1)} · C ${formatNumber(item.carbs,1)}</small></div><span>${formatNumber(Math.round(item.calories))} kcal</span><button type="button" data-remove-diary="${item.id}" aria-label="Eliminar ${escapeHTML(item.name)}">×</button>`;
        }
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
    syncCalorieRangeButtons();
    if (activeDiaryView === "chart") requestAnimationFrame(() => drawCalorieChart(calculatePlan()));
  }

  function diaryTotalsForDate(date) {
    return diaryTotals(state.diary[date] || []);
  }

  function isMobileLayout() {
    return window.matchMedia?.("(max-width: 590px)").matches ?? window.innerWidth <= 590;
  }

  function effectiveCalorieRange() {
    return isMobileLayout() ? 7 : calorieRange;
  }

  function syncCalorieRangeButtons() {
    const visibleRange = effectiveCalorieRange();
    $$('[data-calorie-range]').forEach(button => button.classList.toggle("active", toNumber(button.dataset.calorieRange, 0) === visibleRange));
  }

  function calorieChartDays() {
    const end = parseDate(selectedDiaryDate);
    const days = [];
    const visibleRange = effectiveCalorieRange();
    for (let offset = visibleRange - 1; offset >= 0; offset -= 1) {
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
      const visibleRange = effectiveCalorieRange();
      const showLabel = isMobileLayout()
        ? index % 2 === 0 || index === days.length - 1
        : visibleRange <= 14 || index % Math.ceil(visibleRange / 10) === 0 || index === days.length - 1;
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
    const card = $("#record-weight-card");
    const ledger = $("#meal-grid");
    const sidebar = document.querySelector(".records-sidebar");
    const compact = recorded && !weightEditorForced;
    card.classList.toggle("compact-recorded-weight", compact);
    if (compact && sidebar && card.parentElement !== sidebar) {
      const quickTools = sidebar.querySelector(".diary-quick-tools");
      sidebar.insertBefore(card, quickTools || null);
    }
    if (!compact && ledger && card.parentElement !== ledger) ledger.prepend(card);
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

  function setBarcodeStatus(message, type = "") {
    const status = $("#barcode-status");
    if (!status) return;
    status.textContent = message;
    status.className = `barcode-status${type ? ` ${type}` : ""}`;
  }

  function getBarcodeVideoTrack() {
    const stream = $("#barcode-video")?.srcObject;
    return stream?.getVideoTracks?.()[0] || null;
  }

  function updateBarcodeTorchButton() {
    const button = $("#barcode-torch");
    if (!button) return;
    const track = getBarcodeVideoTrack();
    let supported = false;
    try { supported = Boolean(track?.getCapabilities?.().torch); } catch (_) {}
    supported ||= typeof barcodeScannerControls?.switchTorch === "function";
    button.hidden = !supported;
    button.setAttribute("aria-pressed", String(barcodeTorchOn));
    button.classList.toggle("active", barcodeTorchOn);
  }

  async function toggleBarcodeTorch() {
    const track = getBarcodeVideoTrack();
    const desiredState = !barcodeTorchOn;
    let directError = null;
    try {
      let handled = false;
      if (track?.applyConstraints) {
        let capabilities = {};
        try { capabilities = track.getCapabilities?.() || {}; } catch (_) {}
        if (capabilities.torch) {
          try {
            await track.applyConstraints({ advanced: [{ torch: desiredState }] });
            handled = true;
          } catch (error) {
            directError = error;
          }
        }
      }
      if (!handled && typeof barcodeScannerControls?.switchTorch === "function") {
        await barcodeScannerControls.switchTorch();
        handled = true;
      }
      if (!handled) throw directError || new Error("Torch unavailable");
      barcodeTorchOn = desiredState;
      updateBarcodeTorchButton();
      setBarcodeStatus(desiredState ? "Linterna encendida. Apuntá al código de barras." : "Linterna apagada. Apuntá al código de barras.");
    } catch (error) {
      console.warn("No se pudo cambiar la linterna:", error);
      barcodeTorchOn = false;
      updateBarcodeTorchButton();
      setBarcodeStatus("El navegador no permitió controlar la linterna de esta cámara.", "error");
    }
  }

  function stopBarcodeScanner() {
    const track = getBarcodeVideoTrack();
    if (track && barcodeTorchOn) {
      try { track.applyConstraints?.({ advanced: [{ torch: false }] }).catch?.(() => {}); } catch (_) {}
    }
    barcodeTorchOn = false;
    try { barcodeScannerControls?.stop?.(); } catch (_) {}
    barcodeScannerControls = null;
    try { barcodeReader?.reset?.(); } catch (_) {}
    barcodeReader = null;
    const video = $("#barcode-video");
    const stream = video?.srcObject;
    if (stream?.getTracks) stream.getTracks().forEach(mediaTrack => mediaTrack.stop());
    if (video) video.srcObject = null;
    const torchButton = $("#barcode-torch");
    if (torchButton) {
      torchButton.hidden = true;
      torchButton.classList.remove("active");
      torchButton.setAttribute("aria-pressed", "false");
    }
  }

  function nativeBarcodeValue(result) {
    return normalizeBarcode(
      result?.ScanResult
      || result?.scanResult
      || result?.content
      || result?.value
      || result?.text
      || ""
    );
  }

  async function startBarcodeScanner() {
    stopBarcodeScanner();
    const video = $("#barcode-video");
    if (!video) return;

    if (window.MASA_NATIVE?.isNative?.() && typeof window.MASA_NATIVE.scanBarcode === "function") {
      setBarcodeStatus("Abriendo el lector de códigos de barras…", "loading");
      try {
        const result = await window.MASA_NATIVE.scanBarcode();
        const code = nativeBarcodeValue(result);
        if (!code) {
          setBarcodeStatus("Escaneo cancelado. También podés ingresar el código manualmente.");
          return;
        }
        if (!validBarcode(code)) {
          setBarcodeStatus("El código leído no tiene un formato EAN/UPC válido.", "error");
          return;
        }
        lookupBarcode(code);
      } catch (error) {
        console.warn("No se pudo iniciar el lector nativo:", error);
        const cancelled = /cancel/i.test(String(error?.message || error || ""));
        setBarcodeStatus(cancelled
          ? "Escaneo cancelado. También podés ingresar el código manualmente."
          : "No se pudo abrir la cámara. Revisá el permiso de cámara o ingresá el código manualmente.", cancelled ? "" : "error");
      }
      return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setBarcodeStatus("La cámara requiere abrir M.A.S.A. desde una dirección HTTPS. Podés ingresar el código manualmente.", "error");
      return;
    }
    const permissionsPolicy = document.permissionsPolicy || document.featurePolicy;
    if (permissionsPolicy?.allowsFeature && !permissionsPolicy.allowsFeature("camera")) {
      setBarcodeStatus("La configuración del sitio está bloqueando la cámara. Volvé a publicar esta versión y recargá la página.", "error");
      return;
    }
    if (!window.ZXingBrowser?.BrowserMultiFormatReader) {
      setBarcodeStatus("No se pudo cargar el lector. Podés ingresar el código manualmente.", "error");
      return;
    }
    setBarcodeStatus("Apuntá al código de barras y mantené el envase quieto.");
    try {
      barcodeReader = new window.ZXingBrowser.BrowserMultiFormatReader();
      barcodeScannerControls = await barcodeReader.decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        video,
        result => {
          if (!result || barcodeLookupBusy) return;
          const code = normalizeBarcode(result.getText?.() || result.text || "");
          if (!validBarcode(code)) return;
          stopBarcodeScanner();
          lookupBarcode(code);
        }
      );
      updateBarcodeTorchButton();
      video.addEventListener("loadedmetadata", updateBarcodeTorchButton, { once: true });
      setTimeout(updateBarcodeTorchButton, 350);
    } catch (error) {
      console.warn("No se pudo iniciar la cámara:", error);
      const messages = {
        NotAllowedError: "No se concedió acceso a la cámara. Revisá el permiso del sitio en el navegador.",
        SecurityError: "El navegador bloqueó la cámara por la configuración de seguridad del sitio.",
        NotFoundError: "No se encontró una cámara disponible en este dispositivo.",
        NotReadableError: "La cámara está siendo usada por otra aplicación o no se pudo iniciar."
      };
      setBarcodeStatus(`${messages[error?.name] || "No se pudo abrir la cámara."} Podés ingresar el código manualmente.`, "error");
    }
  }

  function openBarcodeScanner(target = "food") {
    barcodeReturnTarget = target === "recipe" ? "recipe" : target === "food-editor" ? "food-editor" : "food";
    if (barcodeReturnTarget === "recipe") $("#recipe-modal").hidden = true;
    else if (barcodeReturnTarget === "food-editor") $("#food-editor-modal").hidden = true;
    else $("#food-modal").hidden = true;
    $("#barcode-modal").hidden = false;
    $("#barcode-manual-form").reset();
    $("#barcode-torch").hidden = true;
    document.body.classList.add("modal-open");
    startBarcodeScanner();
  }

  function closeBarcodeScanner(restore = true) {
    stopBarcodeScanner();
    $("#barcode-modal").hidden = true;
    if (restore) {
      if (barcodeReturnTarget === "recipe") $("#recipe-modal").hidden = false;
      else if (barcodeReturnTarget === "food-editor") $("#food-editor-modal").hidden = false;
      else $("#food-modal").hidden = false;
    }
    updateModalBodyState();
  }

  function showBarcodeMatch(item) {
    const target = barcodeReturnTarget;
    closeBarcodeScanner(false);
    if (target === "food-editor") {
      const returnTarget = foodEditorReturnTarget || "main";
      const ownFood = item.kind === "food" ? state.foods.find(food => food.id === item.id) : null;
      openFoodEditor({
        returnTarget,
        editId: ownFood?.id || null,
        prefillFood: ownFood ? null : item,
        sourceNote: ownFood
          ? `Este código ya pertenece a “${ownFood.name}”. Podés revisar o actualizar sus datos.`
          : `Encontramos “${item.name}” en tu catálogo. Revisá los datos antes de guardarlo en tu biblioteca.`,
        sourceNoteType: "success"
      });
    } else if (target === "recipe") {
      $("#recipe-modal").hidden = false;
      $("#recipe-ingredient-search").value = item.name;
      activeRecipeIngredientSelection = { id: item.id, kind: item.kind };
      renderRecipeIngredientResults();
    } else {
      $("#food-modal").hidden = false;
      $("#food-search-input").value = item.name;
      updateFoodSearchDisplay();
      activeFoodSelection = { id: item.id, kind: item.kind };
      renderFoodResults();
      focusSelectedFoodAmount();
    }
    updateModalBodyState();
  }

  function openScannedFoodEditor(prefill, note, options = {}) {
    const target = barcodeReturnTarget;
    const returnTarget = target === "food-editor" ? (foodEditorReturnTarget || "main") : target;
    closeBarcodeScanner(false);
    openFoodEditor({
      returnTarget,
      prefillFood: prefill,
      sourceNote: note,
      sourceNoteType: options.sourceNoteType || "",
      allowRescan: Boolean(options.allowRescan),
      title: options.title || "",
      description: options.description || ""
    });
  }

  function parseProductMeasure(value) {
    const raw = String(value || "").trim().toLowerCase().replace(",", ".");
    if (!raw) return null;
    const match = raw.match(/(\d+(?:\.\d+)?)\s*(ml|millilit(?:er|re|ro)s?|cl|l|lit(?:er|re|ro)s?|g|gr|gram(?:o|me|s)?s?|kg|kilogram(?:o|me|s)?s?)(?:\b|$)/i);
    if (!match) return null;
    let amount = Number(match[1]);
    let unit = match[2].toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (unit === "cl") { amount *= 10; unit = "ml"; }
    else if (/^l|^lit/.test(unit)) unit = "l";
    else if (/^ml|^millilit/.test(unit)) unit = "ml";
    else if (/^kg|^kilogram/.test(unit)) unit = "kg";
    else unit = "g";
    return { amount, unit };
  }

  function productServingDefinition(product) {
    const packageCandidates = [
      product?.quantity,
      product?.product_quantity && product?.product_quantity_unit
        ? `${product.product_quantity} ${product.product_quantity_unit}`
        : ""
    ];
    const packageMeasure = packageCandidates.map(parseProductMeasure).find(Boolean) || null;
    const labelMeasure = parseProductMeasure(product?.serving_size);
    const selected = packageMeasure || labelMeasure || { amount: 1, unit: "unit" };
    const directServingMatches = Boolean(
      labelMeasure
      && labelMeasure.unit === selected.unit
      && Math.abs(labelMeasure.amount - selected.amount) < 0.001
    );
    return { ...selected, useDirectServing: !packageMeasure || directServingMatches };
  }

  function openFoodFactsProduct(product, code) {
    const nutriments = product?.nutriments || {};
    let caloriesPer100 = toNumber(nutriments["energy-kcal_100g"], NaN);
    if (!Number.isFinite(caloriesPer100)) {
      const energyKj = toNumber(nutriments["energy-kj_100g"] ?? nutriments.energy_100g, NaN);
      if (Number.isFinite(energyKj)) caloriesPer100 = energyKj / 4.184;
    }
    const proteinPer100 = toNumber(nutriments.proteins_100g, NaN);
    const fatPer100 = toNumber(nutriments.fat_100g, NaN);
    const carbsPer100 = toNumber(nutriments.carbohydrates_100g, NaN);
    const serving = productServingDefinition(product);
    const metricFactor = ["g", "ml"].includes(serving.unit)
      ? serving.amount / 100
      : serving.unit === "kg" || serving.unit === "l" ? serving.amount * 10 : 1;
    const servingCalories = toNumber(nutriments["energy-kcal_serving"], NaN);
    const servingProtein = toNumber(nutriments.proteins_serving, NaN);
    const servingFat = toNumber(nutriments.fat_serving, NaN);
    const servingCarbs = toNumber(nutriments.carbohydrates_serving, NaN);
    const valueForServing = (per100, direct) => serving.useDirectServing && Number.isFinite(direct)
      ? direct
      : Number.isFinite(per100) ? per100 * metricFactor : "";
    const name = String(product.product_name_es || product.product_name || product.generic_name_es || product.generic_name || "").trim();
    const calories = valueForServing(caloriesPer100, servingCalories);
    const protein = valueForServing(proteinPer100, servingProtein);
    const fat = valueForServing(fatPer100, servingFat);
    const carbs = valueForServing(carbsPer100, servingCarbs);
    const complete = Boolean(name) && [calories, protein, fat, carbs].every(Number.isFinite);
    openScannedFoodEditor({
      name,
      barcode: code,
      brand: String(product.brands || "").trim(),
      calories: Number.isFinite(calories) ? calories : "",
      protein: Number.isFinite(protein) ? protein : "",
      fat: Number.isFinite(fat) ? fat : "",
      carbs: Number.isFinite(carbs) ? carbs : "",
      serving: servingLabel(serving.amount, serving.unit),
      servingAmount: serving.amount,
      servingUnit: serving.unit,
      source: "openfoodfacts",
      sourceUrl: `https://world.openfoodfacts.org/product/${code}`,
      sourceImportedAt: new Date().toISOString(),
      imageUrl: String(product.image_front_small_url || product.image_front_url || "")
    }, complete
      ? "Producto encontrado en Open Food Facts. Revisá la cantidad original del envase y los datos antes de guardarlo."
      : "El producto existe, pero faltan datos. Completá lo que figure en la etiqueta antes de guardarlo.", { allowRescan: true });
  }

  async function fetchOpenFoodFactsProduct(code, fields) {
    const query = new URLSearchParams({ fields, lc: "es" }).toString();
    const candidates = [
      `${OPEN_FOOD_FACTS_PROXY_URL}${encodeURIComponent(code)}?${query}`,
      `${OPEN_FOOD_FACTS_PRODUCT_URL}/${encodeURIComponent(code)}.json?${query}`
    ];
    let lastError = null;

    for (const url of candidates) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      try {
        const response = await fetch(url, {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("json")) throw new Error("La respuesta no es JSON");
        return await response.json();
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError || new Error("No se pudo consultar Open Food Facts");
  }

  async function lookupBarcode(value) {
    if (barcodeLookupBusy) return;
    const code = normalizeBarcode(value);
    if (!validBarcode(code)) {
      setBarcodeStatus("El código debe ser un EAN/UPC válido de 8, 12, 13 o 14 dígitos.", "error");
      return;
    }
    let existing = findFoodByBarcode(code);
    if (!existing && externalFoodsStatus === "loading" && externalFoodsLoadPromise) {
      try { await externalFoodsLoadPromise; } catch (_) {}
      existing = findFoodByBarcode(code);
    }
    if (existing) {
      setBarcodeStatus("Producto encontrado en tu biblioteca.", "success");
      showBarcodeMatch(existing);
      return;
    }
    barcodeLookupBusy = true;
    setBarcodeStatus(`Buscando ${code} en Open Food Facts…`, "loading");
    try {
      const fields = ["code","product_name","product_name_es","generic_name","generic_name_es","brands","quantity","serving_size","product_quantity","product_quantity_unit","nutriments","image_front_small_url","image_front_url"].join(",");
      const data = await fetchOpenFoodFactsProduct(code, fields);
      const productFound = Boolean(data?.product) && (data.status === 1 || data.status === "success" || data.status === undefined);
      if (productFound) openFoodFactsProduct(data.product, code);
      else openScannedFoodEditor(
        { barcode: code, servingAmount: 1, servingUnit: "unit", serving: "1 unidad" },
        `No encontramos un alimento asociado al código ${code}. Completá los datos de la etiqueta y guardalo; la próxima vez M.A.S.A. lo reconocerá.`,
        {
          allowRescan: true,
          sourceNoteType: "warning",
          title: "Alimento no encontrado",
          description: "Solo pudimos leer el código de barras. Podés completar el alimento manualmente o volver a escanear."
        }
      );
    } catch (error) {
      console.warn("No se pudo consultar Open Food Facts:", error);
      openScannedFoodEditor(
        { barcode: code, servingAmount: 1, servingUnit: "unit", serving: "1 unidad" },
        `No pudimos consultar Open Food Facts para el código ${code}. Completá los datos de la etiqueta o volvé a escanear.`,
        {
          allowRescan: true,
          sourceNoteType: "warning",
          title: "No se pudo comprobar el alimento",
          description: "El código quedó cargado. Podés completar los datos manualmente o intentar el escaneo otra vez."
        }
      );
    } finally {
      barcodeLookupBusy = false;
    }
  }

  function submitManualBarcode(event) {
    event.preventDefault();
    lookupBarcode(event.currentTarget.elements.barcode.value);
  }

  function openFoodModal(meal) {
    activeMeal = meal;
    activeFoodMode = "recent";
    activeFoodSelection = null;
    $("#food-meal-label").textContent = `Agregar en ${mealLabel(meal)} · ${formatDate(selectedDiaryDate)}`;
    $("#food-modal").hidden = false;
    const feedback = $("#food-add-feedback");
    feedback.hidden = true;
    feedback.textContent = "";
    $("#food-search-input").value = "";
    document.body.classList.add("modal-open");
    switchFoodMode("recent", false);
    updateFoodSearchDisplay();
    requestAnimationFrame(() => $("#food-search-input")?.focus());
  }

  function modalIsOpen(id) {
    const element = $(`#${id}`);
    return Boolean(element && !element.hidden);
  }

  function updateModalBodyState() {
    const modalIds = [
      "food-modal", "food-editor-modal", "recipe-modal", "library-modal",
      "settings-modal", "meal-picker-modal", "daily-checkin-modal", "confirm-modal", "tips-modal", "about-modal", "barcode-modal"
    ];
    document.body.classList.toggle("modal-open", modalIds.some(modalIsOpen));
  }

  function closeFoodModal() {
    activeFoodSelection = null;
    $("#food-modal").hidden = true;
    updateModalBodyState();
  }

  function hasActiveFoodSearch() {
    return Boolean(String($("#food-search-input")?.value || "").trim());
  }

  function updateFoodSearchDisplay() {
    const searching = hasActiveFoodSearch();
    $("#food-search-panel").hidden = !searching;
    $("#food-browse-area").hidden = searching;
    activeFoodSelection = null;
    if (searching) renderFoodResults();
    else renderActiveFoodMode();
  }

  function switchFoodMode(mode, clearSearch = true) {
    const modes = ["recent", "frequent", "recipe", "quick"];
    activeFoodMode = modes.includes(mode) ? mode : "recent";
    activeFoodSelection = null;
    if (clearSearch && $("#food-search-input")) $("#food-search-input").value = "";
    $$('[data-food-mode]').forEach(button => button.classList.toggle("active", button.dataset.foodMode === activeFoodMode));
    modes.forEach(name => { $(`#food-mode-${name}`).hidden = name !== activeFoodMode; });
    $("#food-search-panel").hidden = true;
    $("#food-browse-area").hidden = false;
    renderActiveFoodMode();
  }

  function renderActiveFoodMode() {
    if (activeFoodMode === "recent") renderRecentFoodResults();
    if (activeFoodMode === "frequent") renderFrequentFoodResults();
    if (activeFoodMode === "recipe") renderRecipeResults();
  }

  function foodUsageKey(item) {
    return String(item?.catalogId || item?.id || "");
  }

  function foodUsageFor(item) {
    return state.foodUsage?.[foodUsageKey(item)] || null;
  }
  function foodUsageForMeal(item, meal = activeMeal) {
    const usage = foodUsageFor(item);
    return usage?.byMeal?.[meal] || usage || null;
  }
  function foodStats(item) {
    const usage = foodUsageFor(item);
    const lastUsed = String(usage?.lastUsed || item?.lastUsed || "");
    const lastUsedAt = String(
      usage?.lastUsedAt || item?.lastUsedAt || (lastUsed ? `${lastUsed}T12:00:00.000Z` : "")
    );
    return {
      uses: Math.max(toNumber(item?.uses, 0), toNumber(usage?.uses, 0)),
      lastUsed,
      lastUsedAt
    };
  }
  function mealFoodStats(item, meal = activeMeal) {
    const usage = foodUsageFor(item)?.byMeal?.[meal];
    const lastUsed = String(usage?.lastUsed || "");
    return {
      uses: Math.max(0, toNumber(usage?.uses, 0)),
      lastUsed,
      lastUsedAt: String(usage?.lastUsedAt || (lastUsed ? `${lastUsed}T12:00:00.000Z` : ""))
    };
  }
  function compareFoodPriority(a, b) {
    const aStats = foodStats(a);
    const bStats = foodStats(b);
    const useDiff = bStats.uses - aStats.uses;
    if (useDiff) return useDiff;
    const recentDiff = bStats.lastUsedAt.localeCompare(aStats.lastUsedAt);
    if (recentDiff) return recentDiff;
    const aLocal = a.kind === "external" ? 0 : 1;
    const bLocal = b.kind === "external" ? 0 : 1;
    if (aLocal !== bLocal) return bLocal - aLocal;
    return String(a.name || "").localeCompare(String(b.name || ""), "es");
  }
  function compareMealFoodPriority(a, b, meal = activeMeal) {
    const aMeal = mealFoodStats(a, meal);
    const bMeal = mealFoodStats(b, meal);
    return bMeal.uses - aMeal.uses
      || bMeal.lastUsedAt.localeCompare(aMeal.lastUsedAt)
      || compareFoodPriority(a, b);
  }
  function compareRecentFoods(a, b) {
    const aMeal = mealFoodStats(a);
    const bMeal = mealFoodStats(b);
    const aStats = foodStats(a);
    const bStats = foodStats(b);
    return bMeal.lastUsedAt.localeCompare(aMeal.lastUsedAt)
      || bMeal.uses - aMeal.uses
      || bStats.lastUsedAt.localeCompare(aStats.lastUsedAt)
      || bStats.uses - aStats.uses
      || String(a.name || "").localeCompare(String(b.name || ""), "es");
  }
  function compareFrequentFoods(a, b) {
    const aMeal = mealFoodStats(a);
    const bMeal = mealFoodStats(b);
    const aStats = foodStats(a);
    const bStats = foodStats(b);
    return bMeal.uses - aMeal.uses
      || bMeal.lastUsedAt.localeCompare(aMeal.lastUsedAt)
      || bStats.uses - aStats.uses
      || bStats.lastUsedAt.localeCompare(aStats.lastUsedAt)
      || String(a.name || "").localeCompare(String(b.name || ""), "es");
  }

  function localLibraryFoods() {
    return [...state.foods, ...state.recipes].sort(compareFoodPriority);
  }

  function findFood(id, kind = "") {
    if (kind === "external" || String(id).startsWith("external:")) {
      return externalFoodsById.get(id) || null;
    }
    if (kind === "recipe") return state.recipes.find(item => item.id === id) || null;
    if (kind === "food") return state.foods.find(item => item.id === id) || null;
    return state.foods.find(item => item.id === id)
      || state.recipes.find(item => item.id === id)
      || externalFoodsById.get(id)
      || null;
  }

  function findFoodByBarcode(value) {
    const barcode = normalizeBarcode(value);
    if (!barcode) return null;
    return state.foods.find(item => normalizeBarcode(item.barcode) === barcode)
      || externalFoods.find(item => normalizeBarcode(item.barcode) === barcode)
      || null;
  }

  function foodSearchText(item) {
    return normalizeHeader([
      item.name,
      item.brand,
      item.barcode,
      ...(Array.isArray(item.aliases) ? item.aliases : []),
      item.sourceName
    ].filter(Boolean).join(" "));
  }

  function searchExternalFoods(query, limit = 50) {
    if (!query) return externalFoods.slice(0, limit);
    const starts = [];
    const contains = [];

    for (const row of externalFoodSearchIndex) {
      if (!row.searchText.includes(query)) continue;
      if (row.nameText.startsWith(query)) {
        if (starts.length < limit) starts.push(row.item);
      } else if (contains.length < limit) {
        contains.push(row.item);
      }
      if (starts.length >= limit && contains.length >= limit) break;
    }

    return [...starts, ...contains].slice(0, limit);
  }

  function usedExternalFoods() {
    return Object.entries(state.foodUsage || {})
      .map(([sourceId, usage]) => {
        const id = sourceId.startsWith("external:") ? sourceId : `external:${sourceId}`;
        return { item: externalFoodsById.get(id), usage };
      })
      .filter(row => row.item && toNumber(row.usage?.uses, 0) > 0)
      .map(row => row.item);
  }

  function allUsedFoods() {
    const local = [...state.foods, ...state.recipes].filter(item => foodStats(item).uses > 0);
    return [...new Map([...local, ...usedExternalFoods()].map(item => [item.id, item])).values()];
  }

  function renderCatalogStatus(container) {
    if (externalFoodsStatus === "loading") {
      container.insertAdjacentHTML("beforeend", '<p class="empty-message">Cargando catálogo de alimentos…</p>');
    }
    if (externalFoodsStatus === "error") {
      container.insertAdjacentHTML("beforeend", `<p class="empty-message">No se pudo cargar el catálogo: ${escapeHTML(externalFoodsError)}</p>`);
    }
  }

  function renderFoodResults() {
    const query = normalizeHeader($("#food-search-input")?.value || "");
    const container = $("#food-results");
    container.innerHTML = "";
    renderCatalogStatus(container);

    if (!query) return;
    const localMatches = localLibraryFoods().filter(item => foodSearchText(item).includes(query));
    const selected = [...localMatches, ...searchExternalFoods(query, 45)];
    const unique = [...new Map(selected.map(item => [item.id, item])).values()]
      .sort((a, b) => compareMealFoodPriority(a, b, activeMeal))
      .slice(0, 35);

    if (!unique.length) {
      if (externalFoodsStatus !== "loading") {
        container.insertAdjacentHTML("beforeend", '<p class="empty-message">No hay coincidencias. Podés crear un alimento propio con ese nombre.</p>');
      }
      return;
    }

    unique.forEach(item => container.appendChild(foodResultButton(item)));
  }

  function renderRecentFoodResults() {
    const container = $("#recent-food-results");
    container.innerHTML = "";
    const items = allUsedFoods().sort(compareRecentFoods).slice(0, 40);
    if (!items.length) {
      container.innerHTML = '<p class="empty-message">Todavía no hay alimentos recientes. Aparecerán después de agregarlos al registro.</p>';
      return;
    }
    items.forEach(item => container.appendChild(foodResultButton(item, "recent")));
  }

  function renderFrequentFoodResults() {
    const container = $("#frequent-food-results");
    container.innerHTML = "";
    const items = allUsedFoods().sort(compareFrequentFoods).slice(0, 40);
    if (!items.length) {
      container.innerHTML = '<p class="empty-message">Todavía no hay consumos suficientes para ordenar tus frecuentes.</p>';
      return;
    }
    items.forEach(item => container.appendChild(foodResultButton(item, "frequent")));
  }

  function renderRecipeResults() {
    const container = $("#recipe-results");
    container.innerHTML = "";
    if (!state.recipes.length) {
      container.innerHTML = '<p class="empty-message">Todavía no guardaste recetas.</p>';
      return;
    }
    [...state.recipes].sort((a, b) => compareMealFoodPriority(a, b, activeMeal)).forEach(item => container.appendChild(foodResultButton(item)));
  }

  const COMMON_UNIT_NAMES = {
    unidad: ["unidad", "unidades"],
    unidades: ["unidad", "unidades"],
    porcion: ["porción", "porciones"],
    porciones: ["porción", "porciones"],
    taza: ["taza", "tazas"],
    tazas: ["taza", "tazas"],
    cucharada: ["cucharada", "cucharadas"],
    cucharadas: ["cucharada", "cucharadas"],
    cucharadita: ["cucharadita", "cucharaditas"],
    cucharaditas: ["cucharadita", "cucharaditas"],
    plato: ["plato", "platos"],
    platos: ["plato", "platos"],
    paquete: ["paquete", "paquetes"],
    paquetes: ["paquete", "paquetes"],
    cookie: ["unidad", "unidades"],
    piece: ["unidad", "unidades"],
    item: ["unidad", "unidades"],
    unit: ["unidad", "unidades"],
    each: ["unidad", "unidades"],
    serving: ["porción", "porciones"],
    portion: ["porción", "porciones"],
    cup: ["taza", "tazas"],
    plate: ["plato", "platos"],
    slice: ["feta", "fetas"],
    sandwich: ["sándwich", "sándwiches"],
    roll: ["rollo", "rollos"],
    bar: ["barra", "barras"],
    tortilla: ["tortilla", "tortillas"],
    cracker: ["galleta", "galletas"],
    wrap: ["wrap", "wraps"],
    donut: ["dona", "donas"],
    burrito: ["burrito", "burritos"],
    muffin: ["muffin", "muffins"],
    bagel: ["bagel", "bagels"],
    fruit: ["unidad", "unidades"],
    packet: ["paquete", "paquetes"],
    wing: ["ala", "alas"],
    bun: ["pan", "panes"],
    pancake: ["panqueque", "panqueques"],
    taco: ["taco", "tacos"],
    skewer: ["brocheta", "brochetas"],
    waffle: ["waffle", "waffles"],
    scoop: ["bocha", "bochas"],
    container: ["recipiente", "recipientes"],
    empanada: ["empanada", "empanadas"],
    pieces: ["unidad", "unidades"],
    g: ["g", "g"],
    kg: ["kg", "kg"],
    ml: ["ml", "ml"],
    l: ["l", "l"],
    fl_oz: ["oz líquida", "oz líquidas"],
    tablespoon: ["cucharada", "cucharadas"],
    tbsp: ["cucharada", "cucharadas"],
    teaspoon: ["cucharadita", "cucharaditas"],
    tsp: ["cucharadita", "cucharaditas"],
    bowl: ["tazón", "tazones"],
    glass: ["vaso", "vasos"],
    can: ["lata", "latas"],
    bottle: ["botella", "botellas"],
    package: ["paquete", "paquetes"],
    oz: ["oz", "oz"]
  };

  function canonicalEditableUnit(rawUnit) {
    const normalized = normalizeHeader(rawUnit).replace(/\s+/g, "_");
    if (/^(g|gr|gramo|gramos|gram)$/.test(normalized)) return "g";
    if (/^(kg|kilo|kilos|kilogramo|kilogramos)$/.test(normalized)) return "kg";
    if (/^(ml|mililitro|mililitros)$/.test(normalized)) return "ml";
    if (/^(l|litro|litros)$/.test(normalized)) return "l";
    if (/^(unidad|unidades|u|unit|units|piece|pieces)$/.test(normalized)) return "unit";
    if (/^(porcion|porciones|serving|servings|portion|portions)$/.test(normalized)) return "serving";
    if (/^(taza|tazas|cup|cups)$/.test(normalized)) return "cup";
    if (/^(cucharada|cucharadas|tablespoon|tablespoons|tbsp)$/.test(normalized)) return "tablespoon";
    if (/^(cucharadita|cucharaditas|teaspoon|teaspoons|tsp)$/.test(normalized)) return "teaspoon";
    if (/^(plato|platos|plate|plates)$/.test(normalized)) return "plate";
    if (/^(feta|fetas|rebanada|rebanadas|slice|slices)$/.test(normalized)) return "slice";
    if (/^(paquete|paquetes|package|packages|packet|packets)$/.test(normalized)) return "package";
    return "custom";
  }

  function editableUnitNames(unit, customUnit = "") {
    if (unit === "custom") {
      const label = String(customUnit || "unidad").trim() || "unidad";
      return [label, label];
    }
    return unitNames(unit);
  }

  function servingLabel(amount, unit, customUnit = "") {
    const [singular, plural] = editableUnitNames(unit, customUnit);
    const label = Math.abs(toNumber(amount, 0) - 1) < 0.0001 ? singular : plural;
    return `${formatQuantityAmount(amount)} ${label}`;
  }

  function setEditableUnitFields(select, customInput, unit, customUnit = "") {
    const optionExists = [...select.options].some(option => option.value === unit);
    select.value = optionExists ? unit : "custom";
    if (select.value === "custom") customInput.value = customUnit || (unit !== "custom" ? unit : "");
    const field = customInput.closest("label");
    field.hidden = select.value !== "custom";
    customInput.required = select.value === "custom";
  }

  function editableUnitFromForm(select, customInput) {
    const unit = select.value || "serving";
    const customUnit = unit === "custom" ? String(customInput.value || "").trim() : "";
    return { unit, customUnit };
  }

  function defaultServingAmountForUnit(unit) {
    return ["g", "ml"].includes(unit) ? 100 : 1;
  }

  function unitNames(rawUnit) {
    const normalized = normalizeHeader(rawUnit).replace(/\s+/g, "_");
    return COMMON_UNIT_NAMES[normalized]
      || [String(rawUnit || "unidad").trim(), String(rawUnit || "unidades").trim()];
  }

  function parseServingDefinition(serving) {
    const raw = String(serving || "1 porción").trim() || "1 porción";
    const match = raw.match(/^([0-9]+(?:[.,][0-9]+)?)\s*(.*)$/);
    const baseAmount = Math.max(0.01, toNumber(match?.[1], 1) || 1);
    const rawUnit = String(match?.[2] || "porción").trim() || "porción";
    const unitKey = canonicalEditableUnit(rawUnit);
    const customUnit = unitKey === "custom" ? rawUnit : "";
    const [singular, plural] = editableUnitNames(unitKey, customUnit);
    return { value: "serving", baseAmount, singular, plural, unitKey, customUnit };
  }

  function foodQuantityOptions(item) {
    if (item.kind !== "external" || item.userOverride) return [parseServingDefinition(item.serving)];

    const options = [{
      value: "g",
      baseAmount: Math.max(0.1, toNumber(item.metricQuantity, 100) || 100),
      singular: "g",
      plural: "g"
    }];

    const commonQuantity = toNumber(item.commonQuantity, 0);
    const commonUnit = String(item.commonUnit || "").trim();
    if (commonQuantity > 0 && commonUnit && !/^(g|gram|grams)$/i.test(commonUnit)) {
      const [singular, plural] = unitNames(commonUnit);
      options.push({
        value: "common",
        baseAmount: commonQuantity,
        singular,
        plural
      });
    }

    return options;
  }

  function defaultFoodQuantity(item) {
    const options = foodQuantityOptions(item);
    const usage = foodUsageForMeal(item, activeMeal);
    const savedOption = options.find(option => option.value === usage?.unit);

    if (usage && savedOption && toNumber(usage.amount, 0) > 0) {
      return { amount: toNumber(usage.amount, savedOption.baseAmount), unit: savedOption.value };
    }

    const databaseOption = item.kind === "external"
      ? options.find(option => option.value === "common")
      : null;
    const option = databaseOption || options[0];
    return { amount: option.baseAmount, unit: option.value };
  }

  function formatQuantityAmount(value) {
    const numeric = toNumber(value, 0);
    const digits = Number.isInteger(numeric) ? 0 : Math.abs(numeric) < 10 ? 2 : 1;
    return formatNumber(numeric, digits);
  }

  function quantityUnitText(option, amount) {
    return Math.abs(toNumber(amount, 0) - 1) < 0.0001 ? option.singular : option.plural;
  }

  function quantityPreview(item, amount, unit) {
    const options = foodQuantityOptions(item);
    const option = options.find(candidate => candidate.value === unit) || options[0];
    const factor = Math.max(0, toNumber(amount, 0)) / option.baseAmount;
    return {
      calories: item.calories * factor,
      protein: item.protein * factor,
      fat: item.fat * factor,
      carbs: item.carbs * factor,
      option,
      factor
    };
  }

  function foodResultButton(item, context = "") {
    const wrapper = document.createElement("div");
    const selected = activeFoodSelection?.id === item.id && activeFoodSelection?.kind === item.kind;
    const stats = foodStats(item);
    wrapper.className = `food-result-card${selected ? " active" : ""}`;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "food-result";
    button.dataset.selectFood = item.id;
    button.dataset.foodKind = item.kind;
    button.setAttribute("aria-expanded", selected ? "true" : "false");

    const recipeDetail = item.kind === "recipe" && item.ingredients?.length
      ? `${item.ingredients.length} ingredientes · ${item.serving}`
      : item.serving;
    let usageDetail = "";
    if (context === "recent" && stats.lastUsed) usageDetail = ` · Último: ${formatDate(stats.lastUsed)}`;
    if (context === "frequent") usageDetail = ` · ${stats.uses} ${stats.uses === 1 ? "consumo" : "consumos"}`;

    const originBadge = item.kind === "food"
      ? `<span class="food-origin-badge food-origin-own">${item.source === "openfoodfacts" ? "Escaneado" : "Propio"}</span>`
      : item.kind === "external" && item.userOverride
        ? '<span class="food-origin-badge food-origin-edited">Editado</span>'
        : "";
    button.innerHTML = `<div><div class="food-result-name"><b>${escapeHTML(item.name)}</b>${originBadge}</div><small>${escapeHTML(recipeDetail)} · P ${formatNumber(item.protein,1)} · G ${formatNumber(item.fat,1)} · C ${formatNumber(item.carbs,1)}${escapeHTML(usageDetail)}</small></div><span>${formatNumber(Math.round(item.calories))} kcal</span>`;
    wrapper.appendChild(button);

    if (!selected) return wrapper;

    const defaults = defaultFoodQuantity(item);
    const options = foodQuantityOptions(item);
    const preview = quantityPreview(item, defaults.amount, defaults.unit);
    const form = document.createElement("form");
    form.className = `food-inline-add${item.kind === "external" ? " has-catalog-actions" : ""}`;
    form.dataset.foodAddForm = "";
    form.dataset.foodId = item.id;
    form.dataset.foodKind = item.kind;
    form.dataset.currentUnit = defaults.unit;
    form.innerHTML = `
      <label>
        <span>Cantidad consumida</span>
        <input name="amount" type="number" min="0.01" max="100000" step="any" inputmode="decimal" value="${escapeHTML(defaults.amount)}" required>
      </label>
      <label>
        <span>Unidad</span>
        <select name="unit" ${options.length === 1 ? "disabled" : ""}>
          ${options.map(option => `<option value="${escapeHTML(option.value)}" ${option.value === defaults.unit ? "selected" : ""}>${escapeHTML(option.plural)}</option>`).join("")}
        </select>
      </label>
      <div class="food-inline-preview" aria-live="polite">
        <b data-food-preview-calories>${formatNumber(Math.round(preview.calories))} kcal</b>
        <small data-food-preview-macros>P ${formatNumber(preview.protein,1)} · G ${formatNumber(preview.fat,1)} · C ${formatNumber(preview.carbs,1)}</small>
      </div>
      ${item.kind === "external" ? `<div class="food-catalog-actions"><button class="text-action" data-edit-catalog-food="${escapeHTML(item.id)}" type="button">Editar alimento</button><button class="danger-text-action" data-hide-catalog-food="${escapeHTML(item.id)}" type="button">Ocultar</button></div>` : ""}
      <div class="food-inline-actions">
        <button class="text-action" data-cancel-food type="button">Cancelar</button>
        <button class="primary-action" type="submit">Agregar</button>
      </div>`;
    wrapper.appendChild(form);
    return wrapper;
  }

  function activeFoodResultsSection() {
    return hasActiveFoodSearch() ? $("#food-search-panel") : $(`#food-mode-${activeFoodMode}`);
  }

  function focusSelectedFoodAmount() {
    requestAnimationFrame(() => {
      const section = activeFoodResultsSection();
      const form = section?.querySelector('.food-result-card.active .food-inline-add');
      const input = form?.querySelector('input[name="amount"]');
      if (isMobileLayout()) form?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      window.setTimeout(() => {
        input?.focus({ preventScroll: true });
        input?.select();
      }, isMobileLayout() ? 260 : 0);
    });
  }

  function renderCurrentFoodResults() {
    if (hasActiveFoodSearch()) renderFoodResults();
    else renderActiveFoodMode();
  }

  function selectFoodInline(id, kind) {
    activeFoodSelection = { id, kind };
    renderCurrentFoodResults();
    focusSelectedFoodAmount();
  }

  function cancelFoodInline() {
    activeFoodSelection = null;
    renderCurrentFoodResults();
  }

  function updateFoodQuantityPreview(form) {
    const item = findFood(form.dataset.foodId, form.dataset.foodKind);
    if (!item) return;
    const amount = toNumber(form.elements.amount.value, 0);
    const unit = form.elements.unit?.value || form.dataset.currentUnit;
    const preview = quantityPreview(item, amount, unit);
    form.querySelector('[data-food-preview-calories]').textContent = `${formatNumber(Math.round(preview.calories))} kcal`;
    form.querySelector('[data-food-preview-macros]').textContent = `P ${formatNumber(preview.protein,1)} · G ${formatNumber(preview.fat,1)} · C ${formatNumber(preview.carbs,1)}`;
  }

  function changeFoodQuantityUnit(form) {
    const item = findFood(form.dataset.foodId, form.dataset.foodKind);
    if (!item || !form.elements.unit) return;
    form.dataset.currentUnit = form.elements.unit.value;
    updateFoodQuantityPreview(form);
    form.elements.amount.focus();
  }

  function showFoodAddedFeedback() {
    const feedback = $("#food-add-feedback");
    if (!feedback) return;
    feedback.textContent = "";
    feedback.hidden = true;
  }

  function prepareNextFoodEntry() {
    activeFoodSelection = null;
    $("#food-search-input").value = "";
    updateFoodSearchDisplay();
    requestAnimationFrame(() => $("#food-search-input")?.focus());
  }

  function addLibraryFood(id, kind, amountValue, unitValue) {
    const item = findFood(id, kind);
    if (!item) return;

    const amount = toNumber(amountValue, NaN);
    const options = foodQuantityOptions(item);
    const option = options.find(candidate => candidate.value === unitValue) || options[0];
    if (!Number.isFinite(amount) || amount <= 0 || !option) return;

    const preview = quantityPreview(item, amount, option.value);
    const serving = `${formatQuantityAmount(amount)} ${quantityUnitText(option, amount)}`;
    const sourceId = foodUsageKey(item);
    const entry = normalizeDiaryEntry({
      ...item,
      id: createId(),
      sourceId,
      quantity: amount,
      quantityUnit: option.value,
      serving,
      calories: preview.calories,
      protein: preview.protein,
      fat: preview.fat,
      carbs: preview.carbs,
      meal: activeMeal
    });

    if (!entry) return;

    const usedAt = new Date().toISOString();
    state.diary[selectedDiaryDate] = [...todayDiary(), entry];
    state.foodUsage ||= {};
    const previousUsage = state.foodUsage[sourceId] || {};
    const previousMealUsage = previousUsage.byMeal?.[activeMeal] || {};
    state.foodUsage[sourceId] = {
      amount,
      unit: option.value,
      uses: Math.max(0, Math.round(toNumber(previousUsage.uses, 0))) + 1,
      lastUsed: selectedDiaryDate,
      lastUsedAt: usedAt,
      byMeal: {
        ...(previousUsage.byMeal || {}),
        [activeMeal]: {
          amount,
          unit: option.value,
          uses: Math.max(0, Math.round(toNumber(previousMealUsage.uses, 0))) + 1,
          lastUsed: selectedDiaryDate,
          lastUsedAt: usedAt
        }
      }
    };

    if (item.kind !== "external") {
      item.uses = toNumber(item.uses,0) + 1;
      item.lastUsed = selectedDiaryDate;
      item.lastUsedAt = usedAt;
    }

    saveState(state);
    render();
    showFoodAddedFeedback(item.name, serving);
    prepareNextFoodEntry();
  }

  function queueFoodSearch() {
    clearTimeout(foodSearchTimer);
    foodSearchTimer = setTimeout(() => {
      activeFoodSelection = null;
      updateFoodSearchDisplay();
    }, 120);
  }

  function handleFoodResultClick(event) {
    const editCatalog = event.target.closest("[data-edit-catalog-food]");
    if (editCatalog) {
      openFoodEditor({ catalogId: editCatalog.dataset.editCatalogFood, returnTarget: "food" });
      return;
    }
    const hideCatalog = event.target.closest("[data-hide-catalog-food]");
    if (hideCatalog) {
      hideCatalogFood(hideCatalog.dataset.hideCatalogFood);
      return;
    }
    if (event.target.closest("[data-cancel-food]")) {
      cancelFoodInline();
      return;
    }
    const button = event.target.closest("[data-select-food]");
    if (!button) return;
    selectFoodInline(button.dataset.selectFood, button.dataset.foodKind);
  }

  function handleFoodResultSubmit(event) {
    const form = event.target.closest("[data-food-add-form]");
    if (!form) return;
    event.preventDefault();
    addLibraryFood(
      form.dataset.foodId,
      form.dataset.foodKind,
      form.elements.amount.value,
      form.elements.unit?.value || form.dataset.currentUnit
    );
  }

  function handleFoodResultInput(event) {
    const form = event.target.closest("[data-food-add-form]");
    if (!form || event.target.name !== "amount") return;
    updateFoodQuantityPreview(form);
  }

  function handleFoodResultChange(event) {
    const form = event.target.closest("[data-food-add-form]");
    if (!form || event.target.name !== "unit") return;
    changeFoodQuantityUnit(form);
  }

  function addQuickCalories(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const item = normalizeDiaryEntry({
      id: createId(),
      name: form.elements.name.value,
      calories,
      protein: 0, fat: 0, carbs: 0,
      serving: "carga libre",
      meal: activeMeal
    });
    if (!item) return;
    state.diary[selectedDiaryDate] = [...todayDiary(), item];
    saveState(state);
    const addedName = item.name;
    const addedCalories = Math.round(item.calories);
    form.reset();
    render();
    showFoodAddedFeedback(addedName, `${formatNumber(addedCalories)} kcal`);
    requestAnimationFrame(() => form.elements.name.focus());
  }

  function openLibraryManager(returnTarget = "food") {
    if (returnTarget instanceof Event) returnTarget = "food";
    libraryReturnTarget = returnTarget || "food";
    renderLibraryManager();
    $("#library-modal").hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeLibraryManager() {
    $("#library-modal").hidden = true;
    updateModalBodyState();
  }

  function searchEntireCatalog(query, limit = 40) {
    const normalizedQuery = normalizeHeader(query || "");
    if (!normalizedQuery) return [];
    const starts = [];
    const contains = [];

    for (const base of externalFoodCatalog) {
      const item = effectiveCatalogFood(base, state.catalogOverrides?.[base.id]);
      const nameText = normalizeHeader(item.name);
      const searchText = `${foodSearchText(item)} ${foodSearchText(base)}`;
      if (!searchText.includes(normalizedQuery)) continue;
      const target = nameText.startsWith(normalizedQuery) ? starts : contains;
      if (target.length < limit) target.push(item);
      if (starts.length >= limit && contains.length >= limit) break;
    }

    return [...starts, ...contains].slice(0, limit);
  }

  function libraryCatalogSearchCard(item) {
    const article = document.createElement("article");
    const override = state.catalogOverrides?.[item.id];
    const status = override?.hidden ? "Oculto" : override ? "Editado" : "Catálogo general";
    article.className = `library-item library-catalog-search-item${override?.hidden ? " catalog-hidden" : ""}`;
    article.innerHTML = `
      <div><div class="library-item-title"><b>${escapeHTML(item.name)}</b>${override ? '<span class="food-origin-badge food-origin-edited">Editado</span>' : ""}</div><small>${escapeHTML(status)} · ${escapeHTML(item.serving)} · ${formatNumber(Math.round(item.calories))} kcal</small></div>
      <div class="library-item-actions"><button class="text-action" data-edit-library="${escapeHTML(item.id)}" data-library-kind="external" type="button">Editar</button></div>`;
    return article;
  }

  function renderLibraryCatalogSearchResults() {
    const panel = $("#library-catalog-search-panel");
    const input = $("#library-catalog-search-input");
    const container = $("#library-catalog-search-results");
    if (!panel || !input || !container || panel.hidden) return;
    const query = input.value.trim();
    container.innerHTML = "";
    if (!query) {
      container.innerHTML = '<p class="empty-message">Escribí un nombre para buscar en toda la base.</p>';
      return;
    }
    if (externalFoodsStatus === "loading") {
      container.innerHTML = '<p class="empty-message">Cargando catálogo de alimentos…</p>';
      return;
    }
    const results = searchEntireCatalog(query);
    if (!results.length) {
      container.innerHTML = '<p class="empty-message">No se encontraron alimentos con ese nombre.</p>';
      return;
    }
    results.forEach(item => container.appendChild(libraryCatalogSearchCard(item)));
  }

  function queueLibraryCatalogSearch() {
    clearTimeout(libraryCatalogSearchTimer);
    libraryCatalogSearchTimer = setTimeout(renderLibraryCatalogSearchResults, 120);
  }

  function toggleLibraryCatalogSearch() {
    const panel = $("#library-catalog-search-panel");
    const button = $("#library-search-catalog");
    const input = $("#library-catalog-search-input");
    const opening = panel.hidden;
    panel.hidden = !opening;
    button.setAttribute("aria-expanded", String(opening));
    button.textContent = opening ? "Cerrar búsqueda" : "Buscar alimento de la base";
    if (opening) {
      renderLibraryCatalogSearchResults();
      requestAnimationFrame(() => input.focus());
    }
  }

  function libraryItemCard(item, options = {}) {
    const article = document.createElement("article");
    article.className = "library-item";
    const detail = item.kind === "recipe"
      ? `${item.ingredients?.length || 0} ingredientes · ${item.serving}`
      : item.serving;
    if (options.catalog) {
      const hidden = Boolean(options.override?.hidden);
      article.classList.toggle("catalog-hidden", hidden);
      article.innerHTML = `
        <div><b>${escapeHTML(item.name)}</b><small>${hidden ? "Oculto de tu catálogo" : `${escapeHTML(detail)} · ${formatNumber(Math.round(item.calories))} kcal`}</small></div>
        <div class="library-item-actions">
          <button class="text-action" data-edit-library="${escapeHTML(item.id)}" data-library-kind="external" type="button">Editar</button>
          <button class="text-action" data-restore-catalog="${escapeHTML(item.id)}" type="button">Restaurar original</button>
        </div>`;
      return article;
    }
    article.innerHTML = `
      <div><b>${escapeHTML(item.name)}</b><small>${escapeHTML(detail)} · ${formatNumber(Math.round(item.calories))} kcal</small></div>
      <div class="library-item-actions">
        <button class="text-action" data-edit-library="${escapeHTML(item.id)}" data-library-kind="${escapeHTML(item.kind)}" type="button">Editar</button>
        <button class="danger-text-action" data-delete-library="${escapeHTML(item.id)}" data-library-kind="${escapeHTML(item.kind)}" type="button">Borrar</button>
      </div>`;
    return article;
  }

  function renderLibraryManager() {
    const foodList = $("#library-food-list");
    const recipeList = $("#library-recipe-list");
    const catalogList = $("#library-catalog-list");
    foodList.innerHTML = "";
    recipeList.innerHTML = "";
    catalogList.innerHTML = "";
    $("#library-food-count").textContent = state.foods.length;
    $("#library-recipe-count").textContent = state.recipes.length;
    const catalogEntries = Object.entries(state.catalogOverrides || {});
    $("#library-catalog-count").textContent = catalogEntries.length;

    if (!state.foods.length) foodList.innerHTML = '<p class="empty-message">No creaste alimentos propios.</p>';
    else [...state.foods].sort((a,b) => a.name.localeCompare(b.name, "es")).forEach(item => foodList.appendChild(libraryItemCard(item)));

    if (!state.recipes.length) recipeList.innerHTML = '<p class="empty-message">No creaste recetas.</p>';
    else [...state.recipes].sort((a,b) => a.name.localeCompare(b.name, "es")).forEach(item => recipeList.appendChild(libraryItemCard(item)));

    if (!catalogEntries.length) catalogList.innerHTML = '<p class="empty-message">Todavía no modificaste alimentos del catálogo general.</p>';
    else catalogEntries
      .map(([id, override]) => ({ item: catalogFoodForEditing(id), override }))
      .filter(row => row.item)
      .sort((a,b) => a.item.name.localeCompare(b.item.name, "es"))
      .forEach(row => catalogList.appendChild(libraryItemCard(row.item, { catalog: true, override: row.override })));
    renderLibraryCatalogSearchResults();
  }

  function handleLibraryClick(event) {
    const restore = event.target.closest("[data-restore-catalog]");
    if (restore) {
      restoreCatalogFood(restore.dataset.restoreCatalog);
      return;
    }
    const edit = event.target.closest("[data-edit-library]");
    if (edit) {
      const options = { editId: edit.dataset.editLibrary, returnTarget: "library" };
      if (edit.dataset.libraryKind === "recipe") openRecipeEditor(options);
      else if (edit.dataset.libraryKind === "external") openFoodEditor({ catalogId: edit.dataset.editLibrary, returnTarget: "library" });
      else openFoodEditor(options);
      return;
    }

    const remove = event.target.closest("[data-delete-library]");
    if (!remove) return;
    const id = remove.dataset.deleteLibrary;
    const kind = remove.dataset.libraryKind;
    const item = findFood(id, kind);
    if (!item) return;
    const recipeUseCount = kind === "food"
      ? state.recipes.filter(recipe => recipe.ingredients?.some(ingredient => ingredient.foodId === id || ingredient.sourceId === id)).length
      : 0;
    const suffix = recipeUseCount ? `\n\nAparece en ${recipeUseCount} receta(s). Esas recetas conservarán los valores guardados del ingrediente.` : "";
    if (!window.confirm(`¿Borrar “${item.name}” de tu biblioteca?${suffix}`)) return;

    if (kind === "recipe") state.recipes = state.recipes.filter(recipe => recipe.id !== id);
    else state.foods = state.foods.filter(food => food.id !== id);
    delete state.foodUsage?.[foodUsageKey(item)];
    saveState(state);
    renderLibraryManager();
    renderActiveFoodMode();
  }

  function hideCatalogFood(id) {
    const base = externalFoodCatalogById.get(id);
    if (!base) return;
    state.catalogOverrides ||= {};
    state.catalogOverrides[id] = normalizeCatalogOverride({ ...(state.catalogOverrides[id] || {}), id, hidden: true });
    delete state.foodUsage?.[foodUsageKey(base)];
    saveState(state);
    rebuildExternalFoodCatalog();
    activeFoodSelection = null;
    renderCurrentFoodResults();
    if (!$("#library-modal")?.hidden) renderLibraryManager();
  }

  function restoreCatalogFood(id) {
    if (!state.catalogOverrides?.[id]) return;
    delete state.catalogOverrides[id];
    saveState(state);
    rebuildExternalFoodCatalog();
    renderLibraryManager();
    renderCurrentFoodResults();
    if (!$("#recipe-modal")?.hidden) renderRecipeIngredientResults();
  }

  function openFoodEditor(options = {}) {
    if (options instanceof Event) options = {};
    editingFoodId = options.editId || null;
    editingCatalogFoodId = options.catalogId || null;
    foodEditorPrefill = options.prefillFood ? clone(options.prefillFood) : null;
    foodEditorReturnTarget = options.returnTarget || (modalIsOpen("library-modal") ? "library" : "food");
    const form = $("#food-editor-form");
    form.reset();
    $("#food-editor-error").hidden = true;
    const item = editingCatalogFoodId
      ? catalogFoodForEditing(editingCatalogFoodId)
      : editingFoodId ? state.foods.find(food => food.id === editingFoodId) : null;
    const displayItem = item || foodEditorPrefill;

    $("#food-editor-title").textContent = options.title || (item ? "Editar alimento" : foodEditorPrefill ? "Revisar alimento escaneado" : "Nuevo alimento");
    $("#food-editor-description").textContent = options.description || (editingCatalogFoodId
      ? "Los cambios quedan solamente en tu cuenta."
      : item ? "Los cambios también recalculan las recetas que usan este alimento."
      : foodEditorPrefill ? "Revisá los datos antes de incorporarlo a tu biblioteca." : "Guardalo una vez y reutilizalo en registros y recetas.");
    $("#save-food-editor").textContent = item ? "Guardar cambios" : "Guardar alimento";
    const sourceNote = $("#food-editor-source-note");
    sourceNote.hidden = !options.sourceNote;
    sourceNote.textContent = options.sourceNote || "";
    sourceNote.classList.toggle("warning", options.sourceNoteType === "warning");
    sourceNote.classList.toggle("success", options.sourceNoteType === "success");
    $("#rescan-food-editor").hidden = !options.allowRescan;
    $("#close-food-editor").hidden = Boolean(options.allowRescan);
    $(".food-editor-scan-row").hidden = Boolean(item || editingCatalogFoodId);

    if (displayItem) {
      const parsed = parseServingDefinition(displayItem.serving);
      form.elements.name.value = displayItem.name || "";
      form.elements.barcode.value = normalizeBarcode(displayItem.barcode);
      form.elements.brand.value = displayItem.brand || "";
      const editorCalories = toNumber(displayItem.calories, NaN);
      form.elements.calories.value = Number.isFinite(editorCalories) ? roundEditorNumber(editorCalories, 0) : "";
      form.elements.servingAmount.value = roundEditorNumber(displayItem.servingAmount || displayItem.metricQuantity || parsed.baseAmount, 2);
      setEditableUnitFields(
        form.elements.servingUnit,
        form.elements.servingUnitCustom,
        displayItem.servingUnit || parsed.unitKey,
        displayItem.servingUnitCustom || parsed.customUnit
      );
      ["protein", "fat", "carbs"].forEach(key => {
        const value = toNumber(displayItem[key], NaN);
        form.elements[key].value = Number.isFinite(value) ? roundEditorNumber(value, 1) : "";
      });
    } else {
      form.elements.servingAmount.value = 1;
      setEditableUnitFields(form.elements.servingUnit, form.elements.servingUnitCustom, "unit");
      if (options.prefillName) form.elements.name.value = options.prefillName;
    }

    if (foodEditorReturnTarget === "library") $("#library-modal").hidden = true;
    if (foodEditorReturnTarget === "recipe") $("#recipe-modal").hidden = true;
    $("#food-editor-modal").hidden = false;
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => form.elements.name.focus());
  }

  function closeFoodEditor() {
    $("#food-editor-modal").hidden = true;
    const target = foodEditorReturnTarget;
    foodEditorReturnTarget = "";
    editingFoodId = null;
    editingCatalogFoodId = null;
    foodEditorPrefill = null;
    $("#rescan-food-editor").hidden = true;
    $("#close-food-editor").hidden = false;
    $("#food-editor-source-note").classList.remove("warning", "success");
    if (target === "food") $("#food-modal").hidden = false;
    if (target === "library") {
      renderLibraryManager();
      $("#library-modal").hidden = false;
    }
    if (target === "recipe") {
      $("#recipe-modal").hidden = false;
      renderRecipeIngredientResults();
      renderRecipeIngredientList();
    }
    updateModalBodyState();
  }

  function recipeTotals(ingredients = recipeDraftIngredients) {
    return ingredients.reduce((totals, ingredient) => ({
      calories: totals.calories + toNumber(ingredient.calories, 0),
      protein: totals.protein + toNumber(ingredient.protein, 0),
      fat: totals.fat + toNumber(ingredient.fat, 0),
      carbs: totals.carbs + toNumber(ingredient.carbs, 0)
    }), { calories: 0, protein: 0, fat: 0, carbs: 0 });
  }

  function recalculateRecipe(recipe) {
    if (!recipe?.ingredients?.length) return recipe;
    const totals = recipeTotals(recipe.ingredients);
    const yieldCount = Math.max(0.01, toNumber(recipe.recipeYield, 1) || 1);
    const servingAmount = Math.max(0.01, toNumber(recipe.recipeServingAmount, parseServingDefinition(recipe.serving).baseAmount) || 1);
    const factor = servingAmount / yieldCount;
    recipe.calories = totals.calories * factor;
    recipe.protein = totals.protein * factor;
    recipe.fat = totals.fat * factor;
    recipe.carbs = totals.carbs * factor;
    return recipe;
  }

  function refreshRecipesUsingFood(food) {
    const sourceId = foodUsageKey(food);
    state.recipes.forEach(recipe => {
      let changed = false;
      recipe.ingredients = (recipe.ingredients || []).map(ingredient => {
        if (ingredient.foodId !== food.id && ingredient.sourceId !== sourceId) return ingredient;
        const options = foodQuantityOptions(food);
        const option = options.find(candidate => candidate.value === ingredient.unit) || options[0];
        const preview = quantityPreview(food, ingredient.amount, option.value);
        changed = true;
        return normalizeRecipeIngredient({
          ...ingredient,
          sourceId,
          foodId: food.id,
          kind: food.kind,
          name: food.name,
          unit: option.value,
          serving: `${formatQuantityAmount(ingredient.amount)} ${quantityUnitText(option, ingredient.amount)}`,
          calories: preview.calories,
          protein: preview.protein,
          fat: preview.fat,
          carbs: preview.carbs
        });
      }).filter(Boolean);
      if (changed) recalculateRecipe(recipe);
    });
  }

  function saveCustomFood(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const previous = editingFoodId ? state.foods.find(food => food.id === editingFoodId) : null;
    const previousCatalog = editingCatalogFoodId ? catalogFoodForEditing(editingCatalogFoodId) : null;
    const sourceData = previous || foodEditorPrefill || {};
    const barcode = normalizeBarcode(form.elements.barcode.value);
    const editorError = $("#food-editor-error");
    editorError.hidden = true;
    if (barcode && !validBarcode(barcode)) {
      editorError.textContent = "El código de barras no es válido.";
      editorError.hidden = false;
      form.elements.barcode.focus();
      return;
    }
    const duplicate = barcode && state.foods.find(food => food.id !== previous?.id && normalizeBarcode(food.barcode) === barcode);
    if (duplicate) {
      editorError.textContent = `Ese código ya pertenece a ${duplicate.name}.`;
      editorError.hidden = false;
      return;
    }
    const unitData = editableUnitFromForm(form.elements.servingUnit, form.elements.servingUnitCustom);
    if (unitData.unit === "custom" && !unitData.customUnit) {
      form.elements.servingUnitCustom.focus();
      return;
    }
    const servingAmount = Math.max(0.01, roundEditorNumber(form.elements.servingAmount.value, 2) || 1);
    const calories = roundEditorNumber(form.elements.calories.value, 0);
    const protein = roundEditorNumber(form.elements.protein.value, 1);
    const fat = roundEditorNumber(form.elements.fat.value, 1);
    const carbs = roundEditorNumber(form.elements.carbs.value, 1);
    if (editingCatalogFoodId && previousCatalog) {
      state.catalogOverrides ||= {};
      state.catalogOverrides[editingCatalogFoodId] = normalizeCatalogOverride({
        id: editingCatalogFoodId,
        hidden: false,
        name: form.elements.name.value,
        calories,
        serving: servingLabel(servingAmount, unitData.unit, unitData.customUnit),
        servingAmount,
        servingUnit: unitData.unit,
        servingUnitCustom: unitData.customUnit,
        protein,
        fat,
        carbs
      });
      rebuildExternalFoodCatalog();
      const updated = catalogFoodForEditing(editingCatalogFoodId);
      if (updated) refreshRecipesUsingFood(updated);
      saveState(state);
      const target = foodEditorReturnTarget;
      $("#food-editor-modal").hidden = true;
      editingCatalogFoodId = null;
      editingFoodId = null;
      foodEditorReturnTarget = "";
      if (target === "library") {
        renderLibraryManager();
        $("#library-modal").hidden = false;
      } else if (target === "recipe") {
        $("#recipe-modal").hidden = false;
        renderRecipeIngredientResults();
        renderRecipeIngredientList();
      } else if (modalIsOpen("food-modal")) {
        updateFoodSearchDisplay();
      } else render();
      updateModalBodyState();
      return;
    }

    const item = normalizeFood({
      id: previous?.id || createId(),
      kind: "food",
      name: form.elements.name.value,
      barcode,
      brand: form.elements.brand.value,
      source: sourceData.source || "",
      sourceUrl: sourceData.sourceUrl || "",
      sourceImportedAt: sourceData.sourceImportedAt || "",
      imageUrl: sourceData.imageUrl || "",
      calories,
      serving: servingLabel(servingAmount, unitData.unit, unitData.customUnit),
      servingAmount,
      servingUnit: unitData.unit,
      servingUnitCustom: unitData.customUnit,
      protein,
      fat,
      carbs,
      uses: previous?.uses || 0,
      lastUsed: previous?.lastUsed || "",
      lastUsedAt: previous?.lastUsedAt || ""
    });
    if (!item) return;

    if (previous) state.foods = state.foods.map(food => food.id === previous.id ? item : food);
    else state.foods.push(item);
    refreshRecipesUsingFood(item);
    saveState(state);

    const target = foodEditorReturnTarget;
    $("#food-editor-modal").hidden = true;
    editingFoodId = null;
    editingCatalogFoodId = null;
    foodEditorPrefill = null;
    foodEditorReturnTarget = "";

    if (target === "recipe") {
      const defaults = defaultFoodQuantity(item);
      addRecipeDraftIngredient(item, defaults.amount, defaults.unit);
      $("#recipe-modal").hidden = false;
      $("#recipe-ingredient-search").value = "";
      renderRecipeIngredientResults();
      renderRecipeIngredientList();
    } else if (target === "library") {
      renderLibraryManager();
      $("#library-modal").hidden = false;
    } else if (target === "food" || modalIsOpen("food-modal")) {
      $("#food-modal").hidden = false;
      $("#food-search-input").value = item.name;
      updateFoodSearchDisplay();
      activeFoodSelection = { id: item.id, kind: "food" };
      renderFoodResults();
      focusSelectedFoodAmount();
    } else {
      render();
    }
    updateModalBodyState();
  }

  function openRecipeEditor(options = {}) {
    if (options instanceof Event) options = {};
    editingRecipeId = options.editId || null;
    recipeEditorReturnTarget = options.returnTarget || (modalIsOpen("library-modal") ? "library" : "food");
    const form = $("#recipe-form");
    form.reset();
    const recipe = editingRecipeId ? state.recipes.find(item => item.id === editingRecipeId) : null;
    recipeDraftIngredients = recipe?.ingredients ? clone(recipe.ingredients) : [];
    activeRecipeIngredientSelection = null;

    $("#recipe-title").textContent = recipe ? "Editar receta" : "Crear receta por ingredientes";
    $("#recipe-description").textContent = recipe
      ? "Modificá ingredientes, cantidades o porciones; los valores se recalculan automáticamente."
      : "Buscá cada ingrediente en la base, indicá su cantidad y agregalo a la receta.";
    $("#save-recipe").textContent = recipe ? "Guardar cambios" : "Guardar receta";
    const parsedServing = parseServingDefinition(recipe?.serving || "1 porción");
    form.elements.name.value = recipe?.name || "";
    form.elements.yield.value = recipe?.recipeYield || 1;
    form.elements.servingAmount.value = recipe?.recipeServingAmount || recipe?.servingAmount || parsedServing.baseAmount || 1;
    setEditableUnitFields(
      form.elements.yieldUnit,
      form.elements.yieldUnitCustom,
      recipe?.recipeYieldUnit || recipe?.servingUnit || parsedServing.unitKey || "serving",
      recipe?.recipeYieldUnitCustom || recipe?.servingUnitCustom || parsedServing.customUnit
    );
    form.elements.yieldUnit.dataset.currentUnit = form.elements.yieldUnit.value;
    $("#recipe-ingredient-search").value = "";
    $("#recipe-error").hidden = true;

    if (recipeEditorReturnTarget === "library") $("#library-modal").hidden = true;
    $("#recipe-modal").hidden = false;
    document.body.classList.add("modal-open");
    renderRecipeIngredientResults();
    renderRecipeIngredientList();
    requestAnimationFrame(() => form.elements.name.focus());
  }

  function closeRecipeEditor() {
    $("#recipe-modal").hidden = true;
    activeRecipeIngredientSelection = null;
    recipeDraftIngredients = [];
    editingRecipeId = null;
    const target = recipeEditorReturnTarget;
    recipeEditorReturnTarget = "";
    if (target === "library") {
      renderLibraryManager();
      $("#library-modal").hidden = false;
    }
    updateModalBodyState();
  }

  function recipeIngredientCandidates(query) {
    const local = state.foods.filter(item => !query || foodSearchText(item).includes(query));
    let external = [];
    if (query) external = searchExternalFoods(query, 30);
    else {
      const recentFoods = allUsedFoods().filter(item => item.kind !== "recipe").sort(compareRecentFoods);
      external = [...recentFoods, ...externalFoods.slice(0, 12)];
    }
    return [...new Map([...local, ...external].filter(item => item.kind !== "recipe").map(item => [item.id, item])).values()].slice(0, 24);
  }

  function renderRecipeIngredientResults() {
    const container = $("#recipe-ingredient-results");
    const rawQuery = $("#recipe-ingredient-search")?.value || "";
    const query = normalizeHeader(rawQuery);
    const candidates = recipeIngredientCandidates(query);
    container.innerHTML = "";
    if (externalFoodsStatus === "loading") renderCatalogStatus(container);
    candidates.forEach(item => container.appendChild(recipeIngredientResultButton(item)));

    if (!candidates.length && externalFoodsStatus !== "loading") {
      container.innerHTML = '<p class="empty-message">No encontramos ese ingrediente en la base.</p>';
    }

    const exactMatch = query && candidates.some(item => normalizeHeader(item.name) === query);
    const createButton = $("#create-missing-ingredient");
    createButton.hidden = !query || exactMatch;
    createButton.textContent = query ? `Crear “${rawQuery.trim()}”` : "Crear alimento nuevo";
  }

  function recipeIngredientResultButton(item) {
    const wrapper = document.createElement("div");
    const selected = activeRecipeIngredientSelection?.id === item.id && activeRecipeIngredientSelection?.kind === item.kind;
    wrapper.className = `food-result-card${selected ? " active" : ""}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "food-result";
    button.dataset.selectRecipeIngredient = item.id;
    button.dataset.foodKind = item.kind;
    const originBadge = item.kind === "food"
      ? `<span class="food-origin-badge food-origin-own">${item.source === "openfoodfacts" ? "Escaneado" : "Propio"}</span>`
      : item.kind === "external" && item.userOverride
        ? '<span class="food-origin-badge food-origin-edited">Editado</span>'
        : "";
    button.innerHTML = `<div><div class="food-result-name"><b>${escapeHTML(item.name)}</b>${originBadge}</div><small>${escapeHTML(item.serving)} · P ${formatNumber(item.protein,1)} · G ${formatNumber(item.fat,1)} · C ${formatNumber(item.carbs,1)}</small></div><span>${formatNumber(Math.round(item.calories))} kcal</span>`;
    wrapper.appendChild(button);
    if (!selected) return wrapper;

    const defaults = defaultFoodQuantity(item);
    const options = foodQuantityOptions(item);
    const preview = quantityPreview(item, defaults.amount, defaults.unit);
    const controls = document.createElement("div");
    controls.className = "food-inline-add recipe-inline-add";
    controls.dataset.recipeIngredientAdd = "";
    controls.dataset.foodId = item.id;
    controls.dataset.foodKind = item.kind;
    controls.dataset.currentUnit = defaults.unit;
    controls.innerHTML = `
      <label><span>Cantidad</span><input name="amount" type="number" min="0.01" step="any" inputmode="decimal" value="${escapeHTML(defaults.amount)}"></label>
      <label><span>Unidad</span><select name="unit" ${options.length === 1 ? "disabled" : ""}>${options.map(option => `<option value="${escapeHTML(option.value)}" ${option.value === defaults.unit ? "selected" : ""}>${escapeHTML(option.plural)}</option>`).join("")}</select></label>
      <div class="food-inline-preview"><b data-recipe-preview-calories>${formatNumber(Math.round(preview.calories))} kcal</b><small data-recipe-preview-macros>P ${formatNumber(preview.protein,1)} · G ${formatNumber(preview.fat,1)} · C ${formatNumber(preview.carbs,1)}</small></div>
      <div class="food-inline-actions"><button class="text-action" data-cancel-recipe-ingredient type="button">Cancelar</button><button class="primary-action" data-add-recipe-ingredient type="button">Agregar</button></div>`;
    wrapper.appendChild(controls);
    return wrapper;
  }

  function updateRecipeIngredientPreview(controls) {
    const item = findFood(controls.dataset.foodId, controls.dataset.foodKind);
    if (!item) return;
    const amount = toNumber(controls.querySelector('[name="amount"]').value, 0);
    const unitSelect = controls.querySelector('[name="unit"]');
    const unit = unitSelect?.value || controls.dataset.currentUnit;
    const preview = quantityPreview(item, amount, unit);
    controls.querySelector('[data-recipe-preview-calories]').textContent = `${formatNumber(Math.round(preview.calories))} kcal`;
    controls.querySelector('[data-recipe-preview-macros]').textContent = `P ${formatNumber(preview.protein,1)} · G ${formatNumber(preview.fat,1)} · C ${formatNumber(preview.carbs,1)}`;
  }

  function changeRecipeIngredientUnit(controls) {
    const item = findFood(controls.dataset.foodId, controls.dataset.foodKind);
    const select = controls.querySelector('[name="unit"]');
    if (!item || !select) return;
    controls.dataset.currentUnit = select.value;
    updateRecipeIngredientPreview(controls);
  }

  function addRecipeDraftIngredient(item, amountValue, unitValue) {
    const amount = toNumber(amountValue, NaN);
    const options = foodQuantityOptions(item);
    const option = options.find(candidate => candidate.value === unitValue) || options[0];
    if (!Number.isFinite(amount) || amount <= 0 || !option) return;
    const preview = quantityPreview(item, amount, option.value);
    const ingredient = normalizeRecipeIngredient({
      id: createId(),
      sourceId: foodUsageKey(item),
      foodId: item.id,
      kind: item.kind,
      name: item.name,
      amount,
      unit: option.value,
      serving: `${formatQuantityAmount(amount)} ${quantityUnitText(option, amount)}`,
      calories: preview.calories,
      protein: preview.protein,
      fat: preview.fat,
      carbs: preview.carbs
    });
    if (!ingredient) return;

    const duplicate = recipeDraftIngredients.find(existing => existing.sourceId === ingredient.sourceId && existing.unit === ingredient.unit);
    if (duplicate) {
      duplicate.amount += ingredient.amount;
      duplicate.calories += ingredient.calories;
      duplicate.protein += ingredient.protein;
      duplicate.fat += ingredient.fat;
      duplicate.carbs += ingredient.carbs;
      duplicate.serving = `${formatQuantityAmount(duplicate.amount)} ${quantityUnitText(option, duplicate.amount)}`;
    } else {
      recipeDraftIngredients.push(ingredient);
    }
    activeRecipeIngredientSelection = null;
    $("#recipe-error").hidden = true;
    renderRecipeIngredientList();
  }

  function handleRecipeIngredientSearchClick(event) {
    if (event.target.closest("[data-cancel-recipe-ingredient]")) {
      activeRecipeIngredientSelection = null;
      renderRecipeIngredientResults();
      return;
    }
    const add = event.target.closest("[data-add-recipe-ingredient]");
    if (add) {
      const controls = add.closest("[data-recipe-ingredient-add]");
      const item = findFood(controls.dataset.foodId, controls.dataset.foodKind);
      if (!item) return;
      addRecipeDraftIngredient(
        item,
        controls.querySelector('[name="amount"]').value,
        controls.querySelector('[name="unit"]')?.value || controls.dataset.currentUnit
      );
      $("#recipe-ingredient-search").value = "";
      renderRecipeIngredientResults();
      return;
    }
    const select = event.target.closest("[data-select-recipe-ingredient]");
    if (!select) return;
    activeRecipeIngredientSelection = { id: select.dataset.selectRecipeIngredient, kind: select.dataset.foodKind };
    renderRecipeIngredientResults();
    requestAnimationFrame(() => {
      const input = $("#recipe-ingredient-results .food-result-card.active input[name='amount']");
      input?.focus();
      input?.select();
    });
  }

  function handleRecipeIngredientSearchInput(event) {
    const controls = event.target.closest("[data-recipe-ingredient-add]");
    if (!controls || event.target.name !== "amount") return;
    updateRecipeIngredientPreview(controls);
  }

  function handleRecipeIngredientSearchChange(event) {
    const controls = event.target.closest("[data-recipe-ingredient-add]");
    if (!controls || event.target.name !== "unit") return;
    changeRecipeIngredientUnit(controls);
  }

  function queueRecipeIngredientSearch() {
    clearTimeout(recipeSearchTimer);
    recipeSearchTimer = setTimeout(() => {
      activeRecipeIngredientSelection = null;
      renderRecipeIngredientResults();
    }, 120);
  }

  function draftIngredientFood(ingredient) {
    return findFood(ingredient.foodId, ingredient.kind)
      || findFood(ingredient.sourceId, ingredient.kind)
      || null;
  }

  function renderRecipeIngredientList() {
    const container = $("#recipe-ingredient-list");
    container.innerHTML = "";
    $("#recipe-ingredient-count").textContent = recipeDraftIngredients.length;
    if (!recipeDraftIngredients.length) {
      container.innerHTML = '<p class="empty-message">Buscá un alimento y agregalo con la cantidad usada en la receta.</p>';
      renderRecipeTotals();
      return;
    }

    recipeDraftIngredients.forEach((ingredient, index) => {
      const food = draftIngredientFood(ingredient);
      const options = food ? foodQuantityOptions(food) : [{ value: ingredient.unit, baseAmount: ingredient.amount, singular: ingredient.unit, plural: ingredient.unit }];
      const row = document.createElement("article");
      row.className = "recipe-ingredient-row";
      row.dataset.recipeIngredientIndex = index;
      row.dataset.currentUnit = ingredient.unit;
      row.innerHTML = `
        <div class="recipe-ingredient-name"><b>${escapeHTML(ingredient.name)}</b><small data-draft-nutrition>${formatNumber(Math.round(ingredient.calories))} kcal · P ${formatNumber(ingredient.protein,1)} · G ${formatNumber(ingredient.fat,1)} · C ${formatNumber(ingredient.carbs,1)}</small></div>
        <label><span>Cantidad</span><input name="draftAmount" type="number" min="0.01" step="any" value="${escapeHTML(ingredient.amount)}"></label>
        <label><span>Unidad</span><select name="draftUnit" ${options.length === 1 ? "disabled" : ""}>${options.map(option => `<option value="${escapeHTML(option.value)}" ${option.value === ingredient.unit ? "selected" : ""}>${escapeHTML(option.plural)}</option>`).join("")}</select></label>
        <button class="danger-text-action" data-remove-recipe-ingredient="${index}" type="button">Quitar</button>`;
      container.appendChild(row);
    });
    renderRecipeTotals();
  }

  function updateDraftIngredientRow(row, changeUnit = false) {
    const index = Number(row.dataset.recipeIngredientIndex);
    const ingredient = recipeDraftIngredients[index];
    if (!ingredient) return;
    const food = draftIngredientFood(ingredient);
    const amountInput = row.querySelector('[name="draftAmount"]');
    const unitSelect = row.querySelector('[name="draftUnit"]');

    if (changeUnit && food && unitSelect) {
      row.dataset.currentUnit = unitSelect.value;
    }

    const amount = Math.max(0.01, toNumber(amountInput.value, ingredient.amount));
    const unit = unitSelect?.value || ingredient.unit;
    if (food) {
      const option = foodQuantityOptions(food).find(candidate => candidate.value === unit) || foodQuantityOptions(food)[0];
      const preview = quantityPreview(food, amount, option.value);
      Object.assign(ingredient, {
        amount,
        unit: option.value,
        name: food.name,
        serving: `${formatQuantityAmount(amount)} ${quantityUnitText(option, amount)}`,
        calories: preview.calories,
        protein: preview.protein,
        fat: preview.fat,
        carbs: preview.carbs
      });
    } else {
      const factor = amount / Math.max(0.01, ingredient.amount);
      ingredient.amount = amount;
      ingredient.calories *= factor;
      ingredient.protein *= factor;
      ingredient.fat *= factor;
      ingredient.carbs *= factor;
    }
    row.querySelector('[data-draft-nutrition]').textContent = `${formatNumber(Math.round(ingredient.calories))} kcal · P ${formatNumber(ingredient.protein,1)} · G ${formatNumber(ingredient.fat,1)} · C ${formatNumber(ingredient.carbs,1)}`;
    renderRecipeTotals();
  }

  function handleRecipeIngredientListClick(event) {
    const remove = event.target.closest("[data-remove-recipe-ingredient]");
    if (!remove) return;
    recipeDraftIngredients.splice(Number(remove.dataset.removeRecipeIngredient), 1);
    renderRecipeIngredientList();
  }

  function handleRecipeIngredientListInput(event) {
    const row = event.target.closest("[data-recipe-ingredient-index]");
    if (!row || event.target.name !== "draftAmount") return;
    updateDraftIngredientRow(row, false);
  }

  function handleRecipeIngredientListChange(event) {
    const row = event.target.closest("[data-recipe-ingredient-index]");
    if (!row || event.target.name !== "draftUnit") return;
    updateDraftIngredientRow(row, true);
  }

  function renderRecipeTotals() {
    const form = $("#recipe-form");
    const yieldCount = Math.max(0.01, toNumber(form?.elements.yield.value, 1) || 1);
    const servingAmount = Math.max(0.01, toNumber(form?.elements.servingAmount.value, 1) || 1);
    let totals = recipeTotals();
    if (!recipeDraftIngredients.length && editingRecipeId) {
      const legacy = state.recipes.find(recipe => recipe.id === editingRecipeId);
      if (legacy) {
        const legacyServingAmount = Math.max(0.01, toNumber(legacy.recipeServingAmount, parseServingDefinition(legacy.serving).baseAmount) || 1);
        const completeFactor = yieldCount / legacyServingAmount;
        totals = {
          calories: legacy.calories * completeFactor,
          protein: legacy.protein * completeFactor,
          fat: legacy.fat * completeFactor,
          carbs: legacy.carbs * completeFactor
        };
      }
    }
    const factor = servingAmount / yieldCount;
    const serving = {
      calories: totals.calories * factor,
      protein: totals.protein * factor,
      fat: totals.fat * factor,
      carbs: totals.carbs * factor
    };
    const unitData = editableUnitFromForm(form.elements.yieldUnit, form.elements.yieldUnitCustom);
    $("#recipe-total-calories").textContent = `${formatNumber(Math.round(totals.calories))} kcal`;
    $("#recipe-total-macros").textContent = `P ${formatNumber(totals.protein,1)} · G ${formatNumber(totals.fat,1)} · C ${formatNumber(totals.carbs,1)}`;
    $("#recipe-serving-label").textContent = `Por ${servingLabel(servingAmount, unitData.unit, unitData.customUnit)}`;
    $("#recipe-serving-calories").textContent = `${formatNumber(Math.round(serving.calories))} kcal`;
    $("#recipe-serving-macros").textContent = `P ${formatNumber(serving.protein,1)} · G ${formatNumber(serving.fat,1)} · C ${formatNumber(serving.carbs,1)}`;
  }

  function saveRecipe(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const previous = editingRecipeId ? state.recipes.find(recipe => recipe.id === editingRecipeId) : null;
    const error = $("#recipe-error");
    if (!recipeDraftIngredients.length && !previous) {
      error.textContent = "Agregá al menos un ingrediente antes de guardar la receta.";
      error.hidden = false;
      return;
    }

    const yieldCount = Math.max(0.01, toNumber(form.elements.yield.value, 1) || 1);
    const servingAmount = Math.max(0.01, toNumber(form.elements.servingAmount.value, 1) || 1);
    const unitData = editableUnitFromForm(form.elements.yieldUnit, form.elements.yieldUnitCustom);
    if (unitData.unit === "custom" && !unitData.customUnit) {
      form.elements.yieldUnitCustom.focus();
      return;
    }
    const totals = recipeDraftIngredients.length ? recipeTotals() : null;
    const factor = servingAmount / yieldCount;
    const item = normalizeFood({
      id: previous?.id || createId(),
      kind: "recipe",
      name: form.elements.name.value,
      serving: servingLabel(servingAmount, unitData.unit, unitData.customUnit),
      servingAmount,
      servingUnit: unitData.unit,
      servingUnitCustom: unitData.customUnit,
      recipeYield: yieldCount,
      recipeYieldUnit: unitData.unit,
      recipeYieldUnitCustom: unitData.customUnit,
      recipeServingAmount: servingAmount,
      ingredients: clone(recipeDraftIngredients),
      calories: totals ? totals.calories * factor : previous.calories,
      protein: totals ? totals.protein * factor : previous.protein,
      fat: totals ? totals.fat * factor : previous.fat,
      carbs: totals ? totals.carbs * factor : previous.carbs,
      uses: previous?.uses || 0,
      lastUsed: previous?.lastUsed || "",
      lastUsedAt: previous?.lastUsedAt || ""
    });
    if (!item) return;

    if (previous) state.recipes = state.recipes.map(recipe => recipe.id === previous.id ? item : recipe);
    else state.recipes.push(item);
    saveState(state);

    const target = recipeEditorReturnTarget;
    $("#recipe-modal").hidden = true;
    editingRecipeId = null;
    recipeDraftIngredients = [];
    activeRecipeIngredientSelection = null;
    recipeEditorReturnTarget = "";

    if (target === "library") {
      renderLibraryManager();
      $("#library-modal").hidden = false;
    } else if (modalIsOpen("food-modal")) {
      switchFoodMode("recipe");
      activeFoodSelection = { id: item.id, kind: "recipe" };
      renderRecipeResults();
      focusSelectedFoodAmount();
    } else {
      render();
    }
    updateModalBodyState();
  }

  function diaryEntrySource(entry) {
    const sourceId = String(entry?.sourceId || "");
    if (!sourceId) return normalizeFood(entry);
    return state.foods.find(item => item.id === sourceId)
      || state.recipes.find(item => item.id === sourceId)
      || externalFoodsById.get(sourceId)
      || externalFoodsById.get(`external:${sourceId}`)
      || catalogFoodForEditing(sourceId)
      || catalogFoodForEditing(`external:${sourceId}`)
      || normalizeFood(entry);
  }

  function updateDiaryEditPreview(form) {
    const entry = todayDiary().find(item => item.id === form.dataset.diaryEditForm);
    const source = diaryEntrySource(entry);
    if (!entry || !source) return;
    const unit = form.elements.unit?.value || entry.quantityUnit;
    const preview = quantityPreview(source, toNumber(form.elements.amount.value, 0), unit);
    const label = form.querySelector("[data-diary-edit-preview]");
    if (label) label.textContent = `${formatNumber(Math.round(preview.calories))} kcal`;
  }

  function closeDiaryEntryEditor() {
    if (!editingDiaryEntryId) return;
    editingDiaryEntryId = null;
    renderDiary(calculatePlan());
  }

  function handleDiaryEntryClick(event) {
    const removeButton = event.target.closest("[data-remove-diary]");
    if (removeButton) {
      event.stopPropagation();
      state.diary[selectedDiaryDate] = todayDiary().filter(item => item.id !== removeButton.dataset.removeDiary);
      if (editingDiaryEntryId === removeButton.dataset.removeDiary) editingDiaryEntryId = null;
      saveState(state);
      render();
      return;
    }

    const editCard = event.target.closest(".meal-item[data-edit-diary]");
    if (editCard) {
      editingDiaryEntryId = editCard.dataset.editDiary;
      renderDiary(calculatePlan());
      requestAnimationFrame(() => document.querySelector('[data-diary-edit-form] input[name="amount"]')?.select());
      return;
    }

    if (editingDiaryEntryId && !event.target.closest(".meal-item.editing")) closeDiaryEntryEditor();
  }

  function closeDiaryEditorFromOutside(event) {
    if (!editingDiaryEntryId) return;
    if (event.target.closest("#meal-grid")) return;
    closeDiaryEntryEditor();
  }

  function handleDiaryEntryEditInput(event) {
    const form = event.target.closest("[data-diary-edit-form]");
    if (!form || !["amount", "unit"].includes(event.target.name)) return;
    updateDiaryEditPreview(form);
  }

  function submitDiaryEntryEdit(event) {
    const form = event.target.closest("[data-diary-edit-form]");
    if (!form) return;
    event.preventDefault();
    const entries = todayDiary();
    const index = entries.findIndex(item => item.id === form.dataset.diaryEditForm);
    if (index < 0) return;
    const entry = entries[index];
    const source = diaryEntrySource(entry);
    const amount = toNumber(form.elements.amount.value, NaN);
    const unit = form.elements.unit?.value || entry.quantityUnit;
    if (!source || !Number.isFinite(amount) || amount <= 0) return;
    const preview = quantityPreview(source, amount, unit);
    const option = preview.option;
    entries[index] = normalizeDiaryEntry({
      ...entry,
      quantity: amount,
      quantityUnit: option.value,
      serving: `${formatQuantityAmount(amount)} ${quantityUnitText(option, amount)}`,
      calories: preview.calories,
      protein: preview.protein,
      fat: preview.fat,
      carbs: preview.carbs
    });
    state.diary[selectedDiaryDate] = entries;
    editingDiaryEntryId = null;
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

  function latestAutomaticReview() {
    return [...(state.calibrationHistory || [])]
      .filter(item => normalizeDate(item?.date))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .at(-1) || null;
  }
  function automaticReviewTiming() {
    const latestReview = latestAutomaticReview();
    const lastReviewDate = normalizeDate(latestReview?.date);
    const nextReviewDate = lastReviewDate
      ? toISODate(addDays(parseDate(lastReviewDate), EXPENDITURE_CONFIG.reviewIntervalDays))
      : "";
    const reviewDue = !nextReviewDate || parseDate(todayISO()) >= parseDate(nextReviewDate);
    return { latestReview, lastReviewDate, nextReviewDate, reviewDue };
  }
  function expenditureProgress(intakeDays = 0, spanDays = 0, weighInCount = 0) {
    const intake = clamp(intakeDays / EXPENDITURE_CONFIG.minIntakeDays, 0, 1);
    const span = clamp(spanDays / EXPENDITURE_CONFIG.minSpanDays, 0, 1);
    const weigh = clamp(weighInCount / EXPENDITURE_CONFIG.minWeighIns, 0, 1);
    return Math.round((intake + span + weigh) / 3 * 100);
  }
  function expenditureConfidence({ intakeDays, completedDays, weighInCount, spanDays }) {
    const intakeDepth = clamp((intakeDays - EXPENDITURE_CONFIG.minIntakeDays) / 14, 0, 1);
    const weighDepth = clamp((weighInCount - EXPENDITURE_CONFIG.minWeighIns) / 8, 0, 1);
    const spanDepth = clamp((spanDays - EXPENDITURE_CONFIG.minSpanDays) / 17, 0, 1);
    const completionRatio = clamp(completedDays / Math.max(1, intakeDays), 0, 1);
    const score = clamp(0.25 + intakeDepth * 0.25 + weighDepth * 0.20 + spanDepth * 0.20 + completionRatio * 0.10, 0.25, 1);
    const alpha = clamp(0.15 + score * 0.35, 0.20, 0.50);
    const label = score >= 0.72 ? "Alta" : score >= 0.45 ? "Media" : "Baja";
    return { score, alpha, label };
  }
  function automaticAdjustmentData(profile = state.profile, plan = calculatePlan(profile, state.weighIns), weighIns = state.weighIns) {
    const timing = automaticReviewTiming();
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

    const base = {
      ready: false,
      status: "learning",
      intakeDays: 0,
      completedDays: 0,
      weighInCount: 0,
      spanDays: 0,
      progress: 0,
      confidenceLabel: "Inicial",
      confidenceScore: 0,
      alpha: 0,
      calendarDue: timing.reviewDue,
      reviewDue: timing.reviewDue,
      hasNewData: !timing.lastReviewDate,
      newIntakeDays: 0,
      newWeighIns: 0,
      nextReviewDate: timing.nextReviewDate,
      lastReviewDate: timing.lastReviewDate,
      currentTarget: plan.targetCalories,
      currentMaintenance: plan.maintenance
    };

    if (!allLogged.length) {
      return { ...base, reason: "Todavía no hay ingestas registradas. El gasto adaptativo empieza a aprender cuando registrás comidas y pesajes." };
    }

    const latestDate = allLogged.at(-1).date;
    const recentStart = addDays(latestDate, -(EXPENDITURE_CONFIG.windowDays - 1));
    const recentLogged = allLogged.filter(day => day.date >= recentStart && day.date <= latestDate);
    const recentCompleted = recentLogged.filter(day => day.completed);
    const completedOnly = recentCompleted.length >= EXPENDITURE_CONFIG.minIntakeDays;
    const used = completedOnly ? recentCompleted : recentLogged;
    const firstDate = used[0]?.date;
    const lastDate = used.at(-1)?.date;
    const spanDays = firstDate && lastDate ? Math.round(daysBetween(firstDate, lastDate)) + 1 : 0;
    const relatedWeighIns = firstDate && lastDate
      ? [...weighIns].filter(item => {
          const date = parseDate(item.date);
          return date && date >= addDays(firstDate, -3) && date <= addDays(lastDate, 3);
        }).sort((a, b) => a.date.localeCompare(b.date))
      : [];
    const newIntakeDays = timing.lastReviewDate
      ? used.filter(day => day.iso > timing.lastReviewDate).length
      : used.length;
    const newWeighIns = timing.lastReviewDate
      ? relatedWeighIns.filter(item => item.date > timing.lastReviewDate).length
      : relatedWeighIns.length;
    const hasNewData = !timing.lastReviewDate
      || (newIntakeDays >= EXPENDITURE_CONFIG.minNewIntakeDays
        && newWeighIns >= EXPENDITURE_CONFIG.minNewWeighIns);
    const progress = expenditureProgress(used.length, spanDays, relatedWeighIns.length);
    const common = {
      ...base,
      calendarDue: timing.reviewDue,
      reviewDue: timing.reviewDue && hasNewData,
      hasNewData,
      newIntakeDays,
      newWeighIns,
      intakeDays: used.length,
      completedDays: recentCompleted.length,
      completedOnly,
      weighInCount: relatedWeighIns.length,
      spanDays,
      progress,
      firstDate,
      lastDate
    };

    if (used.length < EXPENDITURE_CONFIG.minIntakeDays) {
      return {
        ...common,
        reason: `Faltan ${EXPENDITURE_CONFIG.minIntakeDays - used.length} días de ingestas para la primera estimación.`
      };
    }
    if (spanDays < EXPENDITURE_CONFIG.minSpanDays) {
      return {
        ...common,
        reason: `Los registros cubren ${spanDays} días. Se necesitan ${EXPENDITURE_CONFIG.minSpanDays} para separar el ruido diario de la tendencia.`
      };
    }
    if (relatedWeighIns.length < EXPENDITURE_CONFIG.minWeighIns) {
      return {
        ...common,
        reason: `Hay ${relatedWeighIns.length} pesajes comparables en el período. Se necesitan ${EXPENDITURE_CONFIG.minWeighIns}.`
      };
    }

    const trendedWeighIns = exponentialWeightTrend(relatedWeighIns);
    const observedWeekly = regressionRatePerWeek(trendedWeighIns, 60, "trend");
    if (!Number.isFinite(observedWeekly) || !Number.isFinite(plan.targetCalories) || !Number.isFinite(plan.dailyAdjustment) || !Number.isFinite(plan.maintenance)) {
      return { ...common, reason: "No se pudo calcular una tendencia estable con los datos actuales." };
    }

    const averageCalories = used.reduce((sum, day) => sum + day.calories, 0) / used.length;
    const observedMaintenance = averageCalories - observedWeekly * KG_KCAL / 7;
    if (!Number.isFinite(observedMaintenance) || observedMaintenance < 1000 || observedMaintenance > 6000) {
      return {
        ...common,
        reason: "Los datos producen un gasto fuera de un rango plausible. Revisá días incompletos, cantidades y pesajes."
      };
    }

    const confidence = expenditureConfidence({
      intakeDays: used.length,
      completedDays: recentCompleted.length,
      weighInCount: relatedWeighIns.length,
      spanDays
    });
    const adaptiveMaintenance = plan.maintenance * (1 - confidence.alpha) + observedMaintenance * confidence.alpha;
    const recommendedTarget = adaptiveMaintenance + plan.dailyAdjustment;
    const rawChange = recommendedTarget - plan.targetCalories;
    const limitedChange = clamp(Math.round(rawChange), -EXPENDITURE_CONFIG.maxAdjustment, EXPENDITURE_CONFIG.maxAdjustment);
    const currentOffset = toNumber(profile.calibrationOffset, 0);
    const newOffset = clamp(currentOffset + limitedChange, -900, 900);
    const appliedChange = newOffset - currentOffset;
    const meaningful = Math.abs(appliedChange) >= EXPENDITURE_CONFIG.minMeaningfulAdjustment;
    const status = !timing.reviewDue
      ? "waiting"
      : !hasNewData
        ? "waiting-data"
        : meaningful ? "ready" : "stable";
    const latestTrend = trendedWeighIns.at(-1)?.trend ?? relatedWeighIns.at(-1)?.weight;

    return {
      ...common,
      ready: true,
      status,
      progress: 100,
      averageCalories,
      observedWeekly,
      observedMaintenance,
      adaptiveMaintenance,
      currentMaintenance: plan.maintenance,
      confidenceLabel: confidence.label,
      confidenceScore: confidence.score,
      alpha: confidence.alpha,
      recommendedTarget,
      rawChange,
      appliedChange,
      newOffset,
      meaningful,
      latest: relatedWeighIns.at(-1),
      latestTrend,
      limited: Math.abs(rawChange) > EXPENDITURE_CONFIG.maxAdjustment
    };
  }
  function buildRecalibrationSuggestion(profile, plan, weighIns) {
    const suggestion = automaticAdjustmentData(profile, plan, weighIns);
    return suggestion.ready && suggestion.reviewDue ? suggestion : null;
  }
  function automaticAdjustmentSummary(suggestion) {
    if (!suggestion?.ready) return suggestion?.reason || "Todavía no hay datos suficientes.";
    const direction = suggestion.observedWeekly < -0.01 ? "bajando" : suggestion.observedWeekly > 0.01 ? "subiendo" : "estable";
    const sourceText = suggestion.completedOnly
      ? `${suggestion.intakeDays} días terminados`
      : `${suggestion.intakeDays} días con ingestas; cerrar días completos aumenta la confianza`;
    const modelText = `El gasto observado es ${formatNumber(Math.round(suggestion.observedMaintenance))} kcal y el gasto adaptativo usado por M.A.S.A. queda en ${formatNumber(Math.round(suggestion.adaptiveMaintenance))} kcal, con confianza ${suggestion.confidenceLabel.toLowerCase()}.`;
    if (!suggestion.calendarDue) {
      return `Con ${sourceText} y ${suggestion.weighInCount} pesajes, el peso viene ${direction} ${formatNumber(Math.abs(suggestion.observedWeekly), 2)} kg/semana. ${modelText} La próxima revisión corresponde el ${formatDate(suggestion.nextReviewDate)}.`;
    }
    if (!suggestion.hasNewData) {
      const missingIntakes = Math.max(0, EXPENDITURE_CONFIG.minNewIntakeDays - suggestion.newIntakeDays);
      const missingWeights = Math.max(0, EXPENDITURE_CONFIG.minNewWeighIns - suggestion.newWeighIns);
      return `La fecha mínima de revisión ya llegó, pero M.A.S.A. espera datos nuevos para no recalcular con el mismo período. Faltan ${missingIntakes} días de ingesta y ${missingWeights} pesajes posteriores a la última revisión.`;
    }
    if (!suggestion.meaningful) {
      return `Con ${sourceText} y ${suggestion.weighInCount} pesajes, el peso viene ${direction} ${formatNumber(Math.abs(suggestion.observedWeekly), 2)} kg/semana. ${modelText} El objetivo actual está suficientemente cerca y no necesita cambiar.`;
    }
    const nextTarget = suggestion.currentTarget + suggestion.appliedChange;
    return `Con ${sourceText} y ${suggestion.weighInCount} pesajes, el peso viene ${direction} ${formatNumber(Math.abs(suggestion.observedWeekly), 2)} kg/semana. ${modelText} El objetivo pasaría de ${formatNumber(Math.round(suggestion.currentTarget))} a ${formatNumber(Math.round(nextTarget))} kcal por día (${suggestion.appliedChange > 0 ? "+" : ""}${formatNumber(suggestion.appliedChange)}).${suggestion.limited ? ` Por seguridad, cada revisión se limita a ${EXPENDITURE_CONFIG.maxAdjustment} kcal.` : ""}`;
  }
  function renderAutomaticAdjustmentPreview(profile, plan, weighIns = state.weighIns) {
    const suggestion = automaticAdjustmentData(profile, plan, weighIns);
    const summary = $("#automatic-adjustment-summary");
    const facts = $("#automatic-adjustment-facts");
    const button = $("#run-auto-adjustment");
    if (!summary || !facts || !button) return suggestion;
    summary.textContent = automaticAdjustmentSummary(suggestion);
    facts.innerHTML = `<div><span>Gasto adaptativo</span><b>${suggestion.ready ? `${formatNumber(Math.round(suggestion.adaptiveMaintenance))} kcal` : "Aprendiendo"}</b></div><div><span>Confianza</span><b>${suggestion.confidenceLabel}</b></div><div><span>Datos útiles</span><b>${suggestion.intakeDays || 0} d · ${suggestion.weighInCount || 0} p</b></div><div><span>Próxima revisión</span><b>${!suggestion.ready ? "Al completar datos" : suggestion.reviewDue ? "Disponible" : suggestion.calendarDue ? "Faltan datos nuevos" : formatDate(suggestion.nextReviewDate)}</b></div>`;
    button.disabled = !suggestion.ready || !suggestion.reviewDue;
    button.textContent = !suggestion.ready
      ? `Aprendiendo · ${suggestion.progress}%`
      : !suggestion.calendarDue
        ? `Próxima revisión ${formatDate(suggestion.nextReviewDate)}`
        : !suggestion.hasNewData
          ? "Faltan registros nuevos"
        : suggestion.meaningful
          ? "Aplicar reajuste"
          : "Registrar revisión sin cambios";
    return suggestion;
  }
  function applyAutomaticAdjustment(suggestion, profile = state.profile) {
    if (!suggestion?.ready || !suggestion.reviewDue) return null;
    const adjusted = Boolean(suggestion.meaningful);
    if (adjusted) {
      profile.calibrationOffset = suggestion.newOffset;
      profile.planStartDate = suggestion.latest?.date || todayISO();
      profile.planStartWeight = Number(toNumber(suggestion.latestTrend, suggestion.latest?.weight).toFixed(2));
    }
    state.calibrationHistory = [...(state.calibrationHistory || []), {
      date: todayISO(),
      intakeDays: suggestion.intakeDays,
      completedDays: suggestion.completedDays,
      weighInCount: suggestion.weighInCount,
      spanDays: suggestion.spanDays,
      averageCalories: Math.round(suggestion.averageCalories),
      observedWeekly: Number(suggestion.observedWeekly.toFixed(3)),
      observedMaintenance: Math.round(suggestion.observedMaintenance),
      adaptiveMaintenance: Math.round(suggestion.adaptiveMaintenance),
      confidence: Number(suggestion.confidenceScore.toFixed(3)),
      alpha: Number(suggestion.alpha.toFixed(3)),
      previousTarget: Math.round(suggestion.currentTarget),
      targetChange: adjusted ? suggestion.appliedChange : 0,
      newOffset: adjusted ? suggestion.newOffset : toNumber(profile.calibrationOffset, 0),
      reviewOnly: !adjusted
    }].slice(-30);
    return { adjusted };
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
      setFeedback(feedback, `Antes de revisar: ${validationError.message}`, true);
      focusProfileField(validationError.field);
      return;
    }
    const suggestion = automaticAdjustmentData(draft, plan, temporaryWeighIns);
    if (!suggestion.ready) {
      setFeedback(feedback, suggestion.reason, true);
      return;
    }
    if (!suggestion.calendarDue) {
      setFeedback(feedback, `La próxima revisión corresponde el ${formatDate(suggestion.nextReviewDate)}.`);
      return;
    }
    if (!suggestion.hasNewData) {
      setFeedback(feedback, `La fecha mínima ya llegó, pero se necesitan al menos ${EXPENDITURE_CONFIG.minNewIntakeDays} días de ingesta y ${EXPENDITURE_CONFIG.minNewWeighIns} pesajes posteriores a la última revisión.`);
      return;
    }
    const nextTarget = Math.round(suggestion.currentTarget + (suggestion.meaningful ? suggestion.appliedChange : 0));
    const prompt = suggestion.meaningful
      ? `M.A.S.A. propone llevar el objetivo diario a ${formatNumber(nextTarget)} kcal. La corrección es gradual y usa ${suggestion.intakeDays} días de ingestas, ${suggestion.weighInCount} pesajes y confianza ${suggestion.confidenceLabel.toLowerCase()}. ¿Aplicar el reajuste?`
      : "La revisión semanal no encontró una diferencia suficiente para cambiar el objetivo. ¿Registrar la revisión sin cambios?";
    if (!window.confirm(prompt)) return;
    state.weighIns = temporaryWeighIns;
    state.profile = draft;
    const result = applyAutomaticAdjustment(suggestion, state.profile);
    if (!result) return;
    state.configured = true;
    saveState(state);
    fillProfileForm();
    updateProfilePreview();
    setFeedback(feedback, result.adjusted
      ? `Reajuste aplicado. Nuevo objetivo aproximado: ${formatNumber(nextTarget)} kcal por día.`
      : `Revisión registrada. El objetivo se mantiene; la próxima revisión será el ${formatDate(toISODate(addDays(parseDate(todayISO()), EXPENDITURE_CONFIG.reviewIntervalDays)))}.`);
    render();
  }
  function renderRecalibration(profile, plan, weighIns) {
    const data = automaticAdjustmentData(profile, plan, weighIns);
    recalibrationSuggestion = buildRecalibrationSuggestion(profile, plan, weighIns);
    const panel = $("#recalibration-panel");
    if (!panel) return;
    panel.hidden = false;
    panel.dataset.state = data.status;
    const title = $("#recalibration-title");
    const text = $("#recalibration-text");
    const facts = $("#recalibration-facts");
    const note = $("#recalibration-note");
    const progress = $("#recalibration-progress-fill");
    const button = $("#apply-recalibration");
    $("#recalibration-kicker").textContent = data.status === "ready" ? "REAJUSTE DISPONIBLE" : "GASTO ADAPTATIVO";
    if (!data.ready) {
      title.textContent = "M.A.S.A. está aprendiendo de tus registros.";
    } else if (!data.calendarDue) {
      title.textContent = `Próxima revisión: ${formatDate(data.nextReviewDate)}.`;
    } else if (!data.hasNewData) {
      title.textContent = "La fecha llegó; faltan registros nuevos.";
    } else if (data.meaningful) {
      title.textContent = `${profile.name ? `${profile.name}, hay` : "Hay"} un reajuste listo para revisar.`;
    } else {
      title.textContent = "Revisión completa: el objetivo sigue bien calibrado.";
    }
    text.textContent = automaticAdjustmentSummary(data);
    facts.innerHTML = `<div><span>Gasto estimado</span><b>${data.ready ? `${formatNumber(Math.round(data.adaptiveMaintenance))} kcal` : `${formatNumber(Math.round(plan.maintenance))} kcal iniciales`}</b></div><div><span>Confianza</span><b>${data.confidenceLabel}</b></div><div><span>Datos reunidos</span><b>${data.intakeDays || 0}/${EXPENDITURE_CONFIG.minIntakeDays} días · ${data.weighInCount || 0}/${EXPENDITURE_CONFIG.minWeighIns} pesajes</b></div><div><span>Estado</span><b>${data.ready ? data.reviewDue ? "Revisión lista" : data.calendarDue ? "Esperando datos nuevos" : `Espera hasta ${formatDate(data.nextReviewDate)}` : `${data.progress}% aprendido`}</b></div>`;
    progress.style.width = `${data.progress}%`;
    note.textContent = data.ready
      ? `La corrección mezcla el gasto anterior con el observado usando β = ${formatNumber(data.alpha, 2)}. Las revisiones se separan por ${EXPENDITURE_CONFIG.reviewIntervalDays} días y exigen al menos ${EXPENDITURE_CONFIG.minNewIntakeDays} días de ingesta y ${EXPENDITURE_CONFIG.minNewWeighIns} pesajes posteriores a la revisión anterior.`
      : "El cálculo necesita suficiente distancia entre fechas, días de ingesta y pesajes comparables; no reacciona a un peso aislado.";
    button.disabled = !recalibrationSuggestion;
    button.textContent = !data.ready
      ? `Aprendiendo · ${data.progress}%`
      : !data.calendarDue
        ? `Próxima revisión ${formatDate(data.nextReviewDate)}`
        : !data.hasNewData
          ? "Faltan registros nuevos"
        : data.meaningful
          ? "Aplicar reajuste"
          : "Registrar revisión";
  }
  function applyRecalibration() {
    if (!recalibrationSuggestion) return;
    const result = applyAutomaticAdjustment(recalibrationSuggestion, state.profile);
    if (!result) return;
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
    const observedWeekly = expenditureRatePerWeek(relatedWeighIns, 100);
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
      weekly: {
        eyebrow: "PROMEDIO SEMANAL",
        title: "Una lectura más estable de tus calorías.",
        description: "Cada barra muestra el promedio diario de una semana. La línea punteada es el objetivo diario.",
        legend: ["Promedio semanal", "Objetivo", "", ""],
        classes: ["legend-trend", "legend-plan", "", ""]
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
    } else if (activeProgressChart === "weekly") {
      hasData = drawWeeklyCalorieChart(canvas, chartPayload);
      renderWeeklyCalorieInsight(chartPayload);
    } else {
      hasData = drawWeightChart(canvas, chartPayload);
      renderWeightInsight(chartPayload.profile, chartPayload.plan, chartPayload.weighIns, chartPayload.trends, chartPayload.observedWeekly);
    }
    $("#progress-chart-empty").hidden = hasData;
  }

  function changeProgressChart(direction) {
    const order = ["weight", "calories", "weekly"];
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
    const horizontalTicks = width < 520 ? 3 : 5;
    for (let i = 0; i <= horizontalTicks; i += 1) {
      const timestamp = minDate + (maxDate - minDate) * i / horizontalTicks;
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
    const horizontalTicks = width < 520 ? 3 : 5;
    for (let i = 0; i <= horizontalTicks; i += 1) {
      const date = new Date(minDate + (maxDate - minDate) * i / horizontalTicks);
      ctx.fillStyle = "rgba(242,239,230,.48)";
      ctx.fillText(new Intl.DateTimeFormat("es-UY", { month: "short", day: chartRange === "1m" ? "2-digit" : undefined }).format(date), x(date), height - margin.bottom + 10);
    }
    return true;
  }

  function mondayOfWeek(date) {
    const result = new Date(date);
    const day = result.getDay();
    result.setHours(0, 0, 0, 0);
    result.setDate(result.getDate() - ((day + 6) % 7));
    return result;
  }

  function weeklyCalorieSamples(payload) {
    const days = calorieDaysForBounds(chartBounds(payload, false));
    const groups = new Map();
    days.forEach(day => {
      const weekDate = mondayOfWeek(day.date);
      const key = toISODate(weekDate);
      if (!groups.has(key)) groups.set(key, { date: weekDate, days: [] });
      groups.get(key).days.push(day);
    });
    return [...groups.values()].sort((a, b) => a.date - b.date).map(group => {
      const completed = group.days.filter(day => day.completed);
      const used = completed.length >= 3 ? completed : group.days;
      const average = used.reduce((sum, day) => sum + day.calories, 0) / Math.max(1, used.length);
      return {
        date: group.date,
        average,
        difference: Number.isFinite(payload.plan.targetCalories) ? average - payload.plan.targetCalories : null,
        loggedDays: group.days.length,
        usedDays: used.length,
        completedOnly: completed.length >= 3
      };
    });
  }

  function renderWeeklyCalorieInsight(payload) {
    $(".progress-model-data").hidden = true;
    const samples = weeklyCalorieSamples(payload);
    const latest = samples.at(-1);
    if (!latest || !Number.isFinite(payload.plan.targetCalories)) {
      setInsightFact(1, "Semanas", "0");
      setInsightFact(2, "Promedio", "—");
      setInsightFact(3, "Días usados", "—");
      $("#chart-insight-title").textContent = "Todavía falta una semana con registros.";
      $("#chart-insight").textContent = "Registrá comidas durante varios días. Esta vista agrupa los datos por semana para que un día aislado no domine la lectura.";
      $("#chart-insight-meta").textContent = "La barra semanal aparece desde el primer día registrado y mejora al completar más días.";
      return;
    }
    const diff = latest.difference;
    const aligned = Math.abs(diff) <= Math.max(75, payload.plan.targetCalories * 0.05);
    const weekLabel = new Intl.DateTimeFormat("es-UY", { day: "2-digit", month: "short" }).format(latest.date);
    setInsightFact(1, "Semana desde", weekLabel);
    setInsightFact(2, "Promedio", `${formatNumber(Math.round(latest.average))} kcal`);
    setInsightFact(3, "Días usados", String(latest.usedDays));
    $("#chart-insight-title").textContent = aligned
      ? "La última semana está cerca del objetivo."
      : `La última semana quedó ${formatNumber(Math.abs(Math.round(diff)))} kcal ${diff > 0 ? "por encima" : "por debajo"}.`;
    $("#chart-insight").textContent = aligned
      ? "El promedio semanal está dentro de un margen pequeño. Conviene mantener el registro antes de hacer cambios por uno o dos días puntuales."
      : `El promedio diario de esa semana fue ${formatNumber(Math.round(latest.average))} kcal. Mirá si el patrón se repite durante otra semana antes de modificar el objetivo.`;
    $("#chart-insight-meta").textContent = `${samples.length} semanas visibles · ${latest.completedOnly ? "usa días terminados" : "usa todos los días con ingestas"}`;
  }

  function drawWeeklyCalorieChart(canvas, payload) {
    const samples = weeklyCalorieSamples(payload);
    const prepared = prepareCanvas(canvas);
    if (!prepared) return samples.length > 0;
    const { ctx, width, height } = prepared;
    ctx.clearRect(0, 0, width, height);
    if (!samples.length || !Number.isFinite(payload.plan.targetCalories)) return false;
    const target = payload.plan.targetCalories;
    const maxValue = Math.max(target, ...samples.map(item => item.average), 500) * 1.12;
    const margin = { left: 54, right: 18, top: 22, bottom: 48 };
    const plotWidth = width - margin.left - margin.right;
    const step = plotWidth / Math.max(1, samples.length);
    const barWidth = Math.max(12, Math.min(48, step * .58));
    const y = value => margin.top + (maxValue - value) / maxValue * (height - margin.top - margin.bottom);

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

    samples.forEach((sample, index) => {
      const px = margin.left + step * (index + .5);
      const top = y(sample.average);
      const tolerance = Math.max(75, target * .05);
      ctx.fillStyle = Math.abs(sample.average - target) <= tolerance ? "#c8ff46" : sample.average > target ? "#ff6b52" : "#8d7cff";
      ctx.fillRect(px - barWidth / 2, top, barWidth, y(0) - top);
      const labelStep = width < 520 ? Math.max(2, Math.ceil(samples.length / 5)) : Math.max(1, Math.ceil(samples.length / 10));
      if ((width < 520 ? index % labelStep === 0 : samples.length <= 14 || index % labelStep === 0) || index === samples.length - 1) {
        ctx.fillStyle = "rgba(242,239,230,.5)";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(new Intl.DateTimeFormat("es-UY", { day: "2-digit", month: "short" }).format(sample.date), px, height - margin.bottom + 10);
      }
    });
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
    const select = $("#history-date-select");
    list.innerHTML = "";
    const rows = [...trends].reverse();
    $("#history-empty").hidden = rows.length > 0;
    $("#history-count").textContent = `${rows.length} ${rows.length === 1 ? "registro" : "registros"} · elegir por fecha`;
    select.hidden = rows.length === 0;
    select.innerHTML = "";
    if (!rows.length) {
      selectedHistoryId = null;
      return;
    }
    if (!selectedHistoryId || !rows.some(item => item.id === selectedHistoryId)) selectedHistoryId = rows[0].id;
    rows.forEach(item => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = `${formatDate(item.date)} · ${formatKg(item.weight)}`;
      select.appendChild(option);
    });
    select.value = selectedHistoryId;
    const item = rows.find(entry => entry.id === selectedHistoryId) || rows[0];
    const row = document.createElement("article");
    row.className = "history-row";
    row.dataset.id = item.id;
    row.innerHTML = `
      <label><span>Fecha</span><input class="date-input" data-field="date" type="text" inputmode="numeric" maxlength="10" value="${displayDate(item.date)}" aria-label="Fecha del pesaje"></label>
      <label><span>Peso</span><input data-field="weight" type="number" min="20" max="400" step="0.1" value="${item.weight}" aria-label="Peso en kg"></label>
      <div class="history-trend"><span>Tendencia</span><b>${formatKg(item.trend, 2)}</b></div>
      <button class="history-delete" type="button" data-delete-weight="${item.id}">Eliminar</button>`;
    list.appendChild(row);
  }

  function updateSettingsScrollState() {
    const sheet = document.querySelector(".settings-sheet");
    if (!sheet) return;
    sheet.classList.toggle("is-scrolled", sheet.scrollTop > 110);
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
    requestAnimationFrame(updateSettingsScrollState);
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
    if (selectedHistoryId === button.dataset.deleteWeight) selectedHistoryId = null;
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
    input.accept = mode === "library"
      ? ".json,application/json"
      : ".xlsx,.xls,.csv,.tsv,.txt,.json";
    input.click();
  }

  async function handleImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        if (importMode === "library") throw new Error("La biblioteca de recetas y alimentos se importa desde un archivo JSON exportado por MASA.");
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
        if (importMode === "library") {
          const result = importLibraryData(parsed);
          saveState(state);
          render();
          if (!$("#library-modal")?.hidden) renderLibraryManager();
          window.alert(`Biblioteca importada: ${result.foods} alimento(s), ${result.recipes} receta(s) y ${result.catalog} cambio(s) del catálogo.`);
          return;
        }
        const imported = normalizeState(parsed);
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

  function libraryExportPayload() {
    return {
      format: "masa-library",
      version: 19,
      exportedAt: new Date().toISOString(),
      foods: clone(state.foods || []),
      recipes: clone(state.recipes || []),
      catalogOverrides: clone(state.catalogOverrides || {})
    };
  }

  function exportLibrary() {
    const payload = libraryExportPayload();
    downloadText(`biblioteca-masa-${todayISO()}.json`, JSON.stringify(payload, null, 2), "application/json");
  }

  function importedLibraryCollections(raw = {}) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("El archivo no contiene una biblioteca válida de MASA.");
    }
    const foods = Array.isArray(raw.foods) ? raw.foods.map(normalizeFood).filter(Boolean) : [];
    const recipes = Array.isArray(raw.recipes)
      ? raw.recipes.map(item => normalizeFood({ ...item, kind: "recipe" })).filter(Boolean)
      : [];
    const catalogOverrides = {};
    Object.entries(raw.catalogOverrides || {}).forEach(([id, value]) => {
      const normalized = normalizeCatalogOverride(value, id);
      if (normalized) catalogOverrides[id] = normalized;
    });
    if (!foods.length && !recipes.length && !Object.keys(catalogOverrides).length) {
      throw new Error("El archivo no contiene alimentos, recetas ni cambios del catálogo para importar.");
    }
    return { foods, recipes, catalogOverrides };
  }

  function importLibraryData(raw) {
    const incoming = importedLibraryCollections(raw);
    const foods = [...state.foods];
    const foodIdMap = new Map();

    incoming.foods.forEach(food => {
      const nameKey = normalizeHeader(food.name);
      const indexById = foods.findIndex(item => item.id === food.id);
      const indexByName = foods.findIndex(item => normalizeHeader(item.name) === nameKey);
      const index = indexById >= 0 ? indexById : indexByName;
      if (index >= 0) {
        const preservedId = foods[index].id;
        foodIdMap.set(food.id, preservedId);
        foods[index] = normalizeFood({ ...food, id: preservedId, kind: "food" });
      } else {
        foodIdMap.set(food.id, food.id);
        foods.push(food);
      }
    });

    const remappedRecipes = incoming.recipes.map(recipe => normalizeFood({
      ...recipe,
      kind: "recipe",
      ingredients: (recipe.ingredients || []).map(ingredient => {
        if (ingredient.kind !== "food") return ingredient;
        const originalId = ingredient.foodId || ingredient.sourceId;
        const mappedId = foodIdMap.get(originalId) || originalId;
        return { ...ingredient, foodId: mappedId, sourceId: mappedId };
      })
    })).filter(Boolean);

    const recipes = [...state.recipes];
    remappedRecipes.forEach(recipe => {
      const nameKey = normalizeHeader(recipe.name);
      const indexById = recipes.findIndex(item => item.id === recipe.id);
      const indexByName = recipes.findIndex(item => normalizeHeader(item.name) === nameKey);
      const index = indexById >= 0 ? indexById : indexByName;
      if (index >= 0) {
        const preservedId = recipes[index].id;
        recipes[index] = normalizeFood({ ...recipe, id: preservedId, kind: "recipe" });
      } else recipes.push(recipe);
    });

    state.foods = foods;
    state.recipes = recipes.map(recalculateRecipe);
    state.catalogOverrides = { ...(state.catalogOverrides || {}), ...(incoming.catalogOverrides || {}) };
    rebuildExternalFoodCatalog();
    return { foods: incoming.foods.length, recipes: incoming.recipes.length, catalog: Object.keys(incoming.catalogOverrides || {}).length };
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

  async function resetAll() {
    state = emptyState();
    saveState(state);
    try {
      await window.MASA_CLOUD.flush();
    } catch (error) {
      window.alert(`Los datos se borraron en este dispositivo, pero no se pudo confirmar el borrado online: ${error.message}`);
    }
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

  function handleFoodEditorUnitChange() {
    const form = $("#food-editor-form");
    setEditableUnitFields(form.elements.servingUnit, form.elements.servingUnitCustom, form.elements.servingUnit.value);
  }

  function handleRecipeYieldUnitChange() {
    const form = $("#recipe-form");
    const select = form.elements.yieldUnit;
    const previousUnit = select.dataset.currentUnit || "serving";
    const previousDefault = defaultServingAmountForUnit(previousUnit);
    const currentAmount = toNumber(form.elements.servingAmount.value, previousDefault);
    setEditableUnitFields(select, form.elements.yieldUnitCustom, select.value);
    const nextDefault = defaultServingAmountForUnit(select.value);
    if (Math.abs(currentAmount - previousDefault) < 0.0001) form.elements.servingAmount.value = nextDefault;
    select.dataset.currentUnit = select.value;
    renderRecipeTotals();
  }

  function openTipsModal() {
    $("#tips-modal").hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeTipsModal() {
    try { localStorage.setItem(TIPS_SEEN_KEY, "1"); } catch (_) {}
    $("#tips-modal").hidden = true;
    updateModalBodyState();
    setTimeout(maybeOpenDailyCheckin, 120);
  }

  function maybeOpenTipsIntro() {
    let seen = false;
    try { seen = localStorage.getItem(TIPS_SEEN_KEY) === "1"; } catch (_) {}
    if (seen) return false;
    openTipsModal();
    return true;
  }

  function openAboutModal() {
    $("#about-modal").hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeAboutModal() {
    $("#about-modal").hidden = true;
    updateModalBodyState();
  }

  function bindEvents() {
    $("#open-about").addEventListener("click", openAboutModal);
    $("#accept-about").addEventListener("click", closeAboutModal);
    $$('[data-close-about]').forEach(element => element.addEventListener("click", closeAboutModal));
    $("#accept-tips").addEventListener("click", closeTipsModal);
    $$('[data-close-tips]').forEach(element => element.addEventListener("click", closeTipsModal));
    $("#begin-setup").addEventListener("click", () => openSettings(true, "profile"));
    $("#open-profile").addEventListener("click", () => openSettings(false, "profile"));
    $("#brand-home").addEventListener("click", () => switchAppView("today"));
    $$('[data-app-view]').forEach(button => button.addEventListener("click", () => switchAppView(button.dataset.appView)));
    $("#close-settings").addEventListener("click", closeSettings);
    $("#cancel-profile").addEventListener("click", closeSettings);
    $$('[data-close-settings]').forEach(element => element.addEventListener("click", closeSettings));
    $$('[data-settings-tab]').forEach(button => button.addEventListener("click", () => switchSettingsTab(button.dataset.settingsTab)));
    document.querySelector(".settings-sheet")?.addEventListener("scroll", updateSettingsScrollState, { passive: true });
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
    $("#history-date-select").addEventListener("change", event => {
      selectedHistoryId = event.currentTarget.value;
      render();
    });
    $("#collapse-history-manager").addEventListener("click", () => {
      const button = $("#toggle-history-manager");
      button.setAttribute("aria-expanded", "false");
      button.querySelector("i").textContent = "＋";
      $("#history-manager").hidden = true;
      button.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    $("#history-list").addEventListener("change", updateHistoryRow);
    $("#history-list").addEventListener("click", deleteHistoryRow);
    $("#import-library").addEventListener("click", () => openImport("library"));
    $("#export-library").addEventListener("click", exportLibrary);
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
      calorieRange = isMobileLayout() ? 7 : toNumber(button.dataset.calorieRange, 14);
      syncCalorieRangeButtons();
      drawCalorieChart(calculatePlan());
    }));
    $("#finish-day").addEventListener("click", finishDay);
    $("#hide-day-summary").addEventListener("click", hideDaySummary);
    $("#meal-grid").addEventListener("click", handleDiaryEntryClick);
    document.addEventListener("pointerdown", closeDiaryEditorFromOutside, true);
    $("#meal-grid").addEventListener("input", handleDiaryEntryEditInput);
    $("#meal-grid").addEventListener("change", handleDiaryEntryEditInput);
    $("#meal-grid").addEventListener("submit", submitDiaryEntryEdit);
    $("#close-food").addEventListener("click", closeFoodModal);
    $$("[data-close-food]").forEach(element => element.addEventListener("click", closeFoodModal));
    $$("[data-food-mode]").forEach(button => button.addEventListener("click", () => switchFoodMode(button.dataset.foodMode)));
    $("#food-search-input").addEventListener("input", queueFoodSearch);
    $("#scan-barcode-food").addEventListener("click", () => openBarcodeScanner("food"));
    $("#scan-barcode-recipe").addEventListener("click", () => openBarcodeScanner("recipe"));
    $("#scan-barcode-editor").addEventListener("click", () => openBarcodeScanner("food-editor"));
    $("#rescan-food-editor").addEventListener("click", () => openBarcodeScanner("food-editor"));
    $("#close-barcode").addEventListener("click", () => closeBarcodeScanner(true));
    $$('[data-close-barcode]').forEach(element => element.addEventListener("click", () => closeBarcodeScanner(true)));
    $("#barcode-manual-form").addEventListener("submit", submitManualBarcode);
    $("#barcode-torch").addEventListener("click", toggleBarcodeTorch);
    [$("#food-results"), $("#recent-food-results"), $("#frequent-food-results"), $("#recipe-results")].forEach(container => {
      container.addEventListener("click", handleFoodResultClick);
      container.addEventListener("submit", handleFoodResultSubmit);
      container.addEventListener("input", handleFoodResultInput);
      container.addEventListener("change", handleFoodResultChange);
    });
    $("#quick-calorie-form").addEventListener("submit", addQuickCalories);
    $("#new-custom-food").addEventListener("click", () => openFoodEditor({ returnTarget: "food" }));
    $("#sidebar-new-food").addEventListener("click", () => openFoodEditor({ returnTarget: "main" }));
    $("#sidebar-open-library").addEventListener("click", () => openLibraryManager("main"));
    $("#new-recipe").addEventListener("click", () => openRecipeEditor({ returnTarget: "food" }));
    $("#new-recipe-secondary").addEventListener("click", () => openRecipeEditor({ returnTarget: "food" }));
    $$('[data-open-library]').forEach(button => button.addEventListener("click", () => openLibraryManager("food")));
    $("#close-library").addEventListener("click", closeLibraryManager);
    $$('[data-close-library]').forEach(element => element.addEventListener("click", closeLibraryManager));
    $("#library-food-list").addEventListener("click", handleLibraryClick);
    $("#library-recipe-list").addEventListener("click", handleLibraryClick);
    $("#library-catalog-list").addEventListener("click", handleLibraryClick);
    $("#library-catalog-search-results").addEventListener("click", handleLibraryClick);
    $("#library-search-catalog").addEventListener("click", toggleLibraryCatalogSearch);
    $("#library-catalog-search-input").addEventListener("input", queueLibraryCatalogSearch);
    $("#library-new-food").addEventListener("click", () => openFoodEditor({ returnTarget: "library" }));
    $("#library-new-recipe").addEventListener("click", () => openRecipeEditor({ returnTarget: "library" }));
    $("#library-import").addEventListener("click", () => openImport("library"));
    $("#library-export").addEventListener("click", exportLibrary);
    $("#close-food-editor").addEventListener("click", closeFoodEditor);
    $$('[data-close-food-editor]').forEach(element => element.addEventListener("click", closeFoodEditor));
    $("#food-editor-form").addEventListener("submit", saveCustomFood);
    $("#food-editor-form").elements.servingUnit.addEventListener("change", handleFoodEditorUnitChange);
    $("#close-recipe").addEventListener("click", closeRecipeEditor);
    $$('[data-close-recipe]').forEach(element => element.addEventListener("click", closeRecipeEditor));
    $("#recipe-form").addEventListener("submit", saveRecipe);
    $("#recipe-form").elements.yield.addEventListener("input", renderRecipeTotals);
    $("#recipe-form").elements.servingAmount.addEventListener("input", renderRecipeTotals);
    $("#recipe-form").elements.yieldUnit.addEventListener("change", handleRecipeYieldUnitChange);
    $("#recipe-form").elements.yieldUnitCustom.addEventListener("input", renderRecipeTotals);
    $("#recipe-ingredient-search").addEventListener("input", queueRecipeIngredientSearch);
    $("#recipe-ingredient-results").addEventListener("click", handleRecipeIngredientSearchClick);
    $("#recipe-ingredient-results").addEventListener("input", handleRecipeIngredientSearchInput);
    $("#recipe-ingredient-results").addEventListener("change", handleRecipeIngredientSearchChange);
    $("#recipe-ingredient-list").addEventListener("click", handleRecipeIngredientListClick);
    $("#recipe-ingredient-list").addEventListener("input", handleRecipeIngredientListInput);
    $("#recipe-ingredient-list").addEventListener("change", handleRecipeIngredientListChange);
    $("#create-missing-ingredient").addEventListener("click", () => openFoodEditor({
      returnTarget: "recipe",
      prefillName: $("#recipe-ingredient-search").value.trim()
    }));
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
      syncCalorieRangeButtons();
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

  async function registerServiceWorker() {
    if (!navigator.serviceWorker?.register || location.protocol === "file:") return;

    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(registration => {
        const scopePath = new URL(registration.scope).pathname;
        const scriptPath = registration.active
          ? new URL(registration.active.scriptURL).pathname
          : "";
        const isOldRootRegistration = scopePath === "/" && scriptPath.endsWith("/service-worker.js");
        return isOldRootRegistration ? registration.unregister() : Promise.resolve(false);
      }));

      if (location.protocol === "capacitor:" || location.hostname === "localhost") return;
      const basePath = new URL(document.baseURI).pathname;
      const serviceWorkerUrl = new URL("service-worker.js", document.baseURI).href;
      await navigator.serviceWorker.register(serviceWorkerUrl, { scope: basePath });
    } catch (_) {}
  }

  function renderInitialApplication(initialState) {
    state = normalizeState(initialState || emptyState());
    window.MASA_CLOUD.cacheState(state);
    bindEvents();
    $$(".help-dot[data-tooltip]").forEach(button => { button.title = button.dataset.tooltip; });
    bindHelpTooltips();
    render();
    switchAppView("today", false);
    switchDiaryView("record");
    window.MASA_CLOUD.finishBoot();
    externalFoodsLoadPromise = loadExternalFoods();
    registerServiceWorker();
  }

  async function refreshCloudStateAfterBoot() {
    const revisionAtStart = stateRevision;
    try {
      const cloudResult = await window.MASA_CLOUD.loadUserState();
      if (stateRevision !== revisionAtStart || window.MASA_CLOUD.hasPendingChanges()) {
        console.info("[MASA][sync] Se conservó el estado local porque hubo cambios mientras se cargaban los datos remotos.");
        return;
      }

      let refreshedState = normalizeState(cloudResult.state || emptyState());
      if (!cloudResult.hasData) {
        const legacyState = loadLegacyState();
        if (hasMeaningfulState(legacyState)) {
          const importLocal = window.confirm(
            "Encontramos datos de la versión local de MASA en este dispositivo. ¿Querés importarlos a esta cuenta?"
          );
          if (importLocal) {
            refreshedState = legacyState;
            state = normalizeState(refreshedState);
            window.MASA_CLOUD.cacheState(state);
            render();
            window.MASA_CLOUD.setSyncStatus("saving", "Importando datos locales…");
            try {
              await window.MASA_CLOUD.replaceState(state);
              clearLegacyState();
            } catch (error) {
              console.error("[MASA][sync] No se pudieron importar los datos locales:", error);
              window.MASA_CLOUD.setSyncStatus("error", "Importación pendiente");
            }
            return;
          }
        }
      }

      state = normalizeState(refreshedState);
      window.MASA_CLOUD.cacheState(state);
      render();
    } catch (error) {
      console.error("[MASA][sync] La aplicación quedó disponible, pero falló la carga remota:", error);
      window.MASA_CLOUD.setSyncStatus("error", "Error de sincronización");
    }
  }

  async function init() {
    try {
      await window.MASA_CLOUD.requireSession();
      const cachedState = window.MASA_CLOUD.readCachedState();
      renderInitialApplication(cachedState || emptyState());

      refreshCloudStateAfterBoot().finally(() => {
        const introOpened = maybeOpenTipsIntro();
        if (!introOpened) setTimeout(maybeOpenDailyCheckin, 180);
      });
    } catch (error) {
      console.error("[MASA][startup] No se pudo iniciar MASA:", error);
      window.MASA_CLOUD?.showFatalError(error);
    }
  }

  init();
})();
