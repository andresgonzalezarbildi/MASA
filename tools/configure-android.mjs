import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
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
  // MASA_GSON_R8_DEPENDENCY: mantener idempotente para cada cap sync.
  const gsonDependency = 'implementation "com.google.code.gson:gson:2.11.0"';
  const gsonPattern = /implementation\s+["']com\.google\.code\.gson:gson:[^"']+["']/;
  if (gsonPattern.test(source)) {
    source = source.replace(gsonPattern, gsonDependency);
  } else {
    const dependenciesMatch = /dependencies\s*\{/.exec(source);
    if (!dependenciesMatch) {
      throw new Error("No se encontró el bloque dependencies en android/app/build.gradle");
    }
    const dependencyBrace = source.indexOf("{", dependenciesMatch.index);
    source = source.slice(0, dependencyBrace + 1)
      + `\n    ${gsonDependency}`
      + source.slice(dependencyBrace + 1);
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
          .replace(/shrinkResources\s+false/, "shrinkResources true")
          .replace(/\s+$/, "");
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
await writeFile(mainActivity, `package uy.com.andresgonzalez.masa;

import android.content.Intent;
import android.os.Bundle;
import android.view.Window;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private int lastTopCss = 0;
    private int lastBottomCss = 0;
    private String initialAuthUrl = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        registerPlugin(MasaAuthPlugin.class);
        super.onCreate(savedInstanceState);
        initialAuthUrl = getIntent() != null && getIntent().getDataString() != null
            ? getIntent().getDataString()
            : "";
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        hideStatusBar();
        configureWebInsets();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                dispatchBackToWeb();
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String url = intent != null ? intent.getDataString() : null;
        if (url != null && !url.isEmpty()) dispatchAuthUrlToWeb(url);
    }

    private void dispatchAuthUrlToWeb(String url) {
        if (bridge == null || bridge.getWebView() == null || url == null) return;
        String script = "window.dispatchEvent(new CustomEvent('masa:native-auth-url',{detail:{url:" + JSONObject.quote(url) + "}}));";
        Runnable send = () -> bridge.getWebView().evaluateJavascript(script, null);
        bridge.getWebView().post(send);
        bridge.getWebView().postDelayed(send, 350);
    }

    public synchronized String consumeInitialAuthUrl() {
        String value = initialAuthUrl;
        initialAuthUrl = "";
        return value;
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideStatusBar();
            applyWebInsetsToDocument();
        }
    }

    private void hideStatusBar() {
        Window window = getWindow();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.hide(WindowInsetsCompat.Type.statusBars());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    private void configureWebInsets() {
        if (bridge == null || bridge.getWebView() == null) return;
        ViewCompat.setOnApplyWindowInsetsListener(bridge.getWebView(), (view, windowInsets) -> {
            Insets topInsets = windowInsets.getInsets(
                WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.displayCutout()
            );
            Insets bottomInsets = windowInsets.getInsets(WindowInsetsCompat.Type.navigationBars());
            float density = getResources().getDisplayMetrics().density;
            lastTopCss = Math.round(topInsets.top / density);
            lastBottomCss = Math.round(bottomInsets.bottom / density);
            applyWebInsetsToDocument();
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(bridge.getWebView());
    }

    private void applyWebInsetsToDocument() {
        if (bridge == null || bridge.getWebView() == null) return;
        String script = "document.documentElement.style.setProperty('--android-safe-top','" + lastTopCss
            + "px');document.documentElement.style.setProperty('--android-safe-bottom','" + lastBottomCss + "px');";
        Runnable applyInsets = () -> bridge.getWebView().evaluateJavascript(script, null);
        bridge.getWebView().post(applyInsets);
        bridge.getWebView().postDelayed(applyInsets, 250);
        bridge.getWebView().postDelayed(applyInsets, 1000);
    }

    private void dispatchBackToWeb() {
        if (bridge == null || bridge.getWebView() == null) {
            finish();
            return;
        }
        String script = "(function(){try{return !!(window.MASAHandleAndroidBack&&window.MASAHandleAndroidBack());}catch(e){return false;}})();";
        bridge.getWebView().evaluateJavascript(script, handled -> {
            if ("true".equals(handled)) return;
            if (bridge.getWebView().canGoBack()) {
                bridge.getWebView().goBack();
                return;
            }
            finish();
        });
    }
}
`);


const authPlugin = join(mainActivityDir, "MasaAuthPlugin.java");
await writeFile(authPlugin, `package uy.com.andresgonzalez.masa;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MasaAuth")
public class MasaAuthPlugin extends Plugin {
    @PluginMethod
    public void openAuthUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("No se recibió la URL de autenticación.");
            return;
        }
        try {
            Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            getActivity().startActivity(browserIntent);
            call.resolve();
        } catch (Exception error) {
            call.reject("No se pudo abrir el navegador.", null, error);
        }
    }

    @PluginMethod
    public void getInitialAuthUrl(PluginCall call) {
        JSObject result = new JSObject();
        String url = "";
        if (getActivity() instanceof MainActivity) {
            url = ((MainActivity) getActivity()).consumeInitialAuthUrl();
        }
        result.put("url", url);
        call.resolve(result);
    }
}
`);

const manifest = join(androidRoot, "app", "src", "main", "AndroidManifest.xml");
if (await exists(manifest)) {
  let source = await readFile(manifest, "utf8");
  if (!source.includes('android:scheme="masa"')) {
    const launcherEnd = `            </intent-filter>`;
    const deepLinkFilter = `${launcherEnd}
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="masa" android:host="auth" android:path="/callback" />
            </intent-filter>`;
    if (!source.includes(launcherEnd)) throw new Error("No se encontró el intent-filter principal de Android.");
    source = source.replace(launcherEnd, deepLinkFilter);
  }
  await writeFile(manifest, source);
}

const resRoot = join(androidRoot, "app", "src", "main", "res");
const styles = join(resRoot, "values", "styles.xml");
if (await exists(styles)) {
  let source = await readFile(styles, "utf8");
  source = source.replace(/(<style name="AppTheme(?:\.NoActionBar)?"[^>]*>)([\s\S]*?)(<\/style>)/g, (match, opening, body, closing) => {
    if (body.includes('name="android:windowFullscreen"')) return match;
    return `${opening}\n        <item name="android:windowFullscreen">true</item>\n        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>${body}${closing}`;
  });

  const launchTheme = `    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="windowSplashScreenBackground">@color/masa_splash_background</item>
        <item name="windowSplashScreenAnimatedIcon">@drawable/masa_splash_icon</item>
        <item name="windowSplashScreenAnimationDuration">120</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>`;
  const launchPattern = /\s*<style name="AppTheme\.NoActionBarLaunch"[\s\S]*?<\/style>/;
  source = launchPattern.test(source)
    ? source.replace(launchPattern, `\n\n${launchTheme}`)
    : source.replace(/\s*<\/resources>/, `\n\n${launchTheme}\n</resources>`);
  await writeFile(styles, source);
}

const splashDrawableDir = join(resRoot, "drawable-nodpi");
await mkdir(splashDrawableDir, { recursive: true });
await copyFile(join(root, "resources", "splash-icon.png"), join(splashDrawableDir, "masa_splash_icon.png"));

const lightColorsDir = join(resRoot, "values");
const darkColorsDir = join(resRoot, "values-night");
await mkdir(lightColorsDir, { recursive: true });
await mkdir(darkColorsDir, { recursive: true });
await writeFile(join(lightColorsDir, "masa_splash_colors.xml"), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="masa_splash_background">#F2EFE7</color>
</resources>
`);
await writeFile(join(darkColorsDir, "masa_splash_colors.xml"), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="masa_splash_background">#15181D</color>
</resources>
`);

console.log(`Android release configurado: ${appId}, versionCode ${versionCode}, versionName ${versionName}`);
