# Plan — Analizador de pantalla + rediseño simple

Fecha: 2026-10-15. Alcance: todo **menos el envío de mensajes**
(`kick20.service`, `chat-sender.service`, `proxy-controller.sendToKick`,
`kc-sender.service`, posteo de M12) — eso no se toca.

## 0. Diagnóstico (lo que hay hoy)

- **El analizador ya existe a medias**: M1 captura (escritorio / ventana / OBS
  Virtual Cam / HLS remoto), M8 le manda frame + audio a Gemini y devuelve
  `resumen` + `fase`, M9 guarda historial. Funciona (ver HANDOFF).
- **Tres sistemas de "contexto"**: `stream-context/` (prototipo viejo, nadie lo
  importa), `kick-context/` (12 módulos), y el panel Flask M11 que duplica `/kc`.
- **12 procesos Python**, de los cuales 3 están apagados para siempre (M4 Whisper,
  M5 OCR, M7 timeline) y M10 orquesta archivos entre los demás.
- **5 lanzadores**: `start-all.bat`, `arrancar-todo.bat`, `iniciar.bat`,
  `kick-context/src/arrancar*.ps1`, `src/arrancar_desatendido.ps1`.
- **UI**: 8 pestañas de cliente + 5 páginas admin + panel Flask = 14 pantallas.

## 1. Analizador de pantalla (qué hace el streamer + contexto)

Se construye **sobre M8**, no de cero.

Salida nueva por ciclo (`summaries/<ts>.json`, mismo archivo de hoy, campos extra):

```json
{
  "ts": 1760000000,
  "fase": "slots",                       // ya existe
  "actividad": "Jugando Sugar Rush",      // qué hace, 1 línea
  "detalle": {"juego": "Sugar Rush", "apuesta": 1000, "balance": 109800},
  "evento": "Mega Win x4.8",             // qué CAMBIÓ vs el ciclo anterior, o null
  "contexto": "Viene 20 min en slots, perdió ~30% del balance, ahora remonta",
  "confianza": 0.8
}
```

Pasos:
1. **Schema estructurado** en el prompt de M8 (`responseSchema` de Gemini, igual
   que ya hace M12). `detalle` libre por fase; ejemplos por categoría reusando
   `modulo12_comentarista/prompts/categorias/*.txt`.
2. **Contexto narrativo**: pasarle a M8 los últimos 5 resúmenes de M9
   (`obtener_ultimos_resumenes`, ya existe) para que escriba `contexto` y
   `evento` comparando, en vez de describir cada frame aislado.
3. **Llamar a Gemini solo si la pantalla cambió**: diff barato entre el frame
   actual y el último analizado (miniatura 32×32 en gris, % de píxeles
   distintos, con ffmpeg que ya está). Si no cambió en N ciclos → solo
   "sigue igual". Baja los 503/429 del free tier y el costo.
4. **Exponer** el último análisis en `GET /api/kc/ahora` (servidor ya ingiere
   resúmenes en `kc-ingest.service`) para que el comentarista, el simulador y
   la UI lo lean de un solo lugar.

Criterio de listo: con un slot en pantalla, `/api/kc/ahora` devuelve juego,
apuesta y balance correctos en ≤ 2 ciclos, y un cambio de juego aparece en `evento`.

## 2. Pipeline más simple

| Hoy | Después |
|---|---|
| `stream-context/` | **Borrar** (no lo importa nadie) |
| M4, M5, M7 (apagados) | **Borrar** (si se quiere Whisper/OCR, vuelve por git) |
| M11 panel Flask | **Borrar**: `/kc` del servidor ya cubre estado, nota y botón "Analizar ahora" — *verificar paridad antes* |
| M1+M2+M3 (captura + buffer) | Quedan igual (andan, están probados en vivo) |
| M8+M9 | M9 pasa a ser una función que llama M8 al terminar (un proceso menos) |
| M10 orquestador | Queda; lo lanza `kc-supervisor` del servidor (ya es así) |
| M12 comentarista | Generación queda; **posteo no se toca** |
| 5 lanzadores | **1**: `arrancar-todo.bat` (Node levanta y supervisa Python). Borrar el resto |

Resultado: de 12 módulos a 6 (M1, M2, M3, M6, M8, M12) + orquestador.
El contrato por archivos en disco se mantiene (decisión de diseño del HANDOFF).

## 3. UI: de 14 pantallas a 3 pestañas

```
[ En vivo ]   [ Configurar ]   [ Admin ]*        * solo admin
```

- **En vivo** (pantalla principal, reemplaza Chat + Contexto):
  izquierda = analizador (actividad, fase, evento, contexto acumulado,
  botón "Analizar ahora", on/off del pipeline);
  derecha = chat (feed + caja de envío **tal cual está hoy**, solo se mueve
  de lugar) + feed del comentarista IA.
- **Configurar** (secciones colapsables en una página): Temáticas, Ajustes,
  Cuentas Kick, VODs, prompt del comentarista, nota para el resumen.
- **Admin** (una página con sub-secciones): Dashboard, Clientes, Bots, Proxies.
- **Simulador** y **Video**: hay una regla tuya de no tocarlos → quedan como
  páginas aparte, accesibles desde un link en "Configurar → Herramientas",
  sin cambios visuales. *(Decidir: ¿siguen fuera o se integran?)*

Implementación: `client-nav.js` → `NAV_ITEMS` pasa de 8 a 3; las páginas viejas
redirigen (`/chat` → `/envivo`, `/kc` → `/envivo`, `/tematicas` → `/configurar#tematicas`…)
para no romper links/bookmarks. Se reusan los JS existentes (`chat-ui.js`,
`kc-ui.js`, `ajustes-ui.js`, `vods-ui.js`) montándolos en secciones, sin reescribirlos.

## 4. Orden de trabajo

1. Borrados seguros: `stream-context/`, M4/M5/M7, lanzadores sobrantes. (1 commit)
2. Analizador: schema + contexto (pasos 1.1 y 1.2). Probar con stream real.
3. Diff de frames (1.3) + `/api/kc/ahora` (1.4).
4. Página **En vivo** (junta chat + kc) con redirects.
5. Página **Configurar** y **Admin** unificadas.
6. Borrar M11 Flask tras verificar que `/kc` cubre todo.
7. Actualizar `ARCHITECTURE.md` y `HANDOFF.md`.

## Riesgos

- Borrar M11 sin verificar paridad deja sin forma de editar `estado_deseado.json`.
- El schema estructurado alarga la respuesta de Gemini; medir latencia (hoy 60–90 s).
- Los redirects tienen que cubrir todas las URLs viejas o se rompen accesos directos.
