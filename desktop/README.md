# App de escritorio (Windows)

Empaqueta **todo** en un instalador: el servidor KCU, el pipeline de contexto (`kick-context/`, Python) y
Pantalla Contexto (`pantalla-context/`, visor + OCR local). No hace falta instalar Node, Python ni ffmpeg.

```
Electron (proceso principal)
 ├─ servidor KCU            utilityProcess · 127.0.0.1:3000 · bytecode V8
 │    └─ pipeline Python     kc-runtime.exe (Nuitka) · lanzado por el supervisor del servidor
 └─ Pantalla Contexto        utilityProcess · 127.0.0.1:3100 · bytecode V8 · OCR con tesseract.js
```

## Construir

Requisitos en el equipo que construye: Node 22+, Python 3.11+ y conexión (la primera vez Nuitka baja MinGW).

```powershell
cd desktop
npm install
# 1. Pipeline de Python -> build/python-dist/kc-runtime.exe
python -m venv ..\..\kcbuild\venv
..\..\kcbuild\venv\Scripts\python -m pip install faster-whisper pytesseract pillow requests nuitka ordered-set zstandard
..\..\kcbuild\venv\Scripts\python scripts\build_python.py
# 2. JS (bundle -> ofuscado -> bytecode) -> build/app
npm run build:js
node scripts\smoke.cjs            # prueba de humo del resultado
# 3. Instalador -> release/
npm run dist
```

Si `npm install` no descarga el binario de Electron (npm 11 bloquea los scripts de instalación), ejecuta
`node node_modules\electron\install.js`.

## Licencias: quién puede usar la app y por cuántos días

Cada persona instala y corre todo en su PC (sin VPS). Tú controlas el acceso con licencias firmadas:

1. La persona abre la app → ve la ventana **Activar licencia** con el **ID de su equipo**. Te lo manda.
2. Tú generas la clave (solo con tu clave privada, que nunca sale de tu PC):
   ```powershell
   node admin\license.mjs issue --user ANA --machine 9C11C-DE8BA-F1784-792B3 --days 30
   ```
3. Le pasas la clave `KCU1....`; la pega y listo. Menú **Archivo → Licencia…** muestra usuario y días restantes.

Otros comandos: `list` (estado de todas), `renew --id <id> --days N` (clave nueva para el mismo usuario y equipo),
`revoke --id <id>` y `export-revoked`.

- La clave va **atada a un equipo**: no sirve en otro PC. La app solo trae la clave pública, así que puede comprobar
  licencias pero no fabricarlas ni alargarlas (cualquier cambio rompe la firma).
- Se revisa al abrir y cada hora; si venció, la app se cierra. Si atrasan el reloj para ganar días, la app lo detecta.
- **Primera vez:** `node admin\license.mjs keygen` crea `~/.kcu-license/private.pem` y escribe la pública en
  `src/license-public.pem`. **Guarda una copia de `~/.kcu-license`**: sin esa clave no puedes emitir licencias para las builds ya
  repartidas. No la subas a ningún sitio. La clave pública sí va en el repo.
- **Cortar a alguien antes de que venza (opcional):** publica el `revoked.json` que genera `export-revoked` en una URL pública
  (por ejemplo un archivo *raw* de GitHub) y pon esa URL en `src/license-config.json` (`revocationUrl`) antes de compilar. La app la
  consulta cuando hay internet. Sin ella, una licencia solo se corta cuando vence: usa plazos cortos y renueva.
- **Límite honesto:** sin servidor no hay forma de impedir que alguien parchee el binario para saltarse la comprobación. El
  bytecode, la ofuscación y los fusibles lo hacen difícil, no imposible; la revocación solo funciona con internet.

## Qué protege y qué no

| Parte | Cómo queda en el instalador |
|---|---|
| Servidor, Pantalla Contexto, proceso principal | Bundle (esbuild) → ofuscado (string array RC4, control flow) → bytecode V8 `.jsc`. No se incluye ningún `.js`/`.ts` propio |
| Pipeline Python | Compilado a C y a binario nativo con Nuitka. Los prompts van **dentro** del ejecutable, no como `.txt` |
| Contenedor | `app.asar` con comprobación de integridad, y fusibles de Electron: sin `RUN_AS_NODE`, sin `--inspect`, sin `NODE_OPTIONS`, solo carga desde el asar |
| Ventanas | DevTools desactivadas (F12 y Ctrl+Shift+I bloqueados), navegación limitada a la app y a `kick.com` |
| Servicios locales | Escuchan solo en `127.0.0.1` y exigen un token aleatorio por arranque (`x-desktop-token`): un navegador u otro programa recibe 403 |
| Secretos | `MASTER_KEY`, `JWT_SECRET` y contraseña de admin se generan en el primer arranque y se guardan cifrados con DPAPI. Las claves de Kick/Gemini/OpenRouter las escribe el usuario; no viajan en el instalador |

**Límites reales.** Ninguna protección es absoluta: quien tenga la máquina y tiempo puede volcar la memoria del
proceso o desensamblar los binarios. Esto sube mucho el costo, no lo hace imposible. El HTML/JS/CSS del panel se
minifica pero llega a la ventana como cualquier web (no hay forma de ocultarlo a quien usa la app). Los paquetes de
terceros (`node_modules`) van en el asar, legibles pero son de código abierto. **No metas claves propias dentro del
build**: lo que se empaqueta se puede extraer.

## No incluido

- `servidor/vod_viewer_worker.py` (visualizador de VODs con Playwright y proxies): no se compila ni se empaqueta.
- El binario de **Tesseract** que usa el módulo 5 del pipeline (`pytesseract`): sigue siendo una dependencia del sistema. Sin él
  ese módulo no genera descripción visual. Pantalla Contexto no lo necesita: usa su propio OCR (tesseract.js).
