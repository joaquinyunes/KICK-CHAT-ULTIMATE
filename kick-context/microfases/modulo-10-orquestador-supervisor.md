# Módulo 10 — Orquestador / Supervisor

## Estado
`[ ] No iniciado` `[ ] En progreso` `[ ] Funcionando` `[ ] Bloqueado`

## Objetivo
Vigilar que los 9 módulos anteriores estén vivos (mediante sus archivos de heartbeat), y reiniciar automáticamente solo el módulo que se cayó, sin tocar a los demás.

## Por qué está aislado
Es el único módulo que "sabe" que existen los demás, pero **no ejecuta la lógica de ninguno** — solo los lanza como procesos separados y los vigila desde afuera. Si el propio Orquestador se cae, los módulos ya lanzados siguen corriendo solos (no dependen de que el Orquestador siga vivo para seguir funcionando), aunque no habrá reinicio automático hasta que el Orquestador vuelva.

## Input
- `/data/logs/moduloX_heartbeat.txt` de cada uno de los 9 módulos

## Output
- `/data/logs/orquestador.log` — registro de qué módulo se reinició y cuándo
- Procesos vivos de los 9 módulos

## Tecnología
- **Opción simple:** Bash + `cron`/`systemd` (un servicio por módulo, cada uno con `Restart=on-failure`)
- **Opción con más control:** Python + `supervisord` (permite ver estado de todos los módulos en un solo dashboard de texto)

## Pasos internos
1. Lanzar los 9 módulos como procesos independientes al iniciar el stream.
2. Cada 15-30 seg, revisar el heartbeat de cada módulo:
   - Si el heartbeat no se actualizó en más de (tiempo esperado x 3), considerar el módulo "caído".
3. Si un módulo está caído, reiniciar **solo ese proceso**, dejando los demás intactos.
4. Registrar cada reinicio en `orquestador.log` con fecha/hora y módulo afectado.

## Manejo de errores
- Reinicios en bucle (un módulo se cae una y otra vez) → después de 5 reintentos en menos de 10 min, dejar de reintentar y marcarlo como `BLOQUEADO`, notificando claramente en el log en vez de consumir recursos en bucle infinito.

## Métrica de éxito
- Ante la caída simulada de cualquier módulo individual, el sistema lo reinicia en menos de 1 minuto sin afectar a los otros 8.

## Checklist de implementación
- [ ] Elegir mecanismo (systemd vs supervisord vs script Bash propio)
- [ ] Definir el "tiempo esperado" de heartbeat por módulo (no todos son iguales)
- [ ] Lógica de reinicio individual funcionando
- [ ] Prueba de caos: matar 2-3 módulos al azar durante una sesión y confirmar que el sistema se auto-recupera sin intervención manual
