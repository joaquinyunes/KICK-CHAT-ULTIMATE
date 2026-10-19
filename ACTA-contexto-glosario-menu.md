# Acta — Tribunal de ideas: contexto con IA gratis + glosario propio + menú viejo + Temáticas

Fecha: 2026-10-19

## Expediente

1. **Idea:** en StreamChat (chat simulado con IA para Kick): (a) volver al menú viejo completo (Chat, Temáticas, Video, Contexto, Simulador, Cuentas Kick, Ajustes, VODs) y sacar el tema kd de 3 pestañas, conservando landing y login; (b) generar el contexto del stream con Ollama o con una API gratuita (Gemini free tier) y pasárselo al Simulador, que escribe el chat usando un glosario de palabras que carga el usuario; (c) reorganizar para encontrar todo más rápido y mejorar Temáticas (más contenido, buscador, plantillas).
2. **Quién lo usa:** el dueño (streamer de casino/slots en Kick); otros streamers después. Segmento y pago: **no lo dijo**.
3. **Qué quiere lograr:** un chat con sus propias palabras que reaccione a lo que pasa; encontrar todo más rápido.
4. **Tiempo, dinero, precio:** un solo dev, API gratuita; precio **no lo dijo**.
5. **Estado:** el pipeline de contexto y el simulador ya existen. Gemini free dio 503/429 y 60–90 s por análisis. El acta anterior pidió contexto con on/off y fallback, URLs viejas vivas, envío intacto y latencia < 15 s.

## Alegatos

**Fiscal:** (1) Supuesto: la API gratuita aguanta un directo; con 503/429 y 60–90 s el contexto llega tarde o cae al fallback. (2) Volver a ~8 pestañas contradice «encontrar todo más rápido»: barra saturada y trabajo pagado dos veces. (3) Supuesto: el glosario a mano se mantiene; el streamer carga cuatro palabras y lo abandona.

**Defensa:** (1) Supuesto: la mitad ya está hecha; se entrega en pasos chicos. (2) Contexto opcional con on/off y fallback; si Gemini falla, el chat sigue con glosario y temáticas; Ollama de respaldo. (3) El dolor es concreto: glosario + contexto da reacciones con su jerga; el menú viejo ya es conocido.

## Votos

| # | Jurado | Voto | Razón | Cambiaría su voto si |
|---|---|---|---|---|
| 1 | El streamer ideal | INOCENTE | Quiero un chat que hable con mi jerga y reaccione a la pantalla, con menú conocido y fallback. | El glosario fuera tedioso o el contexto llegara siempre tarde. |
| 2 | La escéptica | CULPABLE | Ya prometieron «rápido de encontrar» y vuelven a 8 pestañas; el contexto gratis tarda y cae; el glosario manual se abandona. | Una prueba en vivo muestra contexto < 15 s con su jerga, sin caer al fallback. |
| 3 | La que no te conoce | CULPABLE | Mezcla tres cosas (menú, contexto con IA, temáticas); no se entiende qué es ni para quién. | Hubiera una frase clara: «chat que reacciona a tu stream, con tus palabras». |
| 4 | La contadora | CULPABLE | Dev único con API gratis inestable y glosario frágil; rehacer menú, contexto y Temáticas a la vez no cierra. | Se recorta a glosario + Temáticas, Ollama local como camino principal y se define quién paga. |
| 5 | La competencia | CULPABLE | Menú viejo, pipeline gratis y glosario manual se copian en días; el diferencial (contexto real) es lo más frágil. | Glosario y contexto se alimentaran solos con datos propios acumulados. |
| 6 | El que ya compró | INOCENTE | Glosario propio + contexto hace que suene a mi stream; recuperar el menú no quita nada; con on/off no rompe lo que uso. | El contexto llegara tarde o fallara sin aviso. |
| 7 | El que casi compra | INOCENTE | La traba es el chat genérico; glosario + contexto la atacan y el fallback evita que quede inutilizable. | El contexto llegara en más de 15 s o cayera al fallback casi siempre. |
| 8 | La experta del rubro | INOCENTE | Glosario en el prompt, menú y buscador son triviales; el contexto cambia lento, caché + fallback + Ollama alcanzan. | Ollama no corriera con visión en el equipo del streamer. |
| 9 | La vendedora | CULPABLE | No se explica en una frase y no hay respuesta a «¿y si la IA llega tarde?». | Una promesa de una frase con contexto < 15 s o fallback invisible. |
| 10 | La que lo ejecuta | CULPABLE | Menú, pipeline inestable, Ollama, glosario y Temáticas ampliadas son demasiado mantenimiento para una persona. | Entrega por fases, contexto apagado por defecto, un proveedor, tema de 3 pestañas conservado. |
| 11 | La del largo plazo | CULPABLE | Glosario manual y tier gratuito son moda de implementación; el menú de 8 es otro vaivén. | El glosario se alimentara solo (chat real o VODs) y el proveedor fuera estable. |
| 12 | La amiga honesta | CULPABLE | Cargar glosario a mano y sostener tres frentes se abandona en dos semanas. | El glosario se autogenerara desde el chat real y se entregara primero solo el contexto. |

## Marcador

INOCENTE 4 · CULPABLE 8 · total 12

## Veredicto: NO LA HAGAS ASÍ

**Lo que pesó en contra**
1. Latencia y cortes del tier gratuito (2, 7, 8, 9): contexto viejo o caído.
2. Glosario 100 % manual: se abandona (2, 5, 11, 12).
3. Tres frentes a la vez para un solo dev, y volver a 8 pestañas contradice «encontrar rápido» (4, 10, 12).

**Lo que pesó a favor**
1. El chat genérico es la traba real y glosario + contexto la atacan (1, 7).
2. Con on/off y fallback no se rompe lo que ya anda (6, 8).
3. Es técnicamente simple y casi todo ya existe (8).

**Condiciones (pasan a ser requisitos del plan)**
1. **Contexto opcional, apagado por defecto, con fallback invisible** y el estado a la vista (si el chat usó contexto o no). Un solo proveedor activo a la vez (Gemini gratis u Ollama).
2. **El glosario se llena casi solo:** importar desde el texto que ya hay (temáticas, chat pegado, VODs) con un botón, además de cargarlo a mano.
3. **Por fases y sin romper:** primero revertir el menú (el tema kd queda como opción, no se borra), después glosario + contexto, después Temáticas. Todo con una frase: «chat que reacciona a tu stream con tus palabras».

**Prueba real en 7 días**
Usalo en 3 directos con contexto activado y un glosario de 30 palabras. Anotá 20 momentos al azar: qué decía el contexto, qué pasaba de verdad y cuánto tardó.
- **Sí:** el contexto acierta en la mayoría y cae al fallback en menos de 1 de cada 5 tandas, y seguís usando el glosario al 7.º día.
- **No:** el contexto llega siempre tarde o vacío, o dejaste de tocar el glosario.

**Lo que el tribunal no sabía**
- Quién paga y cuánto (no lo dijo).
- Si el equipo del streamer corre Ollama con visión.

---
«Juicio en salas separadas: cada papel fue un agente independiente que no vio a los demás, pero todos son el mismo modelo base.»
«Este tribunal es una simulación: ordena los argumentos, no reemplaza probar la idea con personas reales.»
