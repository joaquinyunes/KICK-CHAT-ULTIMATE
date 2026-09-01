// scripts/probe-bots.ts - Envía un mensaje de prueba con cada bearer registrado en la DB,
// captura el sender.username de la respuesta de Kick y lo guarda en la DB (kick_username).
// USO: npm run probe-bots -- <chatroom_id>   (opcional, default 20548413)
import dotenv from "dotenv";
import { initDatabase, stmts } from "../src/models/database";
import { decryptFromHex } from "../src/services/security";

dotenv.config();

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function main() {
  const chatroomId = parseInt(process.argv[2] || "20548413", 10);
  if (!Number.isFinite(chatroomId)) { console.error("chatroomId inválido"); process.exit(1); }

  await initDatabase();
  const bots = (stmts.listAllBots.all() as any[]).filter((b) => b.is_active);
  const targets = bots
    .map((bot) => { try { return { bot, bearer: decryptFromHex(bot.encrypted_bearer) }; } catch { return null; } })
    .filter((x): x is { bot: any; bearer: string } => !!x && !!x.bearer);

  console.log(`Probe: ${targets.length} bearer(s) → chatroom ${chatroomId}\n`);

  for (let i = 0; i < targets.length; i++) {
    const { bot, bearer: b } = targets[i];
    const payload = { content: `prueba ${i + 1}/${targets.length}`, type: "message", message_ref: String(Date.now() + i) };
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

      if (sender) stmts.updateBotKickUsername.run([sender, bot.id]);

      const mark = res.status === 200 ? "✓" : "✗";
      console.log(`#${String(i + 1).padStart(2, "0")} status=${res.status} user=${(sender || "?").padEnd(22)} bot=${bot.bot_name} ${mark}`);
    } catch (e: any) {
      console.log(`#${String(i + 1).padStart(2, "0")} bot=${bot.bot_name} ERROR ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log("\n✅ Listo. Nombres guardados en kick_username.");
}

main().catch((e) => { console.error(e); process.exit(1); });
