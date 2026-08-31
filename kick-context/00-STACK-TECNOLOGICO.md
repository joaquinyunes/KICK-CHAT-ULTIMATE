# Stack Tecnológico del Proyecto
**Proyecto:** Sistema de contexto en tiempo real para stream de Kick propio
**Principio rector:** cada módulo es un proceso independiente, con su propio lenguaje si conviene, que lee/escribe archivos o mensajes en disco. Si un módulo muere, los demás no se enteran y siguen funcionando.

---

## Tabla general

| # | Módulo | Lenguaje / Runtime | Librerías principales | Por qué esta elección |
|---|--------|--------------------|------------------------|------------------------|
| 1 | Captura de Video | Python 3.11 | `ffmpeg` (vía subprocess), `obs-websocket-py` (opcional) | ffmpeg es el estándar de facto, gratis, controlable por CLI |
| 2 | Captura de Audio | Python 3.11 | `ffmpeg`, `sounddevice` (opcional para mic directo) | Mismo motor que video, evita duplicar dependencias |
| 3 | Buffer Rotativo | Python 3.11 | `watchdog`, librería estándar (`os`, `pathlib`) | Tarea simple de manejo de archivos, no necesita nada pesado |
| 4 | Transcripción Audio→Texto | Python 3.11 | `faster-whisper` | Corre en CPU razonablemente rápido, gratis, sin API externa |
| 5 | Análisis Visual (frames) | Python 3.11 | `ffmpeg` (extracción de frames), `moondream` o `pytesseract` (OCR) | Modelos ligeros, corren local, no dependen de GPU cara |
| 6 | Metadata oficial de Kick | Python 3.11 | `requests` o `httpx`, OAuth 2.1 con PKCE | Uso de la API pública oficial (api.kick.com), evita zona gris de scraping |
| 7 | Unificación de Timeline | Python 3.11 | librería estándar (`json`, `sqlite3`) | Solo combina archivos JSON, no requiere librerías externas |
| 8 | Resumen con LLM | Python 3.11 | `ollama` (servidor local) + modelo `llama3.1` o `qwen2.5` | 100% local, sin costo por token, sin límite de uso |
| 9 | Memoria Histórica | Python 3.11 | `sqlite3` (incluido en Python) | Base de datos liviana, sin servidor, un solo archivo `.db` |
| 10 | Orquestador / Supervisor | Bash + Python | `supervisord` o scripts `.sh` con `systemd`/`cron` | Reinicia módulos caídos sin afectar a los demás |

**Nota:** todo el stack usa Python 3.11 como lenguaje común (para no complicar el proyecto con múltiples runtimes), excepto el orquestador, que es más simple en Bash. Si en el futuro un módulo necesita más rendimiento (ej. análisis visual con GPU), se puede migrar ese módulo puntual sin tocar el resto — esa es la ventaja de mantenerlos separados.

## Formato de intercambio entre módulos
Todos los módulos se comunican **solo mediante archivos en disco** (JSON o texto plano), nunca llamadas directas entre sí. Esto es clave para el aislamiento de fallos: un módulo nunca importa código de otro, solo lee/escribe en carpetas compartidas.

```
/data
  /raw_video/       <- clips de video crudo (módulo 1)
  /raw_audio/        <- clips de audio crudo (módulo 2)
  /buffer/           <- ventana rotativa de 2-3 min (módulo 3)
  /transcripts/      <- texto con timestamps (módulo 4)
  /visual_desc/      <- descripciones de frames (módulo 5)
  /metadata/         <- info del canal/stream (módulo 6)
  /timeline/          <- JSON unificado (módulo 7)
  /summaries/        <- resúmenes generados (módulo 8)
  /history.db        <- memoria histórica (módulo 9)
  /logs/             <- logs de cada módulo por separado
```

## Próximo paso
Revisar `01-ARQUITECTURA-GENERAL.md` para el flujo completo, y luego cada archivo en `/microfases/` para el detalle de implementación de cada módulo.
