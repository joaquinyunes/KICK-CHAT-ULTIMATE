// scripts/probe-bearers-silent.ts — Prueba cada bearer enviando un mensaje y borrándolo al instante.
// No queda nada visible en el chatroom.
// USO: npm run probe-silent -- [chatroom_id]  (default 20548413)
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
  console.log(`Probe silencioso: ${bearers.length} bearer(s) → chatroom ${chatroomId}\n`);

  let vivos = 0;
  let muertos = 0;

  for (let i = 0; i < bearers.length; i++) {
    const b = bearers[i];
    const ref = String(Date.now() + i);
    const payload = { content: `test-${ref}`, type: "message", message_ref: ref };

    try {
      // 1) Enviar mensaje de prueba
      const sendRes = await fetch(`https://kick.com/api/v2/messages/send/${chatroomId}`, {
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

      const text = await sendRes.text();
      let sender = "";
      let messageId: string | null = null;

      if (sendRes.status === 200) {
        try {
          const parsed = JSON.parse(text);
          sender = parsed?.data?.sender?.username || "";
          messageId = parsed?.data?.id ? String(parsed.data.id) : null;
        } catch {}
      }

      // 2) Si se envió, borrarlo de inmediato
      let deleted = false;
      if (messageId && sendRes.status === 200) {
        try {
          const delUrl = `https://kick.com/api/v2/messages/delete/${chatroomId}/${messageId}`;
          const delRes = await fetch(delUrl, {
            method: "DELETE",
            headers: {
              Accept: "application/json, text/plain, */*",
              "User-Agent": UA,
              "Content-Type": "application/json",
              Authorization: "Bearer " + b,
            },
            body: JSON.stringify({ reason: "probe" }),
            signal: AbortSignal.timeout(12000),
          });
          deleted = delRes.ok;
        } catch {}
      }

      // 3) Guardar username si lo tenemos
      if (sender) {
        const row = bots.find((bot: any) => {
          try { return decryptFromHex(bot.encrypted_bearer) === b; } catch { return false; }
        });
        if (row) stmts.updateBotKickUsername.run([sender, row.id]);
      }

      const mark = sendRes.status === 200 ? "✓ VIVO" : "✗ MUERTO";
      const delInfo = sendRes.status === 200 ? (deleted ? " [borrado]" : " [no se pudo borrar]") : "";
      console.log(`#${String(i + 1).padStart(2, "0")} ${mark} status=${sendRes.status} user=${(sender || "?").padEnd(22)}${delInfo}`);
      if (sendRes.status === 200) vivos++; else muertos++;
    } catch (e: any) {
      console.log(`#${String(i + 1).padStart(2, "0")} ✗ MUERTO ERROR ${e.message}`);
      muertos++;
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n═══ RESUMEN ═══`);
  console.log(`Vivos: ${vivos} | Muertos: ${muertos} | Total: ${bearers.length}`);
  console.log(`Usernames guardados en kick_username.`);
}

main().catch(e => { console.error(e); process.exit(1); });
