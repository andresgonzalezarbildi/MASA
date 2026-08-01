import { readFile } from "node:fs/promises";
import vm from "node:vm";

const appSource = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const start = appSource.indexOf("  function normalizeNutritionLabelText(value) {");
const end = appSource.indexOf("  function nutritionLabelNote(parsed) {", start);
if (start < 0 || end < 0) throw new Error("No se encontró el parser de rótulos en js/app.js.");

const parserSource = appSource.slice(start, end).replace(/^  /gm, "");
const sandbox = {
  normalizeHeader(value) {
    return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  }
};
vm.createContext(sandbox);
vm.runInContext(`${parserSource}\nthis.parseNutritionLabel = parseNutritionLabel;`, sandbox);

function line(text, left, top, right = left + Math.max(50, text.length * 9), bottom = top + 24) {
  return { text, left, top, right, bottom };
}

const fixtures = [
  {
    name: "tabla uruguaya en columnas",
    result: {
      text: "INFORMACIÓN NUTRICIONAL\nPorción 30 g\nValor energético 122 kcal 6%\nProteínas 3,2 g 6%\nGrasas totales 4,8 g 9%\nCarbohidratos 18,5 g 6%",
      lines: [
        line("INFORMACIÓN NUTRICIONAL", 20, 10),
        line("Porción", 20, 45), line("30 g", 260, 45),
        line("Valor energético", 20, 85), line("122 kcal", 260, 85), line("6%", 430, 85),
        line("Proteínas", 20, 125), line("3,2 g", 260, 125), line("6%", 430, 125),
        line("Grasas totales", 20, 165), line("4,8 g", 260, 165), line("9%", 430, 165),
        line("Carbohidratos", 20, 205), line("18,5 g", 260, 205), line("6%", 430, 205)
      ]
    },
    expected: { servingAmount: 30, servingUnit: "g", calories: 122, protein: 3.2, fat: 4.8, carbs: 18.5 }
  },
  {
    name: "energía separada en kJ y kcal",
    result: {
      text: "Porción: 200 ml\nValor energético\n410 kJ / 98 kcal\nProteína 6,1 g\nGrasa total 2,5 g\nHidratos de carbono 12,0 g",
      lines: []
    },
    expected: { servingAmount: 200, servingUnit: "ml", calories: 98, protein: 6.1, fat: 2.5, carbs: 12 }
  },
  {
    name: "OCR con proteína deformada y valores sin unidad",
    result: {
      text: "PORCION 40 g\nEnergia 150 kcal\nProte1nas 5,5 11%\nGrasas totales 7,0 13%\nCarbohidratos 16,0 5%",
      lines: []
    },
    expected: { servingAmount: 40, servingUnit: "g", calories: 150, protein: 5.5, fat: 7, carbs: 16 }
  }
];

let failed = 0;
for (const fixture of fixtures) {
  const actual = sandbox.parseNutritionLabel(fixture.result);
  const errors = [];
  for (const [key, expected] of Object.entries(fixture.expected)) {
    const value = actual[key];
    if (typeof expected === "number") {
      if (!Number.isFinite(value) || Math.abs(value - expected) > 0.02) errors.push(`${key}: esperado ${expected}, obtenido ${value}`);
    } else if (value !== expected) errors.push(`${key}: esperado ${expected}, obtenido ${value}`);
  }
  if (errors.length) {
    failed += 1;
    console.error(`FAIL ${fixture.name}: ${errors.join("; ")}`);
  } else {
    console.log(`OK   ${fixture.name}`);
  }
}

if (failed) process.exitCode = 1;
else console.log(`Parser de rótulos: ${fixtures.length}/${fixtures.length} pruebas correctas.`);
