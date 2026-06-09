// scripts/encrypt-bearers.ts - Genera bearers.enc desde bearers.plain.json
/**
 * scripts/encrypt-bearers.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Script de setup ONE-TIME para generar `bearers.enc`.
 *
 * USO:
 *   1. Crea un archivo `bearers.plain.json` (NO commitear) con:
 *      ["bearer_token_1", "bearer_token_2", ...]
 *
 *   2. Ejecuta:
 *      MASTER_KEY="tu_clave_de_32_caracteres!!!!" npm run encrypt-bearers
 *
 *   3. El script genera `bearers.enc` y elimina `bearers.plain.json`
 *
 * IMPORTANTE: Nunca commitear bearers.plain.json ni bearers.enc
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs   from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

// Importar después de cargar .env
import { encrypt } from "../src/services/security";

const PLAIN_PATH  = path.resolve(process.cwd(), "bearers.plain.json");
const OUTPUT_PATH = path.resolve(process.cwd(), "bearers.enc");

function main() {
  if (!process.env.MASTER_KEY) {
    console.error("❌  MASTER_KEY no está definida en el entorno");
    process.exit(1);
  }

  if (!fs.existsSync(PLAIN_PATH)) {
    console.error(`❌  No se encontró ${PLAIN_PATH}`);
    console.log("   Crea el archivo con el formato: [\"bearer1\", \"bearer2\"]");
    process.exit(1);
  }

  const raw = fs.readFileSync(PLAIN_PATH, "utf8");

  let bearers: unknown;
  try {
    bearers = JSON.parse(raw);
  } catch {
    console.error("❌  bearers.plain.json tiene JSON inválido");
    process.exit(1);
  }

  if (
    !Array.isArray(bearers) ||
    bearers.length === 0 ||
    bearers.some((b) => typeof b !== "string")
  ) {
    console.error("❌  bearers.plain.json debe ser un array de strings no vacío");
    process.exit(1);
  }

  // Cifrar y guardar
  const encrypted = encrypt(JSON.stringify(bearers));
  fs.writeFileSync(OUTPUT_PATH, encrypted);
  console.log(`✅  Generado: ${OUTPUT_PATH} (${(bearers as string[]).length} bearer(s))`);

  // Eliminar el archivo plano por seguridad
  fs.unlinkSync(PLAIN_PATH);
  console.log(`🗑️   Eliminado: ${PLAIN_PATH}`);
  console.log("\n⚠️   Guarda una copia de los bearers en un gestor de secretos seguro.");
}

main();