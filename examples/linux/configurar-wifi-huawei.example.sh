#!/bin/bash
# Preparar somente apos optar pelo WiFi para manter acesso ao Huawei.
# SSID e senha sao informados neste terminal, sem passar pelo chat.
set -euo pipefail
wifi_interface=${1:?Informe a interface Wi-Fi como primeiro argumento}
[[ "$wifi_interface" =~ ^[a-zA-Z0-9_.-]{1,15}$ && "$wifi_interface" != -* ]] || { echo "Interface Wi-Fi inválida." >&2; exit 1; }
[ "$(id -u)" = 0 ] || { echo 'Execute como root.' >&2; exit 1; }
command -v wpa_passphrase >/dev/null || { echo 'Falta instalar wpasupplicant.' >&2; exit 1; }
ip link show "$wifi_interface" >/dev/null
wifi_conf=/etc/wpa_supplicant/orbit-huawei.conf
wifi_iface=/etc/network/interfaces.d/90-orbit-huawei
if [ -e "$wifi_conf" ] || [ -e "$wifi_iface" ] || ifquery --list | grep -Fxq "$wifi_interface"; then
  echo 'Configuracao WiFi existente. Revisar antes de substituir.' >&2
  exit 1
fi
read -r -p 'Nome exato da rede WiFi Huawei (SSID): ' orbit_ssid </dev/tty
[ -n "$orbit_ssid" ] || { echo 'SSID vazio.' >&2; exit 1; }
read -r -s -p 'Senha do WiFi Huawei: ' orbit_wifi_password </dev/tty
printf '\n'
umask 077
install -d -m 755 /etc/wpa_supplicant
printf 'ctrl_interface=/run/wpa_supplicant\nupdate_config=0\n' > "$wifi_conf"
if ! printf '%s\n' "$orbit_wifi_password" | wpa_passphrase "$orbit_ssid" | sed '/^[[:space:]]*#psk=/d' >> "$wifi_conf"; then
  unset orbit_wifi_password
  rm -- "$wifi_conf"
  echo 'Nao foi possivel preparar a rede. Confira SSID e senha.' >&2
  exit 1
fi
unset orbit_wifi_password
chmod 600 "$wifi_conf"
printf 'auto %s\niface %s inet dhcp\n    wpa-conf /etc/wpa_supplicant/orbit-huawei.conf\n    metric 3000\n    post-up /usr/sbin/iw dev %s set power_save off\n' "$wifi_interface" "$wifi_interface" "$wifi_interface" > "$wifi_iface"
chmod 644 "$wifi_iface"
if ! ifup "$wifi_interface"; then
  ifdown --force "$wifi_interface" >/dev/null 2>&1 || true
  rm -- "$wifi_iface" "$wifi_conf"
  echo 'WiFi nao conectado. Configuracao nova removida; Ethernet mantida.' >&2
  exit 1
fi
printf '\nEstado do WiFi preparado:\n'
ip -brief address show "$wifi_interface"
printf '\nRotas (Ethernet deve ter prioridade para a internet):\n'
ip route
printf '\nAguarde validacao do ORBIT antes de trocar o cabo de rede.\n'
