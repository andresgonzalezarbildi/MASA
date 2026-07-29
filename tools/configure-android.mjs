import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const variables = join(root, "android", "variables.gradle");
try {
  await access(variables);
  let source = await readFile(variables, "utf8");
  source = source.replace(/minSdkVersion\s*=\s*\d+/, "minSdkVersion = 26");
  await writeFile(variables, source);
  console.log("Android configurado: minSdkVersion 26");
} catch {
  console.warn("Todavía no existe android/. Ejecutá npm run android:init");
}
