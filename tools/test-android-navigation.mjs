import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const app = await readFile(join(root, "js/app.js"), "utf8");
const activity = await readFile(join(root, "android/app/src/main/java/uy/com/andresgonzalez/masa/MainActivity.java"), "utf8");
const index = await readFile(join(root, "index.html"), "utf8");
const styles = await readFile(join(root, "css/styles.css"), "utf8");
const legalPage = await readFile(join(root, "js/legal-page.js"), "utf8");

assert.match(app, /function keyboardIsProbablyOpen\(\)/);
assert.match(app, /function closeUnknownVisibleDialog\(\)/);
assert.match(app, /window\.MASAHandleAndroidBack = handleAndroidBack/);
assert.match(app, /data-edit-diary-source/);
assert.match(app, /Editar \$\{editableSource\.kind === "recipe" \? "receta" : "alimento"\} y unidades/);
assert.match(app, /openFoodEditor\(\{[\s\S]*returnTarget: "diary"/);
assert.match(app, /if \(target === "diary"\) renderDiary\(calculatePlan\(\)\)/);
assert.match(activity, /window\.MASAHandleAndroidBack/);
assert.match(activity, /querySelectorAll\('\[role=\\"dialog\\"\]'\)/);

assert.match(index, /id="legal-modal"/);
assert.match(index, /data-legal-document="privacy"/);
assert.match(index, /maximum-scale=1, user-scalable=no/);
assert.match(app, /if \(modalIsOpen\("legal-modal"\)\) \{ closeLegalDocument\(\); return true; \}/);
assert.match(app, /function bindLegalNavigation\(\)/);
assert.match(activity, /data-close-legal/);
assert.match(legalPage, /window\.location\.replace/);
assert.match(legalPage, /window\.MASAHandleAndroidBack/);
assert.match(styles, /html\.native-runtime \.site-header[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);

console.log("Android navigation, legal documents and diary source editing tests: OK");
