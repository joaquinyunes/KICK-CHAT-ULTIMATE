// scripts/probe-bots.ts - Envía un mensaje de prueba con cada bearer registrado,
// captura el sender.username de la respuesta de Kick y lo guarda en la DB (kick_username).
// USO: npm run probe-bots -- <chatroom_id>   (opcional, default 20548413)
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { initDatabase, stmts } from "../src/models/database";
import { decrypt, decryptFromHex } from "../src/services/security";

dotenv.config();

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function getPlainBearers(): string[] {
  const enc = fs.readFileSync(path.resolve(process.cwd(), "bearers.enc"));
  return JSON.parse(decrypt(enc));
}

async function main() {
  const chatroomId = parseInt(process.argv[2] || "20548413", 10);
  if (!Number.isFinite(chatroomId)) { console.error("chatroomId inválido"); process.exit(1); }

  await initDatabase();
  const bearers = getPlainBearers();
  const bots = stmts.listAllBots.all() as any[];
  console.log(`Probe: ${bearers.length} bearer(s) → chatroom ${chatroomId}\n`);

  for (let i = 0; i < bearers.length; i++) {
    const b = bearers[i];
    const payload = { content: `prueba ${i + 1}/${bearers.length}`, type: "message", message_ref: String(Date.now() + i) };
    try {
      const res = await fetch(`https://kick.com/api/v2/messages/send/${chatroomId}`, {
        method: "POST",
        headers: {
          Accept: "application/json, text/plain, */*",
          "User-Agent": UA,
          "Content-Type": "application/json",
          Authorization: "Bearer " + b,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      });
      const text = await res.text();
      let sender = "";
      if (res.status === 200) { try { sender = JSON.parse(text)?.data?.sender?.username || ""; } catch {} }

      let botName = "?";
      if (sender) {
        const row = bots.find((bot: any) => {
          try { return decryptFromHex(bot.encrypted_bearer) === b; } catch { return false; }
        });
        if (row) {
          botName = row.bot_name;
          stmts.updateBotKickUsername.run([sender, row.id]);
        }
      }
      const mark = res.status === 200 ? "✓" : "✗";
      console.log(`#${String(i + 1).padStart(2, "0")} status=${res.status} user=${(sender || "?").padEnd(22)} bot=${botName} ${mark}`);
    } catch (e: any) {
      console.log(`#${String(i + 1).padStart(2, "0")} ERROR ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  console.log("\n✅ Listo. Nombres guardados en kick_username.");
}

main().catch(e => { console.error(e); process.exit(1); });