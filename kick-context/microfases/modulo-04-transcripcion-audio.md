# Módulo 4 — Transcripción de Audio (Whisper)

## Estado
`[ ] No iniciado` `[ ] En progreso` `[ ] Funcionando` `[ ] Bloqueado`

## Objetivo
Convertir cada clip de audio del buffer en texto, con timestamp, para saber qué se dijo y cuándo.

## Por qué está aislado
Es el módulo que más valor aporta por sí solo — si el video y el análisis visual fallan por completo, este módulo sigue generando contexto útil (lo que se está diciendo en el stream). No depende de ningún otro módulo salvo leer archivos de `/data/buffer/audio/`.

## Input
- `/data/buffer/audio/` (clips de 10 seg en WAV/MP3)

## Output
- Carpeta: `/data/transcripts/`
- Formato: un archivo JSON por clip procesado, ej. `transcript_1735300000.json`:
  ```json
  {
    "timestamp_inicio": 1735300000,
    "timestamp_fin": 1735300010,
    "texto": "y bueno chicos ahora vamos a entrar a la siguiente sala del juego",
    "idioma_detectado": "es",
    "confianza": 0.87
  }
  ```

## Tecnología
- **Lenguaje:** Python 3.11
- Librería: `faster-whisper` (versión optimizada de Whisper, corre bien en CPU)
- Modelo recomendado para empezar: `small` o `base` (balance velocidad/precisión en CPU). Si tienes GPU, se puede subir a `medium`.

## Pasos internos
1. Vigilar `/data/buffer/audio/` en busca de clips no procesados aún.
2. Por cada clip nuevo, correr `faster-whisper` y guardar el resultado como JSON en `/data/transcripts/`.
3. Llevar un registro simple (archivo `.txt` o tabla en SQLite) de qué clips ya se procesaron, para no repetir trabajo.
4. Heartbeat en `/data/logs/modulo4_heartbeat.txt`.

## Manejo de errores
- Clip corrupto o vacío → loguear y saltar al siguiente, nunca detener el proceso completo.
- Si el modelo tarda más de lo que dura el clip (ej. 10 seg de audio tardan 15 seg en transcribirse), loguear advertencia de "atraso" — esto indica que hay que bajar el tamaño del modelo Whisper.

## Métrica de éxito
- Cada clip de 10 seg se transcribe en menos de 10 seg (para no acumular atraso), con texto coherente en español.

## Checklist de implementación
- [ ] Instalar `faster-whisper` y probar con un audio de muestra
- [ ] Elegir tamaño de modelo según tu hardware (medir tiempo real de transcripción)
- [ ] Script de vigilancia de carpeta + procesamiento automático
- [ ] Prueba de resiliencia: meter un archivo de audio corrupto a propósito y confirmar que el módulo sigue vivo
