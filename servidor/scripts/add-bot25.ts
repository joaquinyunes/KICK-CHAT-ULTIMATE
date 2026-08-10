import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { initDatabase, stmts, getDb } from "../src/models/database";
import { encryptToHex, encrypt, decrypt } from "../src/services/security";

dotenv.config();

const TOKEN = "415676679|6QrMiJBE6yYuwA2Ks45oJ6OVCK2gQ25gsFiZfDbh";
const USER = "A55roex";

async function main() {
  await initDatabase();
  const db = getDb();
  const enc = fs.readFileSync(path.resolve(process.cwd(), "bearers.enc"));
  const existing: string[] = JSON.parse(decrypt(enc));
  console.log(`Tokens existentes: ${existing.length}`);

  const allTokens = [...existing, TOKEN];
  fs.writeFileSync(path.resolve(process.cwd(), "bearers.enc"), encrypt(JSON.stringify(allTokens)));

  db.run("PRAGMA foreign_keys = OFF");
  db.run("DELETE FROM bots");
  db.run("PRAGMA foreign_keys = ON");

  for (let i = 0; i < allTokens.length; i++) {
    stmts.insertBot.run({ bot_name: `bot${i + 1}`, encrypted_bearer: encryptToHex(allTokens[i]) });
  }
  db.run("UPDATE bots SET kick_username = ? WHERE bot_name = ?", [USER, "bot" + allTokens.length]);

  console.log(`Total: ${allTokens.length} tokens`);
}

main().catch(e => { console.error(e); process.exit(1); });
