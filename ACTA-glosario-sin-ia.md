# Acta — Tribunal de ideas: StreamChat sin IA (glosario de 10k–20k + contexto por reglas)

Fecha: 2026-10-19

## Expediente

1. **Idea:** StreamChat pasa a funcionar sin IA ni APIs de pago: (a) glosario propio de 10.000–20.000 palabras/frases que el usuario carga (pegar o .txt/.csv, una por línea, opcional «categoria|texto»), guardado en el navegador, con buscador; (b) el contexto se resuelve con reglas: botones de situación (pendiente, pagó, no pagó, bonus, premio grande, pausa…) y/o texto pegado con un detector por palabras clave; (c) las plantillas de Temáticas se mezclan con ese glosario; (d) el Simulador usa el glosario sin llamar a ningún modelo.
2. **Quién lo usa:** el dueño (streamer de casino/slots en Kick). Otros: **no lo dijo**.
3. **Qué quiere:** gastar cero, chat con sus palabras, todo en la página.
4. **Tiempo, dinero, precio:** un solo dev, cero APIs; precio **no lo dijo**.
5. **Estado:** Temáticas ya envía hilos (11 secciones, buscador). Las palabras del usuario aún no existen en este repo y **no dijo cómo las tiene** (sueltas o frases, con o sin categorías).

## Alegatos

**Fiscal:** (1) el detector por palabras clave no entiende nada y el streamer tendría que tocar botones jugando; el chat queda desfasado. (2) Supuesto: las 10–20k palabras no existen ni tienen formato; sin categorías no hay de dónde llenar. (3) Rellenar huecos al azar rompe género/número y repite patrones; sin IA se pierde la variedad.

**Defensa:** (1) Es una capa sobre algo que ya funciona (Temáticas, glosario básico). (2) Costo cero y control total: sin cuota que se corte en pleno stream. (3) Supuesto: el chat de casino es repetitivo y vive de jerga; botones y palabras clave alcanzan.

## Votos

| # | Jurado | Voto | Razón | Cambiaría su voto si |
|---|---|---|---|---|
| 1 | El streamer ideal | INOCENTE | Gasto cero, mi jerga y salida predecible; el chat de casino es repetitivo, así que reglas más botones alcanzan. | Cambiar el contexto exigiera varios clics en pleno juego o el chat quedara desfasado. |
| 2 | La escéptica | CULPABLE | Las 10–20k palabras no existen ni tienen formato; la variedad depende de datos que nadie demostró tener. | Muestra un archivo real con cientos de sus palabras y un hilo de prueba natural. |
| 3 | La que no te conoce | CULPABLE | Sin contexto no se entiende qué es ni para quién: glosario, plantillas y detectores son jerga. | Hubiera una frase de una línea con qué es, para quién y qué logra. |
| 4 | La contadora | INOCENTE | Costo operativo cero, todo en el navegador, extiende lo existente; el riesgo es el tiempo del streamer. | No tuviera las palabras y cargarlas a mano llevara más de unos días. |
| 5 | La competencia | CULPABLE | Glosario + plantillas con huecos es trivial de replicar; el único foso son sus palabras. | Su glosario y plantillas fueran un activo exclusivo que otros no igualan. |
| 6 | El que ya compró | CULPABLE | Cambiar IA y contexto automático por botones manuales y huecos al azar suma carga y empeora variedad. | Fuera un modo opcional que conserve la IA y el contexto automático. |
| 7 | El que casi compra | CULPABLE | Mi traba es la calidad (que parezca humano y varíe); huecos al azar y botones a mitad de stream la empeoran. | Muestra de chat sin repeticiones ni errores de género y contexto que cambia solo. |
| 8 | La experta del rubro | INOCENTE | Es trivial y fiable: 20k líneas caben en el navegador, botones + palabras clave bastan; el género se resuelve en las plantillas. | El glosario llegara sin categorías y exigiera detección automática sin botones. |
| 9 | La vendedora | INOCENTE | Se explica en una frase («chat de casino con tus palabras, gratis, todo en la página»); «sin cuota que se corte» responde a la objeción. | El chat desfasado o los botones jugando fueran la objeción sin respuesta. |
| 10 | La que lo ejecuta | CULPABLE | Un solo dev curando 10–20k palabras sin formato, botones y género/número de huecos: demasiado mantenimiento. | El usuario entregue el glosario categorizado y se lance primero un mínimo sin tocar el flujo actual. |
| 11 | La del largo plazo | INOCENTE | El glosario y las reglas no dependen de proveedores ni precios; es un activo propio. | El glosario se vuelva repetitivo y Kick o el público detecten el patrón. |
| 12 | La amiga honesta | CULPABLE | Cargar y categorizar 10–20k palabras y tocar botones en pleno stream se abandona en semanas. | Ya tuviera las palabras categorizadas y el contexto se detectara solo. |

## Marcador

INOCENTE 5 · CULPABLE 7 · total 12

## Veredicto: REHAZLA antes de invertirle

**Lo que pesó en contra**
1. Las palabras no existen aún ni tienen formato; sin categorías la mezcla no tiene criterio (2, 8, 10, 12).
2. Botones manuales a mitad de stream: el contexto se desfasa o estorba (1, 7, 12).
3. Perder la variedad y la coherencia de la IA con huecos al azar (5, 6, 7).

**Lo que pesó a favor**
1. Costo cero y control total, sin cuotas que se corten en vivo (1, 4, 9).
2. Técnicamente simple: cabe en el navegador y extiende lo que ya existe (4, 8).
3. Es un activo propio que no depende de proveedores (11).

**Condiciones (pasan a ser requisitos)**
1. **Formato flexible desde el día uno:** una línea = una palabra o frase, con categoría opcional (`cat|texto`) y significado opcional (`texto = significado`); sin categorías se filtra por palabras clave.
2. **Cambiar el contexto en un toque:** teclas rápidas + un cuadro donde pegás lo que pasa y el detector elige la situación; nada obligatorio.
3. **Mínimo primero y sin romper:** el glosario entra como una sección más de Temáticas y una página propia; las plantillas y el envío actuales quedan intactos. La IA queda apagada (opcional), no se borra.
4. **Probarlo con datos reales:** muestra de chat con tus palabras y sin repeticiones antes de darlo por bueno.

**Prueba real en 7 días**
Cargá tus palabras, usalo en 3 directos y anotá 20 momentos al azar: qué situación marcaste, qué salió y si sonó fuera de lugar.
- **Sí:** menos de 4 de 20 salen fuera de lugar, tocás la situación menos de una vez cada 10 minutos y seguís usando el glosario al día 7.
- **No:** el chat sale desfasado seguido o dejás de tocar el glosario.

**Lo que el tribunal no sabía**
- Cómo están organizadas las palabras del usuario (sueltas/frases, con o sin categorías).
- Quién paga y cuánto (no lo dijo).

---
«Juicio en salas separadas: cada papel fue un agente independiente que no vio a los demás, pero todos son el mismo modelo base.»
«Este tribunal es una simulación: ordena los argumentos, no reemplaza probar la idea con personas reales.»
