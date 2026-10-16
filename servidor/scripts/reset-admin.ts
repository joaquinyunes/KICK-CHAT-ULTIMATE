import bcrypt from "bcryptjs";
import { initDatabase, getDb, flushDb, stmts } from "../src/models/database";

const NEW_PASS = process.argv[2];
if (!NEW_PASS || NEW_PASS.length < 12) {
  console.error("Uso: npx ts-node scripts/reset-admin.ts <nueva-contraseña de 12+ caracteres>");
  process.exit(1);
}

async function main() {
  await initDatabase();
  const db = getDb();
  const hash = bcrypt.hashSync(NEW_PASS, 12);

  const existing = stmts.findUserByUsername.get("admin");
  if (existing) {
    db.run("UPDATE users SET password_hash = ?, role = 'admin', is_active = 1 WHERE username = 'admin'", [hash]);
    console.log(`✅  Contraseña de "admin" actualizada.`);
  } else {
    db.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', ?, 'admin')", [hash]);
    console.log(`✅  Usuario "admin" creado.`);
  }

  flushDb();
  console.log("💾  DB persistida en data/streamchat.db");
}

main().catch((err) => {
  console.error("❌  Error:", err);
  process.exit(1);
});
