import { access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const androidDir = join(root, "android");
try { await access(androidDir); } catch {
  const init = spawnSync("npm", ["run", "android:init"], { cwd: root, stdio: "inherit", shell: true });
  if (init.status) process.exit(init.status);
}
const sync = spawnSync("npm", ["run", "android:sync"], { cwd: root, stdio: "inherit", shell: true });
if (sync.status) process.exit(sync.status);
const wrapper = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const build = spawnSync(wrapper, ["assembleDebug"], { cwd: androidDir, stdio: "inherit", shell: true });
process.exit(build.status ?? 1);
