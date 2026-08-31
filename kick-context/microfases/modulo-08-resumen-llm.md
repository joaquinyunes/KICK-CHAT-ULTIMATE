# Módulo 8 — Resumen con LLM (Ollama local)

## Estado
`[ ] No iniciado` `[ ] En progreso` `[ ] Funcionando` `[ ] Bloqueado`

## Objetivo
Tomar el `timeline_actual.json` (últimos 2-3 min) más el resumen histórico reciente (Módulo 9) y generar un resumen en lenguaje natural de: qué está pasando ahora, qué pasó antes, y una lectura de tendencia (no predicción exacta) de hacia dónde va el stream.

## Por qué está aislado
Depende de que Ollama esté corriendo como servicio local — si se cae, el timeline y las transcripciones siguen generándose normalmente, solo no habrá resumen en lenguaje natural hasta que este módulo se recupere. Es una capa de "inteligencia" encima de datos que ya existen de forma independiente.

## Input
- `/data/timeline/timeline_actual.json` (Módulo 7)
- Últimos 3-5 resúmenes guardados en `/data/history.db` (Módulo 9), como contexto de "lo que pasó antes"

## Output
- Carpeta: `/data/summaries/`
- Formato: `resumen_1735300010.json`:
  ```json
  {
    "timestamp": 1735300010,
    "resumen_actual": "El streamer está jugando un nivel de plataformas, comentando la dificultad del nivel 3.",
    "contexto_previo": "En los minutos anteriores se habló de configuración del setup.",
    "tendencia_detectada": "Lleva 10 min en el mismo juego, probable que continúe con el siguiente nivel."
  }
  ```

## Tecnología
- **Lenguaje:** Python 3.11
- Servidor: `Ollama` corriendo local (`ollama serve`)
- Modelo sugerido: `llama3.1:8b` o `qwen2.5:7b` (buen balance para CPU/GPU modesta)
- Comunicación: llamada HTTP local a `http://localhost:11434/api/generate`

## Pasos internos
1. Cada vez que el timeline se actualiza (evento o cada 15-20 seg), armar un prompt con: timeline actual + últimos resúmenes históricos.
2. Enviar el prompt a Ollama.
3. Guardar la respuesta como JSON en `/data/summaries/`.
4. Heartbeat en `/data/logs/modulo8_heartbeat.txt`.

## Manejo de errores
- Ollama no responde → reintentar con backoff (esperar más tiempo entre cada intento), y mientras tanto seguir usando el último resumen válido guardado.
- Respuesta del modelo mal formada (no es JSON válido) → descartar esa respuesta puntual, loguear, reintentar en el siguiente ciclo.

## Métrica de éxito
- Un resumen nuevo cada 15-20 seg, coherente con el timeline, generado en menos de 10 seg de latencia.

## Checklist de implementación
- [ ] Instalar y correr Ollama localmente
- [ ] Descargar el modelo elegido (`ollama pull llama3.1:8b`)
- [ ] Diseñar el prompt (plantilla fija con variables de timeline + histórico)
- [ ] Prueba: apagar Ollama a mitad de sesión y confirmar que el resto del sistema no se cae
