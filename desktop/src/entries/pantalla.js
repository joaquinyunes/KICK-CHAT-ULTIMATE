// Proceso hijo (utilityProcess) que corre Pantalla Contexto (visor + OCR local).
import { startPantallaContexto } from "../../../pantalla-context/src/index.js";

(async () => {
  const screen = await startPantallaContexto({ env: process.env });
  process.parentPort?.on("message", (e) => {
    if (e.data && e.data.type === "shutdown") screen.close().finally(() => process.exit(0));
  });
})().catch((err) => {
  console.error(err.code === "EADDRINUSE" ? `Puerto ocupado (${err.port})` : err.message);
  process.exit(1);
});
