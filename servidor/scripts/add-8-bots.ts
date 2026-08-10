import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { initDatabase, stmts, getDb } from "../src/models/database";
import { encryptToHex, encrypt, decrypt } from "../src/services/security";

dotenv.config();

const NEW_BOTS = [
  { token: "415678208|DU5gMaGcQqMhQWHZ6YkJyeI5pE6lCAMrtl5vk049", user: "mlxa3e" },
  { token: "415681197|0QoqaMGlBNvbC48W1icuZkl8Nz4Pgweck4ugjmSQ", user: "b0ombit420" },
  { token: "415682078|sfpMCnJMYShsiIa2dfd16yFkePTrmCAyUXOZXAak", user: "p33chi" },
  { token: "415682713|0C3kJ3FOqqdmMORxaNdqJvUJKHA6YzUjfhtkCQKa", user: "nazaw3in" },
  { token: "415683702|eaAxGg3ab5qJV6TdBfSd6Fy56DmbSfDqpPjpRmol", user: "manzari0uz" },
  { token: "415684066|2vwBzPP0zkMEpkVpC5o8S3THq0Lfy7XhgfEXgbyL", user: "dkkored" },
  { token: "415684794|JMMKE9mtltjdqtDaBwoQS6Uaaz5yJv9HM2O7MkB6", user: "GINO3N3" },
  { token: "415686143|sGH9ZrrLi3ovGcO87F3gRbwsMBGqylGWc95vY9Fh", user: "chaskyyy12" },
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
