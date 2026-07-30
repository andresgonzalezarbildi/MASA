package uy.com.andresgonzalez.masa;

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
