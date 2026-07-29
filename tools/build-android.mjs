import { access, copyFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION_NAME } from "./version.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const androidDir = join(root, "android");
const signingFiles = [join(root, "keystore.properties"), join(root, "signing", "masa-release.jks")];
for (const file of signingFiles) {
  try { await access(file); } catch {
    console.error(`Falta ${file}. Restaurá la copia definitiva de la clave antes de compilar.`);
    process.exit(1);
  }
}
try { await access(androidDir); } catch {
  const init = spawnSync("npm", ["run", "android:init"], { cwd: root, stdio: "inherit", shell: true });
  if (init.status) process.exit(init.status);
}
const sync = spawnSync("npm", ["run", "android:sync"], { cwd: root, stdio: "inherit", shell: true });
if (sync.status) process.exit(sync.status);
const wrapper = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const build = spawnSync(wrapper, ["clean", "assembleRelease"], { cwd: androidDir, stdio: "inherit", shell: true });
if (build.status) process.exit(build.status);
const sourceApk = join(androidDir, "app", "build", "outputs", "apk", "release", "app-release.apk");
const dist = join(root, "dist");
await mkdir(dist, { recursive: true });
const outputApk = join(dist, `MASA-v${VERSION_NAME}-release.apk`);
await copyFile(sourceApk, outputApk);
console.log(`APK release firmado: ${outputApk}`);
