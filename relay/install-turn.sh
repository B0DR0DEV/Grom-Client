#!/usr/bin/env bash
# Ставит TURN-сервер (coturn) для голосовых звонков Grom. Можно на тот же VPS, что и relay.
#   sudo TURN_USER=grom TURN_PASS='длинный-пароль' bash install-turn.sh
# Потом впиши адрес, логин и пароль в TURN_SERVERS в src/renderer/callSignal.ts и пересобери лаунчер.
set -e
[ -n "$TURN_PASS" ] || { echo "Задай пароль: sudo TURN_USER=grom TURN_PASS='...' bash install-turn.sh"; exit 1; }
TURN_USER=${TURN_USER:-grom}
apt-get update && apt-get install -y coturn
PUBLIC_IP=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
PRIVATE_IP=$(hostname -I | awk '{print $1}')
cat > /etc/turnserver.conf <<CONF
listening-port=3478
fingerprint
lt-cred-mech
user=${TURN_USER}:${TURN_PASS}
realm=grom
external-ip=${PUBLIC_IP}/${PRIVATE_IP}
min-port=49160
max-port=49200
total-quota=300
user-quota=4
max-bps=128000
no-multicast-peers
no-tls
no-dtls
# не пускать трафик во внутренние сети сервера
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
CONF
sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn 2>/dev/null || true
systemctl enable --now coturn && systemctl restart coturn
command -v ufw >/dev/null && ufw allow 3478 && ufw allow 49160:49200/udp || true
echo "Готово. Открой в панели хостинга TCP/UDP 3478 и UDP 49160-49200."
echo "В callSignal.ts: { urls: ['turn:${PUBLIC_IP}:3478?transport=udp','turn:${PUBLIC_IP}:3478?transport=tcp'], username: '${TURN_USER}', credential: '<пароль>' }"
