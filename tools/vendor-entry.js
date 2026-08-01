import { createClient } from "@supabase/supabase-js";
import { registerPlugin } from "@capacitor/core";
import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerAndroidScanningLibrary,
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerScanOrientation,
  CapacitorBarcodeScannerTypeHintALLOption
} from "@capacitor/barcode-scanner";

const isNative = () => Boolean(window.Capacitor?.isNativePlatform?.());
const MasaAuthPlugin = registerPlugin("MasaAuth");
const MasaNutritionLabelPlugin = registerPlugin("MasaNutritionLabel");

window.supabase = { createClient };
window.MASA_NATIVE = {
  isNative,
  async openAuthUrl(url) {
    if (!url) throw new Error("No se recibió la URL de autenticación.");
    if (isNative()) {
      await MasaAuthPlugin.openAuthUrl({ url: String(url) });
      return;
    }
    window.open(String(url), "_blank", "noopener,noreferrer");
  },
  async getInitialAuthUrl() {
    if (!isNative()) return "";
    const result = await MasaAuthPlugin.getInitialAuthUrl();
    return String(result?.url || "");
  },
  async scanNutritionLabel(imageDataUrl) {
    if (!isNative()) throw new Error("La lectura de rótulos requiere la aplicación Android.");
    if (!imageDataUrl) throw new Error("No se recibió la foto del rótulo.");
    return MasaNutritionLabelPlugin.scan({ imageDataUrl: String(imageDataUrl) });
  },
  async scanBarcode() {
    return CapacitorBarcodeScanner.scanBarcode({
      hint: CapacitorBarcodeScannerTypeHintALLOption.ALL,
      cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
      scanOrientation: CapacitorBarcodeScannerScanOrientation.PORTRAIT,
      scanInstructions: "Apuntá al código de barras del alimento",
      scanButton: false,
      cancelButtonAccessibilityLabel: "Cancelar escaneo",
      torchButtonOnAccessibilityLabel: "Apagar linterna",
      torchButtonOffAccessibilityLabel: "Encender linterna",
      android: {
        scanningLibrary: CapacitorBarcodeScannerAndroidScanningLibrary.ZXING
      }
    });
  }
};

if (isNative()) document.documentElement.classList.add("native-app");
