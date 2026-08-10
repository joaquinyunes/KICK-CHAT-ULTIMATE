import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { initDatabase, stmts, getDb } from "../src/models/database";
import { encryptToHex, encrypt, decrypt } from "../src/services/security";

dotenv.config();

const NEW_BOTS = [
  { token: "414237390|jTi1I4IR2ju9czD45GFXbtpERyrCmmP3iUZcRFEV", user: "jospmcruz" },
  { token: "414239336|XuXsToT0qlV3t4H7Z7iI9DYNVaD7SI0jFogLDvYV", user: "asa5last2" },
  { token: "414239962|cloY30Np3DTOZmG1AUInADTVPbR00fw7MfAH5uEs", user: "sonipsydark" },
  { token: "414240639|hadVGKBTTnLJqXRdfolhdulPfqwkVcktRSPM0aN5", user: "nahumora2" },
];

async function main() {
  await initDatabase();
  const db = getDb();
  const enc = fs.readFileSync(path.resolve(process.cwd(), "bearers.enc"));
  const existing: string[] = JSON.parse(decrypt(enc));
  console.log(`Tokens existentes: ${existing.length}`);

  const allTokens = [...existing, ...NEW_BOTS.map(b => b.token)];
  fs.writeFileSync(path.resolve(process.cwd(), "bearers.enc"), encrypt(JSON.stringify(allTokens)));

  db.run("PRAGMA foreign_keys = OFF");
  db.run("DELETE FROM bots");
  db.run("PRAGMA foreign_keys = ON");

  for (let i = 0; i < allTokens.length; i++) {
    stmts.insertBot.run({ bot_name: `bot${i + 1}`, encrypted_bearer: encryptToHex(allTokens[i]) });
    const newBot = NEW_BOTS.find(b => b.token === allTokens[i]);
    if (newBot) db.run("UPDATE bots SET kick_username = ? WHERE bot_name = ?", [newBot.user, `bot${i + 1}`]);
  }

  console.log(`Total: ${allTokens.length} tokens`);
}

main().catch(e => { console.error(e); process.exit(1); });
