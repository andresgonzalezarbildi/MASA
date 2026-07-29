import { createClient } from "@supabase/supabase-js";
import { BrowserMultiFormatReader } from "@zxing/browser";
import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerAndroidScanningLibrary,
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerScanOrientation,
  CapacitorBarcodeScannerTypeHintALLOption
} from "@capacitor/barcode-scanner";

const isNative = () => Boolean(window.Capacitor?.isNativePlatform?.());

window.supabase = { createClient };
window.ZXingBrowser = { BrowserMultiFormatReader };
window.MASA_NATIVE = {
  isNative,
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
