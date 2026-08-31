# Módulo 7 — Unificación de Timeline

## Estado
`[ ] No iniciado` `[ ] En progreso` `[ ] Funcionando` `[ ] Bloqueado`

## Objetivo
Combinar transcripción de audio + descripción visual + metadata del canal en una sola línea de tiempo (timeline) ordenada por timestamp, cubriendo la ventana de los últimos 2-3 minutos.

## Por qué está aislado
Este módulo **debe tolerar campos faltantes**: si no hay datos visuales (Módulo 5 caído), simplemente arma el timeline solo con audio + metadata. Nunca debe fallar por falta de un input — su trabajo es ser tolerante y combinar lo que exista.

## Input
- `/data/transcripts/*.json` (Módulo 4)
- `/data/visual_desc/*.json` (Módulo 5, opcional)
- `/data/metadata/estado_canal.json` (Módulo 6, opcional)

## Output
- Carpeta: `/data/timeline/`
- Formato: un único archivo que se sobrescribe cada vez, `timeline_actual.json`, con la ventana de 2-3 min:
  ```json
  {
    "generado_en": 1735300010,
    "ventana_desde": 1735299820,
    "ventana_hasta": 1735300010,
    "eventos": [
      {
        "timestamp": 1735300000,
        "audio": "y bueno chicos ahora vamos a entrar a la siguiente sala",
        "video": "Pantalla de videojuego, nivel 3",
        "estado_canal": { "viewers": 152, "categoria": "Just Chatting" }
      }
    ]
  }
  ```

## Tecnología
- **Lenguaje:** Python 3.11
- Librería estándar: `json`, `glob`, `pathlib` — no requiere nada externo

## Pasos internos
1. Cada 10-15 seg, leer todos los JSON disponibles dentro de la ventana de tiempo vigente.
2. Ordenarlos por timestamp y fusionarlos en un solo evento por timestamp (si falta audio o video para ese timestamp, dejar el campo como `null`).
3. Sobrescribir `/data/timeline/timeline_actual.json` con el resultado.
4. Heartbeat en `/data/logs/modulo7_heartbeat.txt`.

## Manejo de errores
- JSON corrupto de algún módulo fuente → ignorarlo puntualmente, loguear, y seguir con el resto.
- Ningún dato disponible en la ventana → generar timeline vacío pero válido (no crashear).

## Métrica de éxito
- `timeline_actual.json` siempre representa fielmente los últimos 2-3 min, incluso si algún módulo fuente está caído.

## Checklist de implementación
- [ ] Lógica de fusión por timestamp funcionando
- [ ] Tolerancia a campos faltantes probada explícitamente
- [ ] Prueba: apagar Módulo 5 (visual) y confirmar que el timeline se sigue generando solo con audio
