import * as readline from "readline";
import { initDatabase, stmts } from "../src/models/database";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
  console.log("🔗  Asignar Bot a Cliente\n");

  await initDatabase();

  const bots = stmts.listActiveBots.all();
  if (bots.length === 0) {
    console.log("❌  No hay bots activos. Carga uno con: npm run add-bot");
    rl.close();
    return;
  }

  console.log("  Bots disponibles:");
  for (const bot of bots) {
    console.log(`    [${bot.id}] ${bot.bot_name}`);
  }

  const botIdStr = (await ask("\n  ID del Bot: ")).trim();
  const botId = parseInt(botIdStr, 10);
  const bot = bots.find((b) => b.id === botId);
  if (!bot) {
    console.log("❌  ID de bot inválido");
    rl.close();
    return;
  }

  const username = (await ask("  Nombre de usuario del cliente: ")).trim();
  const user = stmts.findUserByUsername.get(username);
  if (!user) {
    console.log(`❌  No existe un cliente con el nombre "${username}"`);
    rl.close();
    return;
  }

  stmts.assignBotToUser.run({ bot_id: botId, user_id: user.id });
  console.log(`\n✅  Bot "${bot.bot_name}" asignado a "${username}"`);
  rl.close();
}

main().catch((err) => {
  console.error("❌  Error:", err);
  process.exit(1);
});
