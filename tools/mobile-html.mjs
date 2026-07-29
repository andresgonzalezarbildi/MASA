export function transformMobileHtml(html, assetVersion) {
  const version = String(assetVersion || "1.0");
  let transformed = String(html)
    .replace(/\s*<script\b[^>]*src=["']https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2[^"']*["'][^>]*><\/script>/i, "")
    .replace(/\s*<script\b[^>]*src=["']https:\/\/cdn\.jsdelivr\.net\/npm\/@zxing\/browser@[^"']+["'][^>]*><\/script>/i, "")
    .replace(/<base\s+href=["']\/masa\/["']\s*\/?>/i, '<base href="./"/>');

  const configScriptPattern = /<script\b[^>]*src=["']\.\/js\/config\.js(?:\?v=[^"']*)?["'][^>]*><\/script>/i;
  if (!configScriptPattern.test(transformed)) {
    throw new Error("No se encontró la carga de js/config.js para insertar el paquete local de Supabase.");
  }

  transformed = transformed.replace(
    configScriptPattern,
    match => `<script defer src="./vendor/masa-vendor.js?v=${version}"></script>\n${match}`
  );

  if (!transformed.includes("./vendor/masa-vendor.js")) {
    throw new Error("La preparación móvil no insertó el paquete local de Supabase.");
  }
  if (/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/i.test(transformed)) {
    throw new Error("La preparación móvil conservó una carga remota de Supabase.");
  }
  if (/cdn\.jsdelivr\.net\/npm\/@zxing\/browser/i.test(transformed)) {
    throw new Error("La preparación móvil conservó una carga remota de ZXing.");
  }

  return transformed;
}
