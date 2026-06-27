import type { Request, Response } from "express";
import { loginUser, registerUser, verifyToken } from "../services/auth-manager";
import { validate, LoginSchema, RegisterSchema, LoginInput, RegisterInput } from "../utils/validators";
import type { GenericResponse } from "../types/response";

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 24 * 60 * 60 * 1000,
  secure: process.env.NODE_ENV === "production",
};

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
    res.cookie("scb_jwt", result.token, COOKIE_OPTS);
    res.status(200).json({ success: true, token: result.token, expiresAt: result.expiresAt, tokenType: "Bearer" } as GenericResponse);
  } catch (err) {
    res.status(401).json({ error: "No autorizado", message: "Credenciales inválidas" });
  }
}

export async function handleMe(req: Request, res: Response) {
  const user = req.user!;
  res.json({ user: { id: Number(user.sub), username: user.username, role: user.role } });
}

export async function handleLogout(_req: Request, res: Response) {
  res.clearCookie("scb_jwt", { path: "/" });
  res.json({ success: true });
}

export async function handleSyncCookie(req: Request, res: Response) {
  const token = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;
  if (!token) {
    res.status(400).json({ error: "Token requerido" });
    return;
  }
  try {
    verifyToken(token);
    res.cookie("scb_jwt", token, COOKIE_OPTS);
    res.json({ success: true });
  } catch {
    res.status(401).json({ error: "Token inválido" });
  }
}
