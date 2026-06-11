import * as readline from "readline";
import { initDatabase, stmts } from "../src/models/database";
import { encryptToHex } from "../src/services/security";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
  console.log("🤖  Cargar nuevo Bot a la base de datos\n");

  await initDatabase();

  const botName = (await ask("  Nombre del Bot: ")).trim();
  if (!botName) {
    console.log("❌  El nombre del bot es obligatorio");
    rl.close();
    return;
  }

  const existing = stmts.findBotByName.get(botName);
  if (existing) {
    console.log(`❌  Ya existe un bot con el nombre "${botName}"`);
    rl.close();
    return;
  }

  const bearer = (await ask("  Bearer token de Kick: ")).trim();
  if (!bearer) {
    console.log("❌  El bearer token es obligatorio");
    rl.close();
    return;
  }

  const encrypted = encryptToHex(bearer);
  stmts.insertBot.run({ bot_name: botName, encrypted_bearer: encrypted });

  console.log(`\n✅  Bot "${botName}" cargado correctamente`);
  rl.close();
}

main().catch((err) => {
  console.error("❌  Error:", err);
  process.exit(1);
});
