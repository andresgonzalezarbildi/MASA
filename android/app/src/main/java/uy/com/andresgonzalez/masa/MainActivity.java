package uy.com.andresgonzalez.masa;

import android.os.Bundle;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        hideStatusBar();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideStatusBar();
    }

    private void hideStatusBar() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) controller.hide(WindowInsets.Type.statusBars());
        } else {
            getWindow().setFlags(
                android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN,
                android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN
            );
        }
    }
}
