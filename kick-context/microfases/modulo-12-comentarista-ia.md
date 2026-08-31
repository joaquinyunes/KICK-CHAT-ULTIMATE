# Módulo 12 — Comentarista IA (chat simulado en el chat de Kick)

## Estado
`[ ] No iniciado` `[ ] En progreso` `[x] Código listo` `[ ] Funcionando` `[ ] Bloqueado`

## Objetivo
Simular una comunidad de chat entera y escribir esos mensajes en el chat de Kick, usando el "prompt maestro" (`prompt_chat.txt`) alimentado con el contexto real del stream (resúmenes del Módulo 8 + metadata del canal).

## Por qué está aislado
Solo lee `history.db` / `estado_canal.json` / `prompt_chat.txt` y escribe `comentarios/*.json` + `comentarios/cola.json`. Si Gemini o Kick fallan, reintenta con backoff. Apagable desde el Panel.

## Idea clave: 1 llamada → lote de N mensajes
En vez de 1 llamada por mensaje, se pide un **lote** (`KICK_COMENTARIO_LOTE`, default 30) en una sola llamada al LLM. Dos modos (`KICK_COMENTARIO_MODO`):

- **`bloque`** (default): 1 llamada cada `KICK_COMENTARIO_BLOQUE_SEG` (300 s = 5 min); vuelca el lote entero al TXT de una. Ideal si otro proyecto consume el TXT y maneja su propio ritmo.
- **`goteo`**: el lote va a una **cola** (`comentarios/cola.json`) y se suelta de a uno cada `KICK_COMENTARIO_INTERVALO_SEG` (30 s); cuando quedan `<= KICK_COMENTARIO_REGEN_UMBRAL` (4) se pide otro lote.

En ambos, ~1 llamada cada 5-15 min (esquiva los 503 del free tier).

## Input
- `prompt_chat.txt` — prompt maestro con marcadores `{{...}}` (repo: `src/modulo12_comentarista/prompt_chat.txt`, o copia del Panel en `<data>/prompt_chat/prompt_chat.txt`, o `KICK_PROMPT_CHAT_FILE`).
- Últimos 6 resúmenes vía `memoria_historica.obtener_ultimos_resumenes()`.
- `<data>/metadata/estado_canal.json` (Módulo 6) — en vivo + título + categoría.
- `<data>/nota_usuario/nota.txt` → `{{PROYECTO_ACTUAL}}`.
- `<data>/metadata/kick_token_state.json` (login_kick.py) — token con scope `chat:write`.

### Marcadores que rellena
`{{TEMA}}` (título/categoría), `{{CATEGORIA}}`, `{{CANTIDAD}}` (=LOTE), `{{CONTEXTO}}` (resúmenes unidos), `{{EVENTO}}` (último resumen), `{{MOMENTO}}`=EN_VIVO, `{{ENERGIA}}`=NORMAL, `{{HISTORIAL}}` (últimos 12 mensajes generados), `{{PROYECTO_ACTUAL}}` (nota). El resto (`{{CUOTAS_DISPONIBLES}}`, esports, fútbol…) se dejan vacíos y un barrido regex borra cualquier `{{XXX}}` sin rellenar.

> Nota: el prompt maestro trae secciones de datos deportivos/casino de ejemplo *hardcodeadas*; el modelo las usa como si fueran reales. Si querés que el chat reaccione más al gameplay real, hay que ajustar ese `.txt`.

## Output
- `<data>/comentarios/comentario_<ts>.json` — `{timestamp, comentario, publicado, modo_ensayo}` (uno por mensaje soltado).
- `<data>/comentarios/cola.json` — `{pendientes: [...], actualizado}`.
- **`<data>/comentarios/chat_feed.txt`** (o `KICK_COMENTARIO_TXT_OUT`) — se
  actualiza con cada mensaje soltado, últimas `KICK_COMENTARIO_TXT_MAX_LINEAS`
  (500) líneas, formato `plain` | `ts` (epoch\tmensaje) | `jsonl`. Para
  consumidores que hacen *tail*.
