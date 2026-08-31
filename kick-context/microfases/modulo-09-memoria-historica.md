# Módulo 9 — Memoria Histórica (SQLite)

## Estado
`[ ] No iniciado` `[ ] En progreso` `[ ] Funcionando` `[ ] Bloqueado`

## Objetivo
Guardar cada resumen generado (Módulo 8) de forma permanente durante la sesión de stream, para que el LLM tenga memoria de lo que ya ocurrió más allá de los últimos 2-3 min, y para poder consultar después "qué pasó en todo el stream de hoy".

## Por qué está aislado
Es solo una base de datos local — si falla (ej. archivo `.db` corrupto), el resumen en tiempo real (Módulo 8) puede seguir funcionando solo con el timeline actual, sin memoria de largo plazo, sin que el sistema completo se detenga.

## Input
- `/data/summaries/*.json` (Módulo 8)

## Output
- Archivo: `/data/history.db` (SQLite)
- Esquema de tabla:
  ```sql
  CREATE TABLE resumenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER,
    resumen_actual TEXT,
    tendencia_detectada TEXT
  );
  ```

## Tecnología
- **Lenguaje:** Python 3.11
- Librería: `sqlite3` (incluida en Python, sin instalación adicional)

## Pasos internos
1. Vigilar `/data/summaries/` por archivos nuevos no guardados aún.
2. Insertar cada resumen nuevo como una fila en la tabla `resumenes`.
3. Exponer una función simple de consulta (ej. "dame los últimos 5 resúmenes") que el Módulo 8 usa como contexto histórico.
4. Heartbeat en `/data/logs/modulo9_heartbeat.txt`.

## Manejo de errores
- Base de datos bloqueada (uso concurrente) → reintentar con pequeño delay, SQLite maneja bien escritura secuencial simple.
- Archivo `.db` corrupto → mover el archivo dañado a `/data/history_corrupto_<fecha>.db` y crear uno nuevo vacío, sin detener el sistema.

## Métrica de éxito
- Cada resumen generado por el Módulo 8 queda guardado en la base en menos de 5 seg, sin pérdida de datos durante una sesión de varias horas.

## Checklist de implementación
- [ ] Crear el esquema de la base de datos
- [ ] Script de inserción automática funcionando
- [ ] Función de consulta de "últimos N resúmenes" para que la use el Módulo 8
- [ ] Prueba: correr una sesión larga (1-2 horas) y verificar integridad de los datos guardados
