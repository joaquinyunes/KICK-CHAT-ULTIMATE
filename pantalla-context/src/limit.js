import { HttpError } from "./validate.js";

// Un análisis a la vez. Un modelo local ya satura la CPU con uno solo, y encolar peticiones
// solo acumularía capturas obsoletas: mejor rechazar y que el visor reintente con una nueva.
export function singleFlight(analyze) {
  let busy = false;
  return async (req) => {
    if (busy) {
      throw new HttpError(429, "busy", "El analizador está ocupado con otra captura. Reintenta en unos segundos.");
    }
    busy = true;
    try {
      return await analyze(req);
    } finally {
      busy = false;
    }
  };
}
