// Se ejecuta con el binario de Electron (ELECTRON_RUN_AS_NODE=1): así el bytecode sale con el V8 exacto
// de la app y no con el de Node. Uso: electron compile-jsc.cjs <entrada.js> <salida.jsc>
const bytenode = require("bytenode");

const [, , input, output] = process.argv;
bytenode.compileFile({ filename: input, output });
