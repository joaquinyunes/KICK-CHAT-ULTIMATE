import saludos from './saludos.js';
import noticias from './noticias.js';
import slots from './slots.js';
import cierre from './cierre.js';
import bonus from './bonus.js';
import premio from './premio.js';
import apuestas from './apuestas.js';
import pedidos from './pedidos.js';
import charla from './charla.js';
import sorteo from './sorteo.js';
import pausa from './pausa.js';

/** Secciones de fábrica, en el orden del stream. Se pueden editar ("Restaurar" vuelve a este texto). */
export const SECCIONES = [saludos, noticias, slots, bonus, premio, apuestas, pedidos, charla, sorteo, pausa, cierre];

/** Etiquetas y ejemplos de las variables conocidas (las de secciones propias usan su nombre). */
export const VARIABLES = {
  streamer: { label: 'Streamer', ej: 'nombre del streamer' },
  tema: { label: 'Tema del directo', ej: 'ej: noche de bonus' },
  opcion: { label: 'Opción que se discute', ej: 'ej: comprar el bonus' },
  slot: { label: 'Slot', ej: 'ej: Gates of Olympus' },
  multi: { label: 'Multiplicador', ej: 'ej: x250' },
  apuesta: { label: 'Apuesta por spin', ej: 'ej: 500' },
  saldo: { label: 'Saldo', ej: 'ej: 80 lucas' },
  premio: { label: 'Premio', ej: 'ej: 120 lucas' },
};
