# Módulo 6 — Metadata Oficial de Kick (API pública)

## Estado
`[ ] No iniciado` `[ ] En progreso` `[ ] Funcionando` `[ ] Bloqueado`

## Objetivo
Obtener datos oficiales de tu canal/stream (título, categoría, cantidad de viewers, si está en vivo o no, y opcionalmente el `playback_url` si se decide capturar video desde el HLS en vez de captura local) usando la API oficial de Kick, evitando cualquier zona gris de scraping.

## Por qué está aislado
Este módulo depende de internet y de la disponibilidad de la API de Kick — puede fallar por causas totalmente externas (caída del servicio, cambio de token). No debe afectar la captura local de audio/video, que no depende de la API para funcionar si ya tienes OBS o `ffmpeg` capturando tu pantalla directamente.

## Input
- Credenciales OAuth 2.1 (client_id, client_secret, flujo PKCE) registradas en el panel de desarrolladores de Kick para tu cuenta.

## Output
- Carpeta: `/data/metadata/`
- Formato: un JSON actualizado cada 30-60 seg, ej. `estado_canal.json`:
  ```json
  {
    "timestamp": 1735300000,
    "en_vivo": true,
    "titulo": "Jugando en vivo",
    "categoria": "Just Chatting",
    "viewers": 152
  }
  ```

## Tecnología
- **Lenguaje:** Python 3.11
- Librería: `requests` o `httpx` para llamadas HTTP
- Autenticación: OAuth 2.1 con PKCE contra `api.kick.com`

## Pasos internos
1. Autenticarse una vez (guardar el token de forma segura, renovarlo cuando expire).
2. Cada 30-60 seg, consultar el endpoint de estado del canal.
3. Guardar el JSON actualizado en `/data/metadata/estado_canal.json`.
4. Heartbeat en `/data/logs/modulo6_heartbeat.txt`.

## Manejo de errores
- Token expirado → reintentar autenticación automáticamente.
- Sin conexión a internet → loguear y reintentar cada 30 seg, sin bloquear ningún otro módulo (todos los demás módulos funcionan localmente, sin depender de este).

## Métrica de éxito
- `estado_canal.json` actualizado consistentemente cada 30-60 seg mientras haya internet.

## Checklist de implementación
- [ ] Registrar la app en el panel de desarrolladores de Kick y obtener client_id/secret
- [ ] Implementar flujo OAuth 2.1 con PKCE
- [ ] Script de polling periódico funcionando
- [ ] Prueba: cortar el internet a propósito y confirmar que el resto del sistema sigue funcionando sin este módulo
