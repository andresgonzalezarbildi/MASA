import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [html, app, css] = await Promise.all([
  readFile(join(root, "index.html"), "utf8"),
  readFile(join(root, "js", "app.js"), "utf8"),
  readFile(join(root, "css", "styles.css"), "utf8")
]);

assert.match(html, /<span>Calorías pendientes<\/span>/);
assert.match(html, /id="diary-calories">—<\/strong>/);
assert.match(app, /diaryTotal\.textContent = hasCalorieTarget \? formatNumber\(Math\.round\(remaining\)\) : "—"/);
assert.match(app, /kcal consumidas/);
assert.match(app, /classList\.toggle\("is-over", hasCalorieTarget && remaining < 0\)/);
assert.match(css, /\.diary-total\.is-over strong \{ color: var\(--coral\); \}/);

console.log("Diary pending-calories summary tests: OK");
