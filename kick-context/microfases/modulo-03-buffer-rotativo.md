# Módulo 3 — Buffer Rotativo (ventana de 2-3 minutos)

## Estado
`[ ] No iniciado` `[ ] En progreso` `[ ] Funcionando` `[ ] Bloqueado`

## Objetivo
Mantener siempre disponible solo la ventana de los últimos 2-3 minutos de audio y video, borrando automáticamente lo que ya pasó ese límite, para no acumular disco infinito ni datos viejos innecesarios.

## Por qué está aislado
Este módulo **no captura nada**, solo administra archivos. Si falla, el peor caso es que el disco crezca más de lo esperado (no se pierde nada crítico) — no interrumpe la captura de audio/video ni la transcripción, que leen directo de `/data/raw_audio/` y `/data/raw_video/` si el buffer no está actualizado.

## Input
- `/data/raw_video/` (clips del Módulo 1)
- `/data/raw_audio/` (clips del Módulo 2)

## Output
- `/data/buffer/video/` — symlinks o copias de los últimos N clips de video (por defecto: últimos 18 clips de 10 seg = 3 min)
- `/data/buffer/audio/` — mismo criterio para audio

## Tecnología
- **Lenguaje:** Python 3.11
- Librería: `watchdog` (para detectar archivos nuevos automáticamente) o simplemente un bucle con `time.sleep(5)` que revisa la carpeta cada 5 segundos.

## Pasos internos
1. Cada 5 segundos, listar archivos en `/data/raw_video/` y `/data/raw_audio/` ordenados por timestamp.
2. Mantener solo los últimos N archivos (configurable, default = ventana de 3 min) en `/data/buffer/`.
3. Borrar de `/data/raw_video/` y `/data/raw_audio/` los archivos más antiguos que, por ejemplo, 10 minutos (para no acumular disco indefinidamente, dejando margen extra sobre la ventana de contexto).
4. Heartbeat en `/data/logs/modulo3_heartbeat.txt`.

## Manejo de errores
- Si no hay archivos nuevos de video pero sí de audio (o viceversa), seguir funcionando normal con lo que haya — no es un error, es el escenario de fallback esperado.

## Métrica de éxito
- La carpeta `/data/buffer/` nunca contiene más de N archivos por tipo, y siempre refleja los últimos 2-3 minutos reales.

## Checklist de implementación
- [ ] Definir tamaño exacto de la ventana (recomendado: empezar con 3 min, ajustable después)
- [ ] Script de limpieza automática funcionando
- [ ] Prueba: detener el Módulo 1 (video) y confirmar que el buffer de audio sigue rotando normal
- [ ] Prueba de disco: dejar correr 1 hora y confirmar que `/data/raw_*` no crece sin control