- **`<data>/comentarios/lotes/lote_<ts>.{txt,json}`** — cada lote generado,
  entero, escrito atómico (`.part` → rename). **Punto de integración
  recomendado con otro proyecto:** lee el `lote_*.json` más viejo
  (`{timestamp, mensajes: [...]}`), lo procesa y lo renombra a `.done` / lo
  borra. Ejemplo listo: `modulo12_comentarista/consumidor_ejemplo.py`.
- **Webhook** (`KICK_COMENTARIO_WEBHOOK`) — opcional; cada lote se manda por
  `POST` JSON `{timestamp, mensajes}` a esa URL.
- **Hook de comando** (`KICK_COMENTARIO_HOOK_CMD`) — opcional; tras escribir el
  lote se ejecuta ese comando con la ruta del `lote_<ts>.json` como último
  argumento (ej. `python C:\otro-proyecto\cargar.py`). Así el otro proyecto
  "se carga solo" sin watcher propio.

## Correr desatendido (sin la sesión de Claude)
`src/arrancar_desatendido.ps1` = watchdog: levanta el Panel + relanza el
Orquestador si se cae, con log en `<data>/logs/arrancar_desatendido.log`.
Registrar como Tarea Programada al iniciar sesión:
```
schtasks /Create /TN "KickContext" /SC ONLOGON /RL LIMITED /F /TR ^
  "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"<ruta>\src\arrancar_desatendido.ps1\""
```
Con eso: cada 5 min (modo bloque) se genera el lote, se escribe el TXT/lote y
—si está el hook— se dispara el otro proyecto. Todo solo.
- Si `KICK_COMENTARIO_POSTEAR=1`: `POST https://api.kick.com/public/v1/chat` con `{"content", "type": "bot"}`.
- Heartbeat en `<data>/logs/modulo12_comentarista_heartbeat.txt`.

## Pasos internos
1. Si hay prompt, el canal está en vivo y hay resúmenes.
2. Si `len(cola) <= UMBRAL`: rellenar el prompt, 1 llamada a Gemini (texto plano, `maxOutputTokens 4096`, temp 1.0), parsear por líneas (ignora `KICKCHAT…`, convierte `[EMOTE: X]` → `X`), filtrar repetidos textuales, encolar.
3. Sacar el primero de la cola. Si `POSTEAR=1`, publicarlo (refrescando el token si vence en <120 s). Guardar el JSON siempre.
4. Dormir `INTERVALO_SEG` ± jitter. Heartbeat durante la espera.

## Manejo de errores
- Gemini 429/500/503 → siguiente modelo; si todos fallan, backoff 1.7× hasta 300 s, la cola sigue drenando lo que tenga.
- Sin token / Kick >=400 → se loguea, el mensaje igual se guarda, `publicado=false`.
- `prompt_chat.txt` vacío o canal offline → no hace nada.

## Seguridad / control
- Default `KICK_COMENTARIO_POSTEAR=0` (modo ensayo): genera y guarda, no publica. El usuario decide activarlo.
- Anti-spam: drip 1/30 s con jitter, dedupe textual contra los últimos, recorte a 240 chars.
- Apagable desde el Panel (Módulo 11), que muestra el feed y el tamaño de la cola.

## Métrica de éxito
- Con `prompt_chat.txt` cargado y el stream en vivo: 1 llamada genera ~25-30 mensajes coherentes con el prompt y el contexto, que se sueltan al chat sin parecer un volcado.

## Checklist de implementación
- [x] Relleno de marcadores del prompt maestro con contexto real
- [x] 1 llamada → lote, parseo por líneas + limpieza de `[EMOTE]` / `KICKCHAT`
- [x] Cola en disco + drip con jitter + regeneración por umbral
- [x] Guardado por mensaje + dedupe
- [x] Posteo opcional a la API de Kick + refresh de token
- [x] Registro en Orquestador y Panel (toggle + feed + editor de prompt + contador de cola)
- [x] Probado local: generación de lote (1 llamada, 28 msgs) y E2E de drip en modo ensayo
- [ ] Prueba en vivo posteando de verdad (token con scope chat:write)
