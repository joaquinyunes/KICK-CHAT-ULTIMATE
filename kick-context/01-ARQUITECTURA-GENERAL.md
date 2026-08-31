# Arquitectura General del Proyecto

## Objetivo del sistema
Capturar en tiempo real el stream propio en Kick (video + audio), mantener una ventana de contexto de los últimos 2-3 minutos, transcribir y describir lo que ocurre, y generar resúmenes/contexto acumulativo mediante un LLM local, con el menor costo posible (idealmente $0).

## Principio de diseño no negociable: aislamiento de fallos
Cada módulo:
- Es un **proceso independiente** (su propio script, su propio ciclo de vida).
- **Nunca importa código de otro módulo.**
- Se comunica **solo por archivos** en carpetas compartidas (`/data/...`).
- Si un módulo se cae, escribe su error en su propio log y se detiene; **el resto sigue funcionando**.
- Cada módulo tiene un script de "salud" (`healthcheck`) simple que dice si está vivo o muerto.

Ejemplo concreto del comportamiento esperado: si el módulo de Análisis Visual se rompe (por ejemplo, el modelo de OCR falla), el módulo de Transcripción de Audio sigue transcribiendo, el buffer rotativo sigue actualizándose, y el LLM de resumen simplemente genera su resumen solo con audio, marcando en el JSON que "video: no disponible".

## Flujo de datos (de principio a fin)

```
[Kick - tu stream en vivo]
        |
        ├──> Módulo 1: Captura de Video ──> /data/raw_video/
        |
        └──> Módulo 2: Captura de Audio ──> /data/raw_audio/

/data/raw_video/ + /data/raw_audio/
        |
        v
Módulo 3: Buffer Rotativo (mantiene solo últimos 2-3 min) ──> /data/buffer/

/data/buffer/ (audio)              /data/buffer/ (video)
        |                                  |
        v                                  v
Módulo 4: Transcripción          Módulo 5: Análisis Visual
   (Whisper)                        (frames + OCR/descripción)
        |                                  |
        v                                  v
/data/transcripts/                /data/visual_desc/

Módulo 6: Metadata Kick (API oficial) ──> /data/metadata/

/data/transcripts/ + /data/visual_desc/ + /data/metadata/
        |
        v
Módulo 7: Unificación de Timeline ──> /data/timeline/ (JSON con todo, por timestamp)
        |
        v
Módulo 8: Resumen con LLM (Ollama) ──> /data/summaries/
        |
        v
Módulo 9: Memoria Histórica (SQLite) ──> /data/history.db

Módulo 10: Orquestador/Supervisor
   (vigila que 1-9 estén vivos, reinicia el que se caiga, no toca a los demás)
```

## Fases del proyecto (macro)

| Fase | Nombre | Contiene módulos |
|------|--------|-------------------|
| Fase A | Captura cruda | Módulo 1, Módulo 2 |
| Fase B | Ventana de contexto | Módulo 3 |
| Fase C | Interpretación de contenido | Módulo 4, Módulo 5, Módulo 6 |
| Fase D | Unificación e inteligencia | Módulo 7, Módulo 8, Módulo 9 |
| Fase E | Resiliencia del sistema | Módulo 10 |

**Orden recomendado de construcción:** A → B → C (audio primero, luego visual) → D → E.
Se recomienda este orden porque cada fase entrega algo funcional por sí sola: tras la Fase C con solo audio ya tendrías transcripción en vivo útil, sin depender de que el módulo visual esté terminado.

## Documentos de esta carpeta

- `00-STACK-TECNOLOGICO.md` — qué lenguaje/librería usa cada módulo.
- `01-ARQUITECTURA-GENERAL.md` — este archivo.
- `/microfases/modulo-XX-*.md` — un archivo detallado por cada módulo (10 en total).
- `HANDOFF.md` — documento vivo que se actualiza en cada sesión de trabajo con el estado real de avance.
