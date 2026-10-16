// Prompt del simulador de chat (es-AR) para la API (generateChat / autoGenerate).
// El texto vive en prompt-builder.ts (una sola fuente); acá solo se compone en modo "api":
// los datos viajan aparte en un JSON de entrada y {energia_desc} se reemplaza en runtime (una sola vez).
import { composePrompt, defaultOpciones } from "./prompt-builder";

const opciones = defaultOpciones();
opciones.modo = "api";
opciones.formato = "json"; // el parser de la API (parseLlmMessages) espera JSON
opciones.contenidos = ["casino", "deportes", "esports", "gaming", "programacion", "charla", "musica", "noticias"];
opciones.estilo.acentos = "regional";

export const SYSTEM_PROMPT = composePrompt({}, opciones);
