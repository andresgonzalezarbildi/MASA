#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const files = {
  app: await readFile(resolve(root, "js/app.js"), "utf8"),
  cloud: await readFile(resolve(root, "js/cloud.js"), "utf8"),
  index: await readFile(resolve(root, "index.html"), "utf8"),
  netlify: await readFile(resolve(root, "netlify.toml"), "utf8"),
  sql: await readFile(resolve(root, "supabase/03_security_hardening.sql"), "utf8")
};

const checks = [
  [files.app.includes("MASA_SECURITY_INPUT_GUARDS_V1"), "controles de entrada"],
  [files.app.includes("isCalorieOnlyEntry"), "edición de solo calorías"],
  [files.cloud.includes("MASA_SECURITY_CLOUD_GUARDS_V1"), "controles de sincronización"],
  [files.cloud.includes("checkedTable(table)"), "lista permitida de tablas"],
  [!files.cloud.includes("getClient().from(table)"), "uso directo de tabla dinámica"],
  [files.index.includes('maxlength="128"') && files.index.includes('minlength="10"'), "límites de contraseña"],
  [files.netlify.includes("frame-ancestors 'none'"), "protección contra framing"],
  [files.sql.includes("enable row level security"), "RLS"],
  [files.sql.includes("revoke all on table"), "privilegios mínimos"]
];

const failed = checks.filter(([ok]) => !ok).map(([, label]) => label);
if (failed.length) {
  console.error(`Faltan controles: ${failed.join(", ")}`);
  process.exit(1);
}
console.log("OK: controles de seguridad presentes.");
