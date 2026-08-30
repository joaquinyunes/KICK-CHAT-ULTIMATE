// Copia los workers Python al dir de build. Cross-platform (reemplaza `copy /Y`).
const fs = require("fs");
const path = require("path");

const dist = path.resolve(__dirname, "..", "dist");
fs.mkdirSync(dist, { recursive: true });

for (const f of ["vod_viewer_worker.py"]) {
  const src = path.resolve(__dirname, "..", f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(dist, f));
    console.log(`copied ${f} -> dist/`);
  }
}
