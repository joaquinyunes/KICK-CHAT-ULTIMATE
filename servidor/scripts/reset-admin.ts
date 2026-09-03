import bcrypt from "bcryptjs";
import { initDatabase, getDb, flushDb, stmts } from "../src/models/database";

const NEW_PASS = process.argv[2] || "admin123";

async function main() {
  await initDatabase();
  const db = getDb();
  const hash = bcrypt.hashSync(NEW_PASS, 12);

  const existing = stmts.findUserByUsername.get("admin");
  if (existing) {
    db.run("UPDATE users SET password_hash = ?, role = 'admin', is_active = 1 WHERE username = 'admin'", [hash]);
    console.log(`✅  Contraseña de "admin" actualizada a: ${NEW_PASS}`);
  } else {
    db.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', ?, 'admin')", [hash]);
    console.log(`✅  Usuario "admin" creado con contraseña: ${NEW_PASS}`);
  }

  flushDb();
  console.log("💾  DB persistida en data/streamchat.db");
}

main().catch((err) => {
  console.error("❌  Error:", err);
  process.exit(1);
});
