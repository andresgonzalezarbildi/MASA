package uy.com.andresgonzalez.masa;

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
        String script = "(function(){try{if(window.MASAHandleAndroidBack&&window.MASAHandleAndroidBack())return true;var ds=Array.from(document.querySelectorAll('[role=\"dialog\"]')).filter(function(el){return !el.hidden&&el.getClientRects().length;});var d=ds[ds.length-1];if(!d)return false;var c=d.querySelector('.close-button:not([hidden]),button[id^=\"close-\"]:not([hidden]),[data-close-food],[data-close-food-editor],[data-close-recipe],[data-close-library],[data-close-settings],[data-close-meal-picker],[data-close-barcode],[data-close-about],[data-close-tips],[data-close-legal]');if(c&&!c.disabled)c.click();return true;}catch(e){return false;}})();";
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
