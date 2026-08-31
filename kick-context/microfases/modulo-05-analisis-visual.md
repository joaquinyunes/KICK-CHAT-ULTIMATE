# Módulo 5 — Análisis Visual (frames del video)

## Estado
`[ ] No iniciado` `[ ] En progreso` `[ ] Funcionando` `[ ] Bloqueado`

## Objetivo
Extraer y describir lo que se ve en pantalla durante el stream: texto visible (OCR) y/o descripción general de la escena.

## Por qué está aislado
Es el módulo más pesado en cómputo y el más propenso a fallar (modelos de visión son más frágiles que Whisper). Debe poder caerse sin afectar transcripción de audio ni el resto del pipeline. El sistema debe seguir funcionando "a ciegas" visualmente si este módulo no responde.

## Input
- `/data/buffer/video/` (clips de 10 seg en MP4)

## Output
- Carpeta: `/data/visual_desc/`
- Formato: un JSON por clip, ej. `visual_1735300000.json`:
  ```json
  {
    "timestamp_inicio": 1735300000,
    "timestamp_fin": 1735300010,
    "texto_en_pantalla": "NIVEL 3 - 250 PUNTOS",
    "descripcion_escena": "Pantalla de videojuego de plataformas, personaje saltando entre bloques"
  }
  ```

## Tecnología
- **Lenguaje:** Python 3.11
- `ffmpeg` para extraer 1 frame cada 3-5 segundos de cada clip
- Para texto en pantalla: `pytesseract` (OCR, muy liviano, ideal si solo necesitas leer texto/overlays)
- Para descripción de escena (opcional, más pesado): `moondream` (modelo de visión pequeño, corre local)
- **Recomendación:** empezar solo con OCR (mucho más rápido y liviano); agregar el modelo de descripción de escena como una segunda etapa si el OCR no es suficiente.

## Pasos internos
1. Vigilar `/data/buffer/video/` en busca de clips nuevos.
2. Extraer 1-2 frames representativos del clip con `ffmpeg`.
3. Pasar el/los frame(s) por OCR (y opcionalmente por el modelo de descripción).
4. Guardar resultado como JSON en `/data/visual_desc/`.
5. Heartbeat en `/data/logs/modulo5_heartbeat.txt`.

## Manejo de errores
- Frame ilegible o pantalla negra → registrar `"texto_en_pantalla": null` y seguir, nunca detener el módulo completo.
- Si el modelo de visión no carga (falta de RAM/GPU) → el módulo debe poder arrancar en "modo solo OCR" como fallback automático.

## Métrica de éxito
- Al menos un frame descrito por cada clip de video, con tiempo de procesamiento menor a 10 seg por clip.

## Checklist de implementación
- [ ] Extracción de frames con ffmpeg funcionando
- [ ] OCR básico funcionando sobre un frame de prueba
- [ ] (Opcional) Modelo de descripción de escena integrado
- [ ] Prueba de resiliencia: detener este módulo a mitad de stream y confirmar que audio y timeline siguen funcionando sin video
