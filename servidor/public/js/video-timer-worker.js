// Latido del reloj del video. Vive en un Worker porque los timers de la página se frenan (hasta 1 vez por minuto)
// cuando la pestaña queda en segundo plano, y quien usa esto está mirando el video en otra ventana.
let id = null;
self.onmessage = (e) => {
  if (e.data === 'start') { if (id === null) id = setInterval(() => self.postMessage(1), 250); }
  else if (e.data === 'stop') { clearInterval(id); id = null; }
};
