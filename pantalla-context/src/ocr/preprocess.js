import jpeg from "jpeg-js";

// Segundo paso para texto difícil: claro con sombra u contorno oscuro sobre fondos claros o con degradados.
// El OCR normal binariza toda la imagen con un único umbral y ahí falla; aquí se compara cada píxel con su entorno.
// Medido en una pantalla adversarial: la confianza del título pasó de 18 a 95 (ventana 41, contraste 20).
const WINDOW = 41;
const CONTRAST = 20;
const MAX_PIXELS = 4096 * 2304; // no decodificar imágenes enormes: son memoria y tiempo para nada

// Escribe un BMP de 8 bits en gris (Tesseract lo lee y no hace falta ninguna librería de PNG).
function toBmp(gray, width, height) {
  const row = (width + 3) & ~3;
  const size = 54 + 1024 + row * height;
  const bmp = Buffer.alloc(size);
  bmp.write("BM", 0);
  bmp.writeUInt32LE(size, 2);
  bmp.writeUInt32LE(54 + 1024, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(-height, 22); // alto negativo: filas de arriba abajo
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(8, 28);
  bmp.writeUInt32LE(256, 46);
  for (let i = 0; i < 256; i++) bmp.writeUInt32LE((i << 16) | (i << 8) | i, 54 + i * 4);
  for (let y = 0; y < height; y++) Buffer.from(gray.buffer, y * width, width).copy(bmp, 54 + 1024 + y * row);
  return bmp;
}

// Devuelve { image: Buffer BMP, ms } o null si la imagen no es un JPEG decodificable.
export function enhanceLightText(jpegBuffer) {
  const started = performance.now();
  let decoded;
  try {
    decoded = jpeg.decode(jpegBuffer, { useTArray: true, maxResolutionInMP: MAX_PIXELS / 1e6, maxMemoryUsageInMB: 512 });
  } catch {
    return null;
  }
  const { width, height, data } = decoded;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) | 0;

  // Imagen integral: la media de cualquier ventana se calcula con 4 lecturas, sea cual sea su tamaño.
  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += gray[y * width + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum;
    }
  }
  const r = WINDOW >> 1;
  const out = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height, y + r + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width, x + r + 1);
      const sum = integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0];
      // «Tinta» = más claro que su entorno: el texto claro pasa a negro sobre blanco.
      if (gray[y * width + x] > sum / ((x1 - x0) * (y1 - y0)) + CONTRAST) out[y * width + x] = 0;
    }
  }
  return { image: toBmp(out, width, height), ms: Math.round(performance.now() - started) };
}
