import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transformMobileHtml, transformMobileLegalHtml } from "./mobile-html.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(root, "index.html"), "utf8");
const output = transformMobileHtml(source, "30.0");

assert.match(output, /<base href="\.\/"\/>/);
assert.match(output, /\.\/vendor\/masa-vendor\.js\?v=30\.0/);
assert.doesNotMatch(output, /cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/i);
assert.doesNotMatch(output, /cdn\.jsdelivr\.net\/npm\/@zxing\/browser/i);
assert.ok(output.indexOf("./vendor/masa-vendor.js") < output.indexOf("./js/config.js"));
assert.match(output, /\.\/js\/sync-merge\.js\?v=31\.1\.0/);
assert.ok(output.indexOf("./js/sync-merge.js") < output.indexOf("./js/cloud.js"));
assert.doesNotMatch(output, /href=["']\/masa\/(?:privacy|terms)\.html["']/i);
assert.doesNotMatch(output, /href=["'](?:\.\/)?(?:privacy|terms)\.html["'][^>]*target=["']_blank["']/i);

const legalOutput = transformMobileLegalHtml('<base href="/masa/"/><a href="/masa/">Volver</a><a href="/masa/terms.html">Términos</a>');
assert.match(legalOutput, /<base href="\.\/"\/>/);
assert.match(legalOutput, /href="\.\/index\.html"/);
assert.match(legalOutput, /href="\.\/terms\.html"/);
console.log("Mobile HTML transform tests: OK");
