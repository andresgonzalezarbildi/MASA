package uy.com.andresgonzalez.masa;

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

public class MainActivity extends BridgeActivity {
    private int lastTopCss = 0;
    private int lastBottomCss = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
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
            if (!"true".equals(handled)) finish();
        });
    }
}
