# Deploy en un VPS (paso a paso)

Objetivo: dejar el servidor corriendo 24/7 en un VPS, con HTTPS, el panel
`/admin` accesible desde cualquier lado y el visor de VODs funcionando con tus
proxies.

Todo corre en Docker. No hace falta instalar Node ni Python en el VPS: la
imagen ya trae Node 20 + Python + Playwright + Chromium.

---

## 0. Qué vas a necesitar

- Tarjeta para pagar el VPS (~4-6 USD/mes).
- Los datos de tu app de Kick (`KICK_CLIENT_ID` / `KICK_CLIENT_SECRET`) de
  https://dev.kick.com.
- Tu lista de proxies (host, puerto, usuario, contraseña).
- Tus bearer tokens de Kick (los cargás después desde el panel).

---

## 1. Comprar el VPS

Recomendado: **Hetzner Cloud**, plan **CX22** (2 vCPU, 4 GB RAM, 40 GB) —
alcanza para el server + varios Chromium de VODs en paralelo. Contabo o
DigitalOcean también sirven; **mínimo 4 GB de RAM** (cada visor de VOD abre un
Chromium real y come 300-500 MB).

1. Creá la cuenta en https://console.hetzner.cloud
2. New Project → Add Server
3. Location: la más cercana a vos. Image: **Ubuntu 24.04**.
4. Type: **CX22**.
5. En "SSH keys" agregá tu clave si tenés; si no, te mandan la contraseña de
   `root` por mail.
6. Create & Buy. Anotá la **IP pública** (ej. `203.0.113.45`).

---

## 2. Entrar al VPS

Desde tu PC (PowerShell o terminal):

```bash
ssh root@203.0.113.45
```

(La primera vez te pregunta "yes"; si te mandaron contraseña, la pegás.)

---

## 3. Instalar Docker

Pegá esto tal cual dentro del VPS:

```bash
curl -fsSL https://get.docker.com | sh
```

Verificá:

```bash
docker compose version
```

---

## 4. Traer el código al VPS

### Opción A — con Git (recomendada)

Creá un token en GitHub: Settings → Developer settings → Fine-grained tokens →
solo lectura sobre el repo `KICK-CHAT-ULTIMATE`. Después:

```bash
cd /opt
git clone https://TU_TOKEN@github.com/joaquinyunes/KICK-CHAT-ULTIMATE.git
cd KICK-CHAT-ULTIMATE
```

Para actualizar en el futuro: `git pull` y de nuevo `./deploy.sh`.

### Opción B — copiando desde tu PC

Desde tu PC (no dentro del VPS):

```bash
scp -r "C:/Users/yunde/Desktop/KICK-CHAT-ULTIMATE" root@203.0.113.45:/opt/KICK-CHAT-ULTIMATE
```

---

## 5. DNS / dominio

El HTTPS necesita un nombre, no una IP pelada.

- **Sin dominio propio**: usá `sslip.io`. Si tu IP es `203.0.113.45`, tu host es
  `203.0.113.45.sslip.io`. No hay que configurar nada.
- **Con dominio**: creá un registro **A** apuntando `panel.tudominio.com` a la IP
  del VPS.

---

## 6. Configurar variables

Dentro del VPS, en la carpeta del proyecto:

```bash
cp .env.production.example .env.production
nano .env.production
```

Completá:

| Variable | Valor |
|---|---|
| `SITE_ADDRESS` | `203.0.113.45.sslip.io` (o tu dominio) |
| `APP_URL` | `https://203.0.113.45.sslip.io` |
| `MASTER_KEY` | salida de `openssl rand -hex 32` |
| `JWT_SECRET` | otra salida de `openssl rand -hex 32` |
| `ADMIN_SECRET` | otra salida de `openssl rand -hex 32` |
| `ADMIN_PASSWORD` | la contraseña que querés para el usuario `admin` |
| `KICK_CLIENT_ID` / `KICK_CLIENT_SECRET` | los de dev.kick.com |
| `KICK_REDIRECT_URI` | `https://203.0.113.45.sslip.io/auth/kick/callback` |

Generá las 3 claves de una:

```bash
for i in 1 2 3; do openssl rand -hex 32; done
```

Guardá (`Ctrl+O`, Enter) y salí (`Ctrl+X`).

En https://dev.kick.com, editá tu app y agregá esa misma
`KICK_REDIRECT_URI` en las Redirect URLs.

---

## 7. Arrancar

```bash
chmod +x deploy.sh
./deploy.sh
```

La primera vez el build tarda varios minutos (baja Chromium). Cuando termina:

```bash
docker compose ps          # los dos servicios en "running"
docker compose logs -f app # ver que arrancó sin errores (Ctrl+C para salir)
```

Entrá a `https://203.0.113.45.sslip.io/admin` → usuario `admin`, contraseña la
que pusiste en `ADMIN_PASSWORD`.

---

## 8. Cargar todo desde el panel

1. **Proxies** (`/admin/proxies`): agregá cada proxy (host, puerto, usuario,
   contraseña, protocolo `http` o `socks5`). El visor de VODs los rota solo, uno
   por visita.
2. **Bots / bearers** (`/admin/bots`): pegá cada bearer token → *Agregar Bot*.
   Después *Probar todos*: manda un mensaje de prueba y lo borra al instante;
   marca cada uno ✓ vivo / ✗ muerto. *Eliminar muertos* borra los que fallan.
3. **Clientes** (`/admin/clientes`): creá los usuarios cliente y asignales bots.
4. **VODs**: cada cliente entra con su usuario y carga las URLs de sus
   VODs/clips; desde ahí arranca/para su visor.

---

## 9. Mantenimiento

| Tarea | Comando (en `/opt/KICK-CHAT-ULTIMATE`) |
|---|---|
| Ver logs | `docker compose logs -f app` |
| Reiniciar | `docker compose restart app` |
| Actualizar código | `git pull && ./deploy.sh` |
| Backup de la base | `cp data/streamchat.db ~/backup-$(date +%F).db` |
| Parar todo | `docker compose down` |

La base SQLite y los logs viven en `./data` (fuera del contenedor: sobreviven a
updates y reinicios). Copiá esa carpeta para respaldar.

---

## 10. Sobre la efectividad de los VODs

El worker abre un Chromium headless por visita y navega a la URL del VOD desde
el proxy que le toca. Con proxies residenciales rotando, cada visita sale de una
IP distinta. Kick igual aplica sus propios filtros de conteo — apuntá a un
ritmo moderado (`hourly_view_limit` por cliente) para no quemar los proxies.

Si activás el pipeline de contexto (`KC_PIPELINE_ENABLED=1`) el VPS va a
necesitar más RAM y `ffmpeg`; dejalo en `0` hasta que el resto esté andando.
