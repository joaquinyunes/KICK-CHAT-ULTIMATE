// scripts/renew-tokens.ts — Renueva los bearer tokens usando credenciales de login.
// USO: npm run renew-tokens
// Lee accounts.json, hace login a cada cuenta y actualiza el bearer del bot
// correspondiente en la tabla `bots` (matcheando por kick_username). Si la cuenta
// no tiene un bot asociado todavía, crea uno nuevo. No toca bots de otras cuentas.
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { initDatabase, stmts } from "../src/models/database";
import { encryptToHex } from "../src/services/security";

dotenv.config();

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const ACCOUNTS_PATH = path.resolve(process.cwd(), "accounts.json");

interface Account {
  username: string;
  password: string;
}

async function loginToKick(account: Account): Promise<string | null> {
  try {
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
  let bots = stmts.listAllBots.all() as any[];

  let vivos = 0;
  let muertos = 0;
  let actualizados = 0;
  let creados = 0;

  for (const account of accounts) {
    process.stdout.write(`${account.username}: `);
    const token = await loginToKick(account);

    if (!token) {
      muertos++;
      console.log("✗");
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    vivos++;
    console.log("✓");

    const encrypted = encryptToHex(token);
    const existing = bots.find((b) => b.kick_username === account.username);
    if (existing) {
      stmts.updateBotBearer.run([encrypted, existing.id]);
      actualizados++;
    } else {
      const botName = `bot${bots.length + 1}`;
      const result = stmts.insertBot.run({ bot_name: botName, encrypted_bearer: encrypted });
      const newBot = { id: Number(result.lastInsertRowid), bot_name: botName, kick_username: account.username };
      stmts.updateBotKickUsername.run([account.username, newBot.id]);
      bots.push(newBot);
      creados++;
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\nDB actualizada: ${actualizados} bot(s) renovados, ${creados} bot(s) nuevos`);
  console.log(`Vivos: ${vivos} | Muertos: ${muertos} | Total: ${accounts.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
