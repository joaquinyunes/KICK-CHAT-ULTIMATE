// utils/validators.ts - Schemas Zod para validacion de entrada
/**
 * utils/validators.ts
 * Schemas Zod para validar todos los cuerpos de petición entrantes.
 * El servidor rechaza cualquier payload que no cumpla el contrato.
 */

import { z } from "zod";

// ─── Auth ──────────────────────────────────────────────────────────────────────

export const LoginSchema = z.object({
  username: z
    .string()
    .min(3, "El username debe tener al menos 3 caracteres")
    .max(32, "El username no puede superar 32 caracteres")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "El username solo puede contener letras, números y guiones bajos"
    ),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres")
    .max(128, "La contraseña no puede superar 128 caracteres"),
});

export const RegisterSchema = LoginSchema.extend({
  // Si en el futuro se agrega registro público, extender aquí
});

// ─── Chat ──────────────────────────────────────────────────────────────────────

export const ChatSendSchema = z.object({
  /** Canal de Kick al que va el mensaje */
  channel: z
    .string()
    .min(1, "El campo 'channel' es requerido")
    .max(64, "El nombre del canal no puede superar 64 caracteres")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "El canal solo puede contener letras, números y guiones bajos"
    ),

  /** Texto del mensaje a enviar */
  message: z
    .string()
    .min(1, "El mensaje no puede estar vacío")
    .max(500, "El mensaje no puede superar 500 caracteres"),
});

// ─── Tipos inferidos ───────────────────────────────────────────────────────────

export type LoginInput    = z.infer<typeof LoginSchema>;
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type ChatSendInput = z.infer<typeof ChatSendSchema>;

// ─── Helper genérico para validar y retornar errores formateados ───────────────

export function validate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: Record<string, string[]> } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.flatten().fieldErrors as Record<string, string[]>,
  };
}