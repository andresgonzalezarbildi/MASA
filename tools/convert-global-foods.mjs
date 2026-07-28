import fs from "node:fs";
import path from "node:path";

const inputPath = process.argv[2] || "data/opennutrition-es-general.json";
const outputPath = process.argv[3] || "global-foods.csv";
const foods = JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"));

if (!Array.isArray(foods)) throw new Error("El catálogo debe ser un array JSON.");

const headers = [
  "external_id", "source", "name", "brand", "serving_text",
  "serving_amount", "serving_unit", "serving_unit_custom",
  "calories", "protein", "fat", "carbs", "is_active", "metadata"
];

const rows = foods.map((food, index) => {
  const per100g = food.per100g || {};
  const metricAmount = positive(food.serving?.metric?.quantity, 100);
  const factor = metricAmount / 100;
  return {
    external_id: food.id || food.sourceFoodId || `global-${index + 1}`,
    source: "opennutrition",
    name: food.name || "Alimento sin nombre",
    brand: food.brand || food.sourceName || "",
    serving_text: `${metricAmount} g`,
    serving_amount: metricAmount,
    serving_unit: "g",
    serving_unit_custom: "",
    calories: nonNegative(per100g.calories) * factor,
    protein: nonNegative(per100g.protein) * factor,
    fat: nonNegative(per100g.fat) * factor,
    carbs: nonNegative(per100g.carbs) * factor,
    is_active: true,
    metadata: JSON.stringify(food)
  };
});

const csv = [
  headers.join(","),
  ...rows.map(row => headers.map(header => escapeCsv(row[header])).join(","))
].join("\n");

fs.writeFileSync(path.resolve(outputPath), csv, "utf8");
console.log(`Generados ${rows.length} alimentos en ${outputPath}`);

function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
