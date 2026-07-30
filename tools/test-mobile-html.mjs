import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transformMobileHtml } from "./mobile-html.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(root, "index.html"), "utf8");
const output = transformMobileHtml(source, "30.0");

assert.match(output, /<base href="\.\/"\/>/);
assert.match(output, /\.\/vendor\/masa-vendor\.js\?v=30\.0/);
assert.doesNotMatch(output, /cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/i);
assert.doesNotMatch(output, /cdn\.jsdelivr\.net\/npm\/@zxing\/browser/i);
assert.ok(output.indexOf("./vendor/masa-vendor.js") < output.indexOf("./js/config.js"));
console.log("Mobile HTML transform tests: OK");
