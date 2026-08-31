# Módulo 1 — Captura de Video

## Estado
`[ ] No iniciado` `[ ] En progreso` `[ ] Funcionando` `[ ] Bloqueado`

## Objetivo
Capturar el video crudo de tu stream (tu pantalla/escritorio o la señal que sale hacia Kick) en clips cortos y continuos, sin interrupción, listos para que el Módulo 3 los use.

## Por qué está aislado
Si este módulo falla (por ejemplo, se cae `ffmpeg`, se satura el disco, la fuente de captura se desconecta), **no debe afectar** la captura de audio (Módulo 2) ni la transcripción. El sistema debe poder seguir generando contexto solo con audio si el video no está disponible.

## Input
- Fuente de captura local: pantalla completa, ventana específica, o salida de OBS (vía `obs-websocket` si se usa OBS Studio).
- Alternativa: si prefieres capturar desde el propio HLS de Kick (tu canal, autenticado), la fuente es el `playback_url` obtenido en el Módulo 6.

## Output
- Carpeta: `/data/raw_video/`
- Formato de archivo: clips de 10 segundos, nombrados con timestamp Unix: `video_1735300000.mp4`
- Codec recomendado: H.264, resolución reducida (720p es suficiente para análisis, no hace falta 1080p/4K — ahorra CPU y disco).

## Tecnología
- **Lenguaje:** Python 3.11 (script wrapper) + `ffmpeg` (motor real de captura)
- Comando base (ejemplo, captura de pantalla en Linux con `x11grab`; en Windows sería `gdigrab`, en Mac `avfoundation`):
  ```
  ffmpeg -f x11grab -video_size 1280x720 -i :0.0 \
    -c:v libx264 -preset ultrafast -f segment -segment_time 10 \
    -reset_timestamps 1 -strftime 1 /data/raw_video/video_%s.mp4
  ```

## Pasos internos
1. Verificar que la fuente de captura existe (pantalla, ventana u OBS activo).
2. Lanzar `ffmpeg` en modo segmentado (genera un archivo nuevo cada 10 seg automáticamente).
3. Escribir un `heartbeat` (archivo `/data/logs/modulo1_heartbeat.txt` con la hora actual) cada vez que se genera un clip nuevo — así el Orquestador (Módulo 10) sabe si este módulo sigue vivo.
4. Si `ffmpeg` se cae, reintentar automáticamente hasta 3 veces con espera de 5 seg entre intentos; si sigue fallando, escribir `ERROR` en el log y terminar (el Orquestador decide si reintenta desde cero).

## Manejo de errores
- Fuente de captura no encontrada → log claro + salir con código de error distinto de 0.
- Disco lleno → alertar en log, dejar de escribir, no crashear el proceso completo del sistema.

## Métrica de éxito
- Un clip nuevo cada ~10 segundos, sin huecos mayores a 15 segundos, de forma sostenida durante al menos 30 minutos de prueba.

## Checklist de implementación
- [ ] Elegir fuente de captura (pantalla directa vs. OBS vs. HLS de Kick)
- [ ] Script Python que lanza y supervisa el proceso ffmpeg
- [ ] Segmentación automática cada 10 seg funcionando
- [ ] Heartbeat escribiéndose correctamente
- [ ] Prueba de resiliencia: matar ffmpeg a mano y verificar que el script reintenta
