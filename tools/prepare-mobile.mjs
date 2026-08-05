import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transformMobileHtml, transformMobileLegalHtml } from "./mobile-html.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const webDir = join(root, "www");

await rm(webDir, { recursive: true, force: true });
await mkdir(webDir, { recursive: true });

for (const item of ["index.html", "privacy.html", "terms.html", "css", "js", "assets", "data", "manifest.webmanifest", "DATA-LICENSE.md", "plantilla-pesajes.xlsx", "plantilla-ingestas.xlsx"]) {
  await cp(join(root, item), join(webDir, item), { recursive: true });
}
await rm(join(webDir, "js", "app.js.backup-catalogo"), { force: true });
await rm(join(webDir, "js", "config.example.js"), { force: true });

const packageData = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const assetVersion = String(packageData.version || "1.0.0").split(".").slice(0, 2).join(".");
let html = await readFile(join(webDir, "index.html"), "utf8");
html = transformMobileHtml(html, assetVersion);
await writeFile(join(webDir, "index.html"), html);

for (const legalPage of ["privacy.html", "terms.html"]) {
  const legalPath = join(webDir, legalPage);
  const legalHtml = transformMobileLegalHtml(await readFile(legalPath, "utf8"));
  await writeFile(legalPath, legalHtml);
}

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

for (const relative of ["js/app.js", "js/cloud.js", "js/sync-merge.js", "js/config.js", "css/styles.css", "css/auth.css"]) {
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
