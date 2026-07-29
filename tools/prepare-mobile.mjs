import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const webDir = join(root, "www");

await rm(webDir, { recursive: true, force: true });
await mkdir(webDir, { recursive: true });

for (const item of ["index.html", "css", "js", "assets", "data", "manifest.webmanifest", "DATA-LICENSE.md", "plantilla-pesajes.xlsx", "plantilla-ingestas.xlsx"]) {
  await cp(join(root, item), join(webDir, item), { recursive: true });
}
await rm(join(webDir, "js", "app.js.backup-catalogo"), { force: true });
await rm(join(webDir, "js", "config.example.js"), { force: true });

let html = await readFile(join(webDir, "index.html"), "utf8");
html = html
  .replace('<script defer="" src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>', '')
  .replace('<script defer="" src="https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js"></script>', '')
  .replace('<base href="/masa/"/>', '<base href="./"/>')
  .replace('<script defer="" src="./js/config.js?v=26.0"></script>', '<script defer src="./vendor/masa-vendor.js?v=26.0"></script>\n<script defer src="./js/config.js?v=26.0"></script>');
await writeFile(join(webDir, "index.html"), html);

await mkdir(join(webDir, "vendor"), { recursive: true });
await build({
  entryPoints: [join(root, "tools", "vendor-entry.js")],
  outfile: join(webDir, "vendor", "masa-vendor.js"),
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120"]
});

for (const relative of ["js/app.js", "js/cloud.js", "js/config.js", "css/styles.css", "css/auth.css"]) {
  const absolute = join(webDir, relative);
  const loader = relative.endsWith(".css") ? "css" : "js";
  const result = await build({
    entryPoints: [absolute],
    outfile: `${absolute}.min`,
    bundle: false,
    minify: true,
    platform: "browser",
    target: ["chrome120"],
    loader: { [`.${loader}`]: loader }
  });
  await rm(absolute, { force: true });
  await cp(`${absolute}.min`, absolute);
  await rm(`${absolute}.min`, { force: true });
}

console.log("www preparado para Capacitor");
