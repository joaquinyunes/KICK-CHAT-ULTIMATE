export function mapKickError(status: number, body?: string): string {
  let msg = "";
  if (body) {
    try { const j = JSON.parse(body); msg = j.message || j.error || j.status?.message || ""; } catch { msg = body.substring(0, 100); }
  }
  if (status === 429) return msg || "Demasiadas peticiones. Espera un momento.";
  if (status === 422) return msg || "El mensaje fue rechazado por Kick.";
  if (status >= 500) return msg || "El servicio de chat no esta disponible.";
  if (status === 403) return msg || "No tienes permiso para enviar mensajes en este canal.";
  if (status === 404) return msg || "El canal especificado no existe.";
  return msg || "No se pudo enviar el mensaje.";
}
