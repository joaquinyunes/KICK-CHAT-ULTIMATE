// Proceso hijo (utilityProcess) que corre el servidor KCU. Lo lanza main.js con el entorno ya armado.
// El cierre es ordenado: al recibir {type:"shutdown"} dispara el mismo camino que SIGTERM
// (cierra el HTTP, mata el pipeline y vuelca la base a disco antes de salir).
if (process.parentPort) {
  process.parentPort.on("message", (e) => {
    if (e.data && e.data.type === "shutdown") process.emit("SIGTERM");
  });
}
require("../../../servidor/src/server-engine.ts");
