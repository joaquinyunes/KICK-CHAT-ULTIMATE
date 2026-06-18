import type { Request, Response } from "express";
import { loginUser, registerUser } from "../services/auth-manager";
import { validate, LoginSchema, RegisterSchema, LoginInput, RegisterInput } from "../utils/validators";
import type { GenericResponse } from "../types/response";

export async function handleRegister(req: Request, res: Response) {
  const v = validate(RegisterSchema, req.body);
  if (!v.success) {
    return res.status(400).json({ success: false, error: "Datos inválidos", fields: (v as any).errors } as GenericResponse);
  }
  try {
    const data = v.data as RegisterInput;
    const user = await registerUser(data.username, data.password);
    res.status(201).json({ success: true, message: "Usuario registrado", username: user.username } as GenericResponse);
  } catch (err) {
    res.status(500).json({ error: "Error interno" });
  }
}

export async function handleLogin(req: Request, res: Response) {
  const v = validate(LoginSchema, req.body);
  if (!v.success) {
    return res.status(400).json({ success: false, error: "Datos inválidos", fields: (v as any).errors } as GenericResponse);
  }
  try {
    const data = v.data as LoginInput;
    const result = await loginUser(data.username, data.password, req.ip);
    res.status(200).json({ success: true, token: result.token, expiresAt: result.expiresAt, tokenType: "Bearer" } as GenericResponse);
  } catch (err) {
    res.status(401).json({ error: "No autorizado", message: "Credenciales inválidas" });
  }
}
