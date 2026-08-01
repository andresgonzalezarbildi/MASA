package uy.com.andresgonzalez.masa;

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
