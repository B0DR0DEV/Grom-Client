#!/usr/bin/env bash
# Ставит Grom relay как systemd-сервис (Ubuntu/Debian).
#   sudo PUBLIC_DOMAIN=play.example.com bash install.sh
set -e
[ -n "$PUBLIC_DOMAIN" ] || { echo "Укажи домен: sudo PUBLIC_DOMAIN=play.example.com bash install.sh"; exit 1; }
command -v node >/dev/null || { apt-get update && apt-get install -y nodejs; }
install -d /opt/grom-relay && install -m 644 "$(dirname "$0")/relay-server.js" /opt/grom-relay/relay-server.js
cat > /etc/systemd/system/grom-relay.service <<UNIT
[Unit]
Description=Grom relay
After=network.target
[Service]
Environment=PUBLIC_DOMAIN=$PUBLIC_DOMAIN
Environment=PUBLIC_PORT=25565
Environment=CONTROL_PORT=7000
ExecStart=$(command -v node) /opt/grom-relay/relay-server.js
Restart=always
User=nobody
LimitNOFILE=65535
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now grom-relay
command -v ufw >/dev/null && ufw allow 7000/tcp && ufw allow 25565/tcp || true
echo "Готово. Открой TCP 7000 и 25565 в панели хостинга и добавь DNS-записи (см. README.md)."
