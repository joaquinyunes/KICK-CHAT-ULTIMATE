#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Instalación completa en un VPS Ubuntu 22.04 / 24.04 recién creado.
# Se corre UNA vez, como root. Instala Docker, prepara swap, pide los 4 datos
# que no se pueden autogenerar y deja el server corriendo con HTTPS.
#
# Uso:
#   1) Subí el proyecto al VPS (git clone o scp) en /opt/KICK-CHAT-ULTIMATE
#   2) cd /opt/KICK-CHAT-ULTIMATE && bash bootstrap-vps.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

echo "== 1/6  Paquetes base =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git ufw >/dev/null

echo "== 2/6  Docker =="
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
docker compose version

echo "== 3/6  Swap (4 GB, red de seguridad para Chromium) =="
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== 4/6  Firewall (SSH + HTTP + HTTPS) =="
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp   >/dev/null
ufw allow 443/tcp  >/dev/null
ufw --force enable  >/dev/null

echo "== 5/6  Configuración =="
if [ -f .env.production ]; then
  echo "   .env.production ya existe — no lo toco."
else
  IP=$(curl -fsS4 ifconfig.me || echo "")
  echo
  echo "   Dominio / host público. Enter para usar  ${IP}.sslip.io"
  read -rp "   SITE_ADDRESS: " SITE_ADDRESS
  SITE_ADDRESS=${SITE_ADDRESS:-${IP}.sslip.io}
  read -rp "   Contraseña para el usuario 'admin': " ADMIN_PASSWORD
  read -rp "   KICK_CLIENT_ID (de dev.kick.com): " KICK_CLIENT_ID
  read -rp "   KICK_CLIENT_SECRET: " KICK_CLIENT_SECRET

  cp .env.production.example .env.production
  sed -i "s|^SITE_ADDRESS=.*|SITE_ADDRESS=${SITE_ADDRESS}|"                         .env.production
  sed -i "s|^APP_URL=.*|APP_URL=https://${SITE_ADDRESS}|"                           .env.production
  sed -i "s|^MASTER_KEY=.*|MASTER_KEY=$(openssl rand -hex 32)|"                     .env.production
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|"                     .env.production
  sed -i "s|^ADMIN_SECRET=.*|ADMIN_SECRET=$(openssl rand -hex 32)|"                 .env.production
  sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PASSWORD}|"                   .env.production
  sed -i "s|^KICK_CLIENT_ID=.*|KICK_CLIENT_ID=${KICK_CLIENT_ID}|"                   .env.production
  sed -i "s|^KICK_CLIENT_SECRET=.*|KICK_CLIENT_SECRET=${KICK_CLIENT_SECRET}|"       .env.production
  sed -i "s|^KICK_REDIRECT_URI=.*|KICK_REDIRECT_URI=https://${SITE_ADDRESS}/auth/kick/callback|" .env.production

  echo
  echo "   >>> En https://dev.kick.com agregá esta Redirect URL:"
  echo "       https://${SITE_ADDRESS}/auth/kick/callback"
  echo
fi

echo "== 6/6  Build + arranque (tarda varios minutos la 1ra vez) =="
bash deploy.sh

SITE=$(grep '^SITE_ADDRESS=' .env.production | cut -d= -f2)
echo
echo "════════════════════════════════════════════════════════"
echo "  Listo. Panel:  https://${SITE}/admin"
echo "  Usuario: admin    (contraseña la que ingresaste)"
echo "  Logs:    docker compose logs -f app"
echo "════════════════════════════════════════════════════════"
