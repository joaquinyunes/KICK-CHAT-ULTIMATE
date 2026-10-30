// Construye desktop/build/app: el código propio (servidor, Pantalla Contexto y proceso principal) queda como
// bytecode de V8 (.jsc) generado a partir de un bundle ofuscado; no se publica ningún .js/.ts de la app.
// Los paquetes de terceros se instalan aparte en node_modules.
//
//   1. esbuild  -> un solo archivo por componente (paquetes externos)
//   2. javascript-obfuscator
//   3. bytenode (con el Electron de la app) -> .jsc, y se borra el .js
//   4. estáticos del panel minificados, ffmpeg y dependencias de producción
import { build, transform } from "esbuild";
import JavaScriptObfuscator from "javascript-obfuscator";
import { minify as minifyHtml } from "html-minifier-terser";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(DESKTOP, "..");
const BUILD = path.join(DESKTOP, "build");
const APP = path.join(BUILD, "app");
const STAGE = path.join(BUILD, "stage");
const electronExe = require("electron");

const OBFUSCATOR = {
  target: "node",
  compact: true,
  ignoreRequireImports: true,
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.4,
  numbersToExpressions: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayEncoding: ["rc4"],
  stringArrayThreshold: 1,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersType: "function",
  transformObjectKeys: false,
  selfDefending: false,
  sourceMap: false,
};

const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const mkdir = (p) => fs.mkdirSync(p, { recursive: true });
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false, ...opts });
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} ${args.join(" ")} -> ${r.status ?? r.error}`);
};

// import("tesseract.js") no funciona dentro de bytecode (no hay callback de import dinámico): se usa require.
const dynamicImportToRequire = {
  name: "dynamic-import-to-require",
  setup(b) {
    b.onLoad({ filter: /ocr[\\/]engine\.js$/ }, (args) => ({
      contents: fs.readFileSync(args.path, "utf8").replace('() => import("tesseract.js")', '() => Promise.resolve(require("tesseract.js"))'),
      loader: "js",
    }));
  },
};

async function bundle(name, entry, extra = {}) {
  const out = path.join(STAGE, `${name}.js`);
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    packages: "external",
    external: ["electron"],
    logLevel: "warning",
    legalComments: "none",
    ...extra,
  });
  return out;
}

function obfuscate(file) {
  const code = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, JavaScriptObfuscator.obfuscate(code, OBFUSCATOR).getObfuscatedCode());
}

function toJsc(jsFile, jscFile) {
  mkdir(path.dirname(jscFile));
  run(electronExe, [path.join(DESKTOP, "scripts", "compile-jsc.cjs"), jsFile, jscFile], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
}

function writeStub(file, target) {
  mkdir(path.dirname(file));
  fs.writeFileSync(file, `require("bytenode");\nrequire(${JSON.stringify(target)});\n`);
}

async function copyStatics(from, to) {
  mkdir(to);
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await copyStatics(src, dst);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    const text = () => fs.readFileSync(src, "utf8");
    try {
      if (ext === ".js") fs.writeFileSync(dst, (await transform(text(), { minify: true, loader: "js", legalComments: "none" })).code);
      else if (ext === ".css") fs.writeFileSync(dst, (await transform(text(), { minify: true, loader: "css" })).code);
      else if (ext === ".html") fs.writeFileSync(dst, await minifyHtml(text(), { collapseWhitespace: true, removeComments: true, minifyJS: true, minifyCSS: true }));
      else fs.copyFileSync(src, dst);
    } catch (err) {
      console.warn(`sin minificar ${path.relative(ROOT, src)}: ${err.message}`);
      fs.copyFileSync(src, dst);
    }
  }
}

function productionDeps() {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p, "package.json"), "utf8"));
  const server = read("servidor");
  const screen = read("pantalla-context");
  const bytenode = JSON.parse(fs.readFileSync(path.join(DESKTOP, "package.json"), "utf8")).devDependencies.bytenode;
  return { ...screen.dependencies, ...server.dependencies, bytenode };
}

rm(APP);
rm(STAGE);
mkdir(APP);
mkdir(STAGE);

console.log("→ bundles");
const serverJs = await bundle("server", path.join(DESKTOP, "src/entries/server.js"), { tsconfig: path.join(ROOT, "servidor/tsconfig.json") });
const screenJs = await bundle("pantalla", path.join(DESKTOP, "src/entries/pantalla.js"), {
  define: { "import.meta.url": "__importMetaUrl" },
  banner: { js: 'const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
  plugins: [dynamicImportToRequire],
});
const mainJs = await bundle("main", path.join(DESKTOP, "src/main.js"), { loader: { ".pem": "text" } });

console.log("→ ofuscado + bytecode");
for (const [file, dest] of [
  [serverJs, "server/dist/server.jsc"],
  [screenJs, "pantalla/dist/pantalla.jsc"],
  [mainJs, "main.jsc"],
]) {
  obfuscate(file);
  toJsc(file, path.join(APP, dest));
}
writeStub(path.join(APP, "server/index.js"), "./dist/server.jsc");
writeStub(path.join(APP, "pantalla/index.js"), "./dist/pantalla.jsc");
writeStub(path.join(APP, "boot.js"), "./main.jsc");

console.log("→ estáticos");
await copyStatics(path.join(ROOT, "servidor/public"), path.join(APP, "server/public"));
await copyStatics(path.join(ROOT, "pantalla-context/public"), path.join(APP, "pantalla/public"));
fs.copyFileSync(path.join(DESKTOP, "src/preload-setup.js"), path.join(APP, "preload-setup.js"));
fs.copyFileSync(path.join(DESKTOP, "src/preload-license.js"), path.join(APP, "preload-license.js"));
await copyStatics(path.join(DESKTOP, "src/renderer"), path.join(APP, "renderer"));

console.log("→ dependencias de producción");
fs.writeFileSync(
  path.join(APP, "package.json"),
  JSON.stringify({ name: "kick-chat-ultimate", productName: "KICK-CHAT-ULTIMATE", version: "1.0.0", main: "boot.js", author: "joaquinyunes", dependencies: productionDeps() }, null, 2),
);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
run(npm, ["install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: APP, shell: process.platform === "win32" });

console.log("→ ffmpeg");
mkdir(path.join(BUILD, "bin"));
fs.copyFileSync(require("ffmpeg-static"), path.join(BUILD, "bin", "ffmpeg.exe"));

rm(STAGE);
console.log("OK →", APP);
