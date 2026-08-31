import bcrypt from "bcryptjs";
import { initDatabase, getDb, flushDb } from "../src/models/database";

async function main() {
  const pass = process.argv[2] || "admin1234";
  await initDatabase();
  const db = getDb();
  const hash = bcrypt.hashSync(pass, 12);
  const r = db.exec("SELECT id FROM users WHERE username = 'admin' LIMIT 1");
  if (r.length === 0) {
    db.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', ?, 'admin')", [hash]);
    console.log(`admin creado — contraseña: ${pass}`);
  } else {
    db.run("UPDATE users SET password_hash = ? WHERE username = 'admin'", [hash]);
    console.log(`admin actualizado — contraseña: ${pass}`);
  }
  flushDb();
  await new Promise((res) => setTimeout(res, 300));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
