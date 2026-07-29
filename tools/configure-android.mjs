import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ID, VERSION_CODE, VERSION_NAME } from "./version.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const androidRoot = join(root, "android");
const appId = APP_ID;
const versionCode = VERSION_CODE;
const versionName = VERSION_NAME;

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

if (!(await exists(androidRoot))) {
  console.warn("Todavía no existe android/. Ejecutá npm run android:init");
  process.exit(0);
}

const variables = join(androidRoot, "variables.gradle");
if (await exists(variables)) {
  let source = await readFile(variables, "utf8");
  source = source.replace(/minSdkVersion\s*=\s*\d+/, "minSdkVersion = 26");
  await writeFile(variables, source);
}

const appGradle = join(androidRoot, "app", "build.gradle");
if (await exists(appGradle)) {
  let source = await readFile(appGradle, "utf8");
  if (!source.includes("MASA_RELEASE_SIGNING")) {
    source = `// MASA_RELEASE_SIGNING\ndef masaKeystoreProperties = new Properties()\ndef masaKeystorePropertiesFile = rootProject.file('../keystore.properties')\nif (!masaKeystorePropertiesFile.exists()) {\n    throw new GradleException('Falta keystore.properties para firmar la versión release de M.A.S.A.')\n}\nmasaKeystoreProperties.load(new FileInputStream(masaKeystorePropertiesFile))\n\n${source}`;
  }
  source = source
    .replace(/namespace\s*=\s*["'][^"']+["']/, `namespace = "${appId}"`)
    .replace(/applicationId\s+["'][^"']+["']/, `applicationId "${appId}"`)
    .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
    .replace(/versionName\s+["'][^"']+["']/, `versionName "${versionName}"`);

  if (!source.includes("signingConfigs {\n        release")) {
    source = source.replace(/android\s*\{/, `android {\n    signingConfigs {\n        release {\n            keyAlias masaKeystoreProperties['keyAlias']\n            keyPassword masaKeystoreProperties['keyPassword']\n            storeFile rootProject.file(masaKeystoreProperties['storeFile'])\n            storePassword masaKeystoreProperties['storePassword']\n        }\n    }`);
  }

  const buildTypesMatch = /buildTypes\s*\{/.exec(source);
  if (buildTypesMatch) {
    const releaseMatch = /release\s*\{/.exec(source.slice(buildTypesMatch.index));
    if (releaseMatch) {
      const releaseStart = buildTypesMatch.index + releaseMatch.index;
      const openBrace = source.indexOf("{", releaseStart);
      let depth = 0;
      let closeBrace = -1;
      for (let index = openBrace; index < source.length; index += 1) {
        if (source[index] === "{") depth += 1;
        else if (source[index] === "}") {
          depth -= 1;
          if (depth === 0) { closeBrace = index; break; }
        }
      }
      if (closeBrace > openBrace) {
        let body = source.slice(openBrace + 1, closeBrace)
          .replace(/minifyEnabled\s+false/, "minifyEnabled true")
          .replace(/shrinkResources\s+false/, "shrinkResources true");
        if (!/minifyEnabled\s+true/.test(body)) body += "\n            minifyEnabled true";
        if (!/shrinkResources\s+true/.test(body)) body += "\n            shrinkResources true";
        if (!/signingConfig\s+signingConfigs\.release/.test(body)) body += "\n            signingConfig signingConfigs.release";
        source = source.slice(0, openBrace + 1) + body + "\n        " + source.slice(closeBrace);
      }
    }
  }
  await writeFile(appGradle, source);
}

const mainActivityDir = join(androidRoot, "app", "src", "main", "java", ...appId.split("."));
const mainActivity = join(mainActivityDir, "MainActivity.java");
await mkdir(mainActivityDir, { recursive: true });
await writeFile(mainActivity, `package ${appId};\n\nimport android.os.Bundle;\nimport android.view.WindowInsets;\nimport android.view.WindowInsetsController;\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {\n    @Override\n    protected void onCreate(Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n        hideStatusBar();\n    }\n\n    @Override\n    public void onWindowFocusChanged(boolean hasFocus) {\n        super.onWindowFocusChanged(hasFocus);\n        if (hasFocus) hideStatusBar();\n    }\n\n    private void hideStatusBar() {\n        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {\n            WindowInsetsController controller = getWindow().getInsetsController();\n            if (controller != null) controller.hide(WindowInsets.Type.statusBars());\n        } else {\n            getWindow().setFlags(\n                android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN,\n                android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN\n            );\n        }\n    }\n}\n`);

const styles = join(androidRoot, "app", "src", "main", "res", "values", "styles.xml");
if (await exists(styles)) {
  let source = await readFile(styles, "utf8");
  source = source.replace(/(<style name="AppTheme(?:\.NoActionBar)?"[^>]*>)([\s\S]*?)(<\/style>)/g, (match, opening, body, closing) => {
    if (body.includes('name="android:windowFullscreen"')) return match;
    return `${opening}\n        <item name="android:windowFullscreen">true</item>\n        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>${body}${closing}`;
  });
  await writeFile(styles, source);
}

console.log(`Android release configurado: ${appId}, versionCode ${versionCode}, versionName ${versionName}`);
