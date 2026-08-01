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

  // MASA_NUTRITION_LABEL_OCR: modelo latino incluido en el APK para uso inmediato y offline.
  const ocrDependency = 'implementation "com.google.mlkit:text-recognition:16.0.1"';
  const ocrPattern = /^\s*implementation\s+["'](?:com\.google\.mlkit:text-recognition|com\.google\.android\.gms:play-services-mlkit-text-recognition):[^"']+["']\s*$/gm;
  source = source.replace(ocrPattern, "");
  const dependenciesMatch = /dependencies\s*\{/.exec(source);
  if (!dependenciesMatch) throw new Error("No se encontró el bloque dependencies para agregar ML Kit.");
  const dependencyBrace = source.indexOf("{", dependenciesMatch.index);
  source = source.slice(0, dependencyBrace + 1)
    + `\n    ${ocrDependency}`
    + source.slice(dependencyBrace + 1);

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
        registerPlugin(MasaNutritionLabelPlugin.class);
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
        String script = "(function(){try{if(window.MASAHandleAndroidBack&&window.MASAHandleAndroidBack())return true;var ds=Array.from(document.querySelectorAll('[role=\\"dialog\\"]')).filter(function(el){return !el.hidden&&el.getClientRects().length;});var d=ds[ds.length-1];if(!d)return false;var c=d.querySelector('.close-button:not([hidden]),button[id^=\\"close-\\"]:not([hidden]),[data-close-food],[data-close-food-editor],[data-close-recipe],[data-close-library],[data-close-settings],[data-close-meal-picker],[data-close-barcode],[data-close-about],[data-close-tips]');if(c&&!c.disabled)c.click();return true;}catch(e){return false;}})();";
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


const nutritionLabelPlugin = join(mainActivityDir, "MasaNutritionLabelPlugin.java");
await writeFile(nutritionLabelPlugin, `package uy.com.andresgonzalez.masa;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Paint;
import android.graphics.Rect;
import android.util.Base64;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

@CapacitorPlugin(name = "MasaNutritionLabel")
public class MasaNutritionLabelPlugin extends Plugin {
    private static final String TAG = "MASA_LABEL_OCR";
    private static final int MAX_IMAGE_SIDE = 2800;
    private static final int[] ROTATIONS = { 0, 90, 270, 180 };
    private volatile boolean scanInProgress = false;

    private static class OcrCandidate {
        final Text text;
        final int rotation;
        final String pass;
        final int score;
        final int keywordCount;

        OcrCandidate(Text text, int rotation, String pass, int score, int keywordCount) {
            this.text = text;
            this.rotation = rotation;
            this.pass = pass;
            this.score = score;
            this.keywordCount = keywordCount;
        }
    }

    @PluginMethod
    public void scan(PluginCall call) {
        if (scanInProgress) {
            call.reject("Ya hay una lectura de rótulo en curso.");
            return;
        }

        String imageDataUrl = call.getString("imageDataUrl");
        if (imageDataUrl == null || imageDataUrl.isEmpty()) {
            call.reject("No se recibió la foto del rótulo.");
            return;
        }

        scanInProgress = true;
        Bitmap bitmap = null;
        try {
            int comma = imageDataUrl.indexOf(',');
            String encoded = comma >= 0 ? imageDataUrl.substring(comma + 1) : imageDataUrl;
            byte[] imageBytes = Base64.decode(encoded, Base64.DEFAULT);
            bitmap = decodeScaledBitmap(imageBytes);
            if (bitmap == null) {
                scanInProgress = false;
                call.reject("Android no pudo abrir la foto tomada.");
                return;
            }
            Log.i(TAG, "Imagen recibida " + bitmap.getWidth() + "x" + bitmap.getHeight() + ", bytes=" + imageBytes.length);
            recognizeBest(call, bitmap);
        } catch (IllegalArgumentException error) {
            releaseBitmap(bitmap);
            scanInProgress = false;
            call.reject("La foto recibida no tiene un formato válido.", null, error);
        } catch (OutOfMemoryError error) {
            releaseBitmap(bitmap);
            scanInProgress = false;
            call.reject("La foto es demasiado grande para procesarla.");
        } catch (Exception error) {
            releaseBitmap(bitmap);
            scanInProgress = false;
            call.reject("No se pudo procesar la foto del rótulo.", null, error);
        }
    }

    private void recognizeBest(PluginCall call, Bitmap bitmap) {
        TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        List<OcrCandidate> candidates = new ArrayList<>();
        recognizeRotation(call, recognizer, bitmap, candidates, 0);
    }

    private void recognizeRotation(PluginCall call, TextRecognizer recognizer, Bitmap bitmap, List<OcrCandidate> candidates, int index) {
        if (index >= ROTATIONS.length) {
            OcrCandidate best = bestCandidate(candidates);
            if (best != null && best.keywordCount >= 2) {
                finishSuccess(call, recognizer, bitmap, null, best);
                return;
            }
            Bitmap enhanced = null;
            try {
                enhanced = enhanceBitmap(bitmap);
            } catch (OutOfMemoryError error) {
                Log.w(TAG, "Sin memoria para la pasada de contraste", error);
            }
            if (enhanced == null) {
                if (best != null) finishSuccess(call, recognizer, bitmap, null, best);
                else finishFailure(call, recognizer, bitmap, null, "ML Kit no pudo reconocer texto en la imagen.", null);
                return;
            }
            final Bitmap enhancedBitmap = enhanced;
            final int rotation = best != null ? best.rotation : 0;
            recognizer.process(InputImage.fromBitmap(enhancedBitmap, rotation))
                .addOnSuccessListener(text -> {
                    OcrCandidate enhancedCandidate = candidateFrom(text, rotation, "contraste");
                    candidates.add(enhancedCandidate);
                    OcrCandidate selected = bestCandidate(candidates);
                    finishSuccess(call, recognizer, bitmap, enhancedBitmap, selected);
                })
                .addOnFailureListener(error -> {
                    Log.w(TAG, "Falló la pasada de contraste", error);
                    if (best != null) finishSuccess(call, recognizer, bitmap, enhancedBitmap, best);
                    else finishFailure(call, recognizer, bitmap, enhancedBitmap, "No se pudo reconocer el texto de la foto.", error);
                });
            return;
        }

        final int rotation = ROTATIONS[index];
        recognizer.process(InputImage.fromBitmap(bitmap, rotation))
            .addOnSuccessListener(text -> {
                OcrCandidate candidate = candidateFrom(text, rotation, "original");
                candidates.add(candidate);
                Log.i(TAG, "pasada=original rotacion=" + rotation + " score=" + candidate.score
                    + " keywords=" + candidate.keywordCount + " caracteres=" + text.getText().length());
                if (isStrongCandidate(candidate)) {
                    finishSuccess(call, recognizer, bitmap, null, candidate);
                } else {
                    recognizeRotation(call, recognizer, bitmap, candidates, index + 1);
                }
            })
            .addOnFailureListener(error -> {
                Log.w(TAG, "Falló OCR con rotación " + rotation, error);
                recognizeRotation(call, recognizer, bitmap, candidates, index + 1);
            });
    }

    private OcrCandidate candidateFrom(Text text, int rotation, String pass) {
        String value = text != null ? text.getText() : "";
        int keywords = keywordCount(value);
        int lineCount = 0;
        if (text != null) {
            for (Text.TextBlock block : text.getTextBlocks()) lineCount += block.getLines().size();
        }
        int usefulCharacters = value.replaceAll("[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]", "").length();
        int score = keywords * 500 + Math.min(1000, usefulCharacters) + Math.min(300, lineCount * 10);
        return new OcrCandidate(text, rotation, pass, score, keywords);
    }

    private boolean isStrongCandidate(OcrCandidate candidate) {
        if (candidate == null || candidate.text == null) return false;
        String normalized = candidate.text.getText().toLowerCase(Locale.ROOT);
        boolean energy = normalized.contains("energ") || normalized.contains("calor") || normalized.contains("kcal");
        boolean macro = normalized.contains("prote") || normalized.contains("grasa")
            || normalized.contains("lipid") || normalized.contains("carbo") || normalized.contains("hidrato");
        return candidate.keywordCount >= 3 && energy && macro;
    }

    private int keywordCount(String value) {
        String normalized = String.valueOf(value).toLowerCase(Locale.ROOT);
        String[] keywords = { "porcion", "porción", "racion", "ración", "energ", "calor", "kcal", "prote", "grasa", "lipid", "carbo", "hidrato" };
        int count = 0;
        for (String keyword : keywords) if (normalized.contains(keyword)) count++;
        return count;
    }

    private OcrCandidate bestCandidate(List<OcrCandidate> candidates) {
        OcrCandidate best = null;
        for (OcrCandidate candidate : candidates) {
            if (candidate == null) continue;
            if (best == null || candidate.score > best.score) best = candidate;
        }
        return best;
    }

    private void finishSuccess(PluginCall call, TextRecognizer recognizer, Bitmap bitmap, Bitmap enhanced, OcrCandidate candidate) {
        try {
            JSObject response = responseFrom(candidate, bitmap);
            Log.i(TAG, "seleccion pasada=" + candidate.pass + " rotacion=" + candidate.rotation
                + " score=" + candidate.score + " keywords=" + candidate.keywordCount);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Se reconoció texto, pero no se pudo preparar el resultado.", null, error);
        } finally {
            recognizer.close();
            releaseBitmap(enhanced);
            releaseBitmap(bitmap);
            scanInProgress = false;
        }
    }

    private void finishFailure(PluginCall call, TextRecognizer recognizer, Bitmap bitmap, Bitmap enhanced, String message, Exception error) {
        recognizer.close();
        releaseBitmap(enhanced);
        releaseBitmap(bitmap);
        scanInProgress = false;
        if (error != null) call.reject(message, null, error);
        else call.reject(message);
    }

    private JSObject responseFrom(OcrCandidate candidate, Bitmap bitmap) {
        JSObject response = new JSObject();
        JSArray lines = new JSArray();
        Text text = candidate != null ? candidate.text : null;
        response.put("text", text != null ? text.getText() : "");
        response.put("rotation", candidate != null ? candidate.rotation : 0);
        response.put("pass", candidate != null ? candidate.pass : "original");
        response.put("score", candidate != null ? candidate.score : 0);
        response.put("keywordCount", candidate != null ? candidate.keywordCount : 0);
        response.put("imageWidth", bitmap != null ? bitmap.getWidth() : 0);
        response.put("imageHeight", bitmap != null ? bitmap.getHeight() : 0);

        List<Text.Line> detectedLines = new ArrayList<>();
        if (text != null) {
            for (Text.TextBlock block : text.getTextBlocks()) detectedLines.addAll(block.getLines());
        }
        detectedLines.sort(new Comparator<Text.Line>() {
            @Override
            public int compare(Text.Line first, Text.Line second) {
                Rect a = first.getBoundingBox();
                Rect b = second.getBoundingBox();
                if (a == null && b == null) return 0;
                if (a == null) return 1;
                if (b == null) return -1;
                int aCenter = a.top + a.bottom;
                int bCenter = b.top + b.bottom;
                int tolerance = Math.max(a.height(), b.height());
                if (Math.abs(aCenter - bCenter) <= tolerance) return Integer.compare(a.left, b.left);
                return Integer.compare(aCenter, bCenter);
            }
        });

        for (Text.Line line : detectedLines) {
            JSObject lineData = new JSObject();
            lineData.put("text", line.getText());
            Rect box = line.getBoundingBox();
            if (box != null) {
                lineData.put("left", box.left);
                lineData.put("top", box.top);
                lineData.put("right", box.right);
                lineData.put("bottom", box.bottom);
            }
            JSArray elements = new JSArray();
            for (Text.Element element : line.getElements()) {
                JSObject elementData = new JSObject();
                elementData.put("text", element.getText());
                Rect elementBox = element.getBoundingBox();
                if (elementBox != null) {
                    elementData.put("left", elementBox.left);
                    elementData.put("top", elementBox.top);
                    elementData.put("right", elementBox.right);
                    elementData.put("bottom", elementBox.bottom);
                }
                elements.put(elementData);
            }
            lineData.put("elements", elements);
            lines.put(lineData);
        }
        response.put("lines", lines);
        return response;
    }

    private Bitmap enhanceBitmap(Bitmap source) {
        Bitmap enhanced = Bitmap.createBitmap(source.getWidth(), source.getHeight(), Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(enhanced);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        ColorMatrix grayscale = new ColorMatrix();
        grayscale.setSaturation(0f);
        float contrast = 1.35f;
        float translate = (-0.5f * contrast + 0.5f) * 255f;
        ColorMatrix contrastMatrix = new ColorMatrix(new float[] {
            contrast, 0, 0, 0, translate,
            0, contrast, 0, 0, translate,
            0, 0, contrast, 0, translate,
            0, 0, 0, 1, 0
        });
        grayscale.postConcat(contrastMatrix);
        paint.setColorFilter(new ColorMatrixColorFilter(grayscale));
        canvas.drawBitmap(source, 0, 0, paint);
        return enhanced;
    }

    private Bitmap decodeScaledBitmap(byte[] imageBytes) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;

        int sampleSize = 1;
        int largestSide = Math.max(bounds.outWidth, bounds.outHeight);
        while (largestSide / sampleSize > MAX_IMAGE_SIDE) sampleSize *= 2;

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = Math.max(1, sampleSize);
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        return BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.length, options);
    }

    private void releaseBitmap(Bitmap bitmap) {
        if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
    }
}
`);

const manifest = join(androidRoot, "app", "src", "main", "AndroidManifest.xml");
if (await exists(manifest)) {
  let source = await readFile(manifest, "utf8");
  // El modelo OCR está empaquetado: eliminar la solicitud de descarga por Google Play Services.
  source = source.replace(
    /\s*<meta-data\s+android:name=["']com\.google\.mlkit\.vision\.DEPENDENCIES["']\s+android:value=["']ocr["']\s*\/>/g,
    ""
  );
  if (!source.includes('android:windowSoftInputMode="adjustResize"')) {
    source = source.replace(
      /(android:launchMode=["']singleTask["'])/,
      `$1\n            android:windowSoftInputMode="adjustResize"`
    );
  }
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
