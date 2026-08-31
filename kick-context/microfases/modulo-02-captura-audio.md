# Módulo 2 — Captura de Audio

## Estado
`[ ] No iniciado` `[ ] En progreso` `[ ] Funcionando` `[ ] Bloqueado`

## Objetivo
Capturar el audio crudo de tu stream (micrófono + audio de escritorio/juego si aplica) en clips cortos y continuos.

## Por qué está aislado
Es el módulo **más crítico para el fallback**: si el video falla, todo el sistema debe poder seguir funcionando solo con este módulo. Por eso va completamente separado del Módulo 1, con su propio proceso `ffmpeg`, su propia carpeta de salida y su propio log.

## Input
- Dispositivo de audio: micrófono (input) y/o audio del sistema (loopback/monitor, para capturar lo que suena en el juego/aplicación).

## Output
- Carpeta: `/data/raw_audio/`
- Formato: clips de 10 segundos, WAV o MP3, nombrados por timestamp: `audio_1735300000.wav`

## Tecnología
- **Lenguaje:** Python 3.11 (wrapper) + `ffmpeg`
- Comando base (ejemplo Linux con PulseAudio):
  ```
  ffmpeg -f pulse -i default \
    -f segment -segment_time 10 -strftime 1 \
    /data/raw_audio/audio_%s.wav
  ```
  (En Windows: `-f dshow -i audio="nombre del dispositivo"`. En Mac: `-f avfoundation`.)

## Pasos internos
1. Detectar dispositivo(s) de audio disponibles.
2. Lanzar `ffmpeg` en modo segmentado, igual que el Módulo 1 pero solo audio.
3. Heartbeat en `/data/logs/modulo2_heartbeat.txt`.
4. Reintentos automáticos ante caída, igual lógica que Módulo 1.

## Manejo de errores
- Dispositivo de audio no detectado → log claro, el módulo no arranca, pero no bloquea a los demás.
- Silencio prolongado (posible micrófono muteado) → no es un error técnico, pero se puede loguear como advertencia para que lo notes.

## Métrica de éxito
- Clips de audio continuos sin huecos, con volumen (RMS) distinto de cero en la mayoría de los clips (para detectar si el micro está muteado por accidente).

## Checklist de implementación
- [ ] Identificar el/los dispositivo(s) de audio correctos (mic + sistema si aplica)
- [ ] Script de captura segmentada funcionando
- [ ] Heartbeat funcionando
- [ ] Prueba: silenciar el micrófono y confirmar que el sistema lo detecta como advertencia, no como caída
