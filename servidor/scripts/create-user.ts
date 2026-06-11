import * as readline from "readline";
import bcrypt from "bcryptjs";
import { initDatabase, stmts } from "../src/models/database";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
  console.log("👤  Crear nuevo cliente\n");

  await initDatabase();

  const username = (await ask("  Nombre de usuario: ")).trim();
  if (!username) {
    console.log("❌  El nombre de usuario es obligatorio");
    rl.close();
    return;
  }

  const existing = stmts.findUserByUsername.get(username);
  if (existing) {
    console.log(`❌  Ya existe un usuario con el nombre "${username}"`);
    rl.close();
    return;
  }

  const password = (await ask("  Contraseña: ")).trim();
  if (!password || password.length < 6) {
    console.log("❌  La contraseña debe tener al menos 6 caracteres");
    rl.close();
    return;
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  stmts.insertUser.run({ username, password_hash: passwordHash });

  console.log(`\n✅  Cliente "${username}" creado correctamente`);
  rl.close();
}

main().catch((err) => {
  console.error("❌  Error:", err);
  process.exit(1);
});
