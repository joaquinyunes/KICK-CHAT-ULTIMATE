// scripts/renew-tokens.ts — Renueva los bearer tokens usando credenciales de login
// USO: npm run renew-tokens
// Lee accounts.json, hace login a cada cuenta, obtiene nuevos tokens, actualiza bearers.enc
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { initDatabase, stmts } from "../src/models/database";
import { encryptToHex, encrypt, decrypt } from "../src/services/security";

dotenv.config();

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const ACCOUNTS_PATH = path.resolve(process.cwd(), "accounts.json");

interface Account {
  username: string;
  password: string;
}

async function loginToKick(account: Account): Promise<string | null> {
  try {
    // Intentar login con session-based auth
    const res = await fetch("https://kick.com/api/v2/login", {
      method: "POST",
      headers: {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": UA,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: account.username,
        password: account.password,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text();
      console.log(`  ✗ Login falló (${res.status}): ${text.substring(0, 100)}`);
      return null;
    }

    const data: any = await res.json();
    // Kick devuelve el token en diferentes campos según la versión
    const token = data?.token || data?.data?.token || data?.access_token || null;
    if (!token) {
      console.log(`  ✗ Login OK pero sin token: ${JSON.stringify(data).substring(0, 100)}`);
      return null;
    }

    return token;
  } catch (err: any) {
    console.log(`  ✗ Error: ${err.message}`);
    return null;
  }
}

async function main() {
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    console.error("No se encontró accounts.json");
    console.log("Crea accounts.json desde accounts.json.example con las credenciales reales");
    process.exit(1);
  }

  const accounts: Account[] = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, "utf-8")).accounts;
  console.log(`Renovando tokens: ${accounts.length} cuentas\n`);

  await initDatabase();
  const db = require("../src/models/database").getDb();

  // Leer tokens actuales
  const encPath = path.resolve(process.cwd(), "bearers.enc");
  const existing: string[] = fs.existsSync(encPath)
    ? JSON.parse(decrypt(fs.readFileSync(encPath)))
    : [];

  const newTokens: string[] = [];
  const newUsers: string[] = [];
  let vivos = 0;
  let muertos = 0;

  for (const account of accounts) {
    process.stdout.write(`${account.username}: `);
    const token = await loginToKick(account);

    if (token) {
      newTokens.push(token);
      newUsers.push(account.username);
      vivos++;
      console.log("✓");
    } else {
      muertos++;
      console.log("✗");
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  if (newTokens.length === 0) {
    console.error("\nNo se obtuvo ningún token nuevo. Verificá las credenciales.");
    process.exit(1);
  }

  // Guardar tokens nuevos
  fs.writeFileSync(encPath, encrypt(JSON.stringify(newTokens)));
  console.log(`\nbearers.enc actualizado: ${newTokens.length} tokens`);

  // Actualizar DB
  db.run("PRAGMA foreign_keys = OFF");
  db.run("DELETE FROM bots");
  db.run("PRAGMA foreign_keys = ON");

  for (let i = 0; i < newTokens.length; i++) {
    const botName = `bot${i + 1}`;
    stmts.insertBot.run({ bot_name: botName, encrypted_bearer: encryptToHex(newTokens[i]) });
    stmts.updateBotKickUsername.run([newUsers[i], i + 1]);
  }

  console.log(`DB actualizada: ${newTokens.length} bots`);
  console.log(`\nVivos: ${vivos} | Muertos: ${muertos} | Total: ${accounts.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
