#!/bin/sh

set -eu

CONFIG_PATH="$(uci -q get singboxlite.main.config_path || echo /etc/sing-box/config.json)"
URL="$(uci -q get singboxlite.remote.url || true)"
AUTO_APPLY="$(uci -q get singboxlite.remote.auto_apply || echo 0)"
MODE="$(uci -q get singboxlite.main.mode || echo singbox_mosdns)"
MOSDNS_ADDR="$(uci -q get singboxlite.dns.mosdns_addr || echo 127.0.0.1)"
MOSDNS_PORT="$(uci -q get singboxlite.dns.mosdns_port || echo 5335)"
DISABLE_DNS_HIJACK="$(uci -q get singboxlite.dns.disable_dns_hijack || echo 1)"
RESTART_MOSDNS_AFTER_APPLY="$(uci -q get singboxlite.dns.restart_mosdns_after_apply || echo 1)"
TEMP_DIR="$(uci -q get singboxlite.main.temp_dir || echo /tmp/singboxlite)"
TEMP_FILE="$TEMP_DIR/import-remote.json"
MOSDNS_FILE="$TEMP_DIR/import-mosdns.json"
DNS_HIJACK_BIN="/usr/bin/sing-box-disable-dns-hijack"
DNS_HIJACK_TEMPLATE="/usr/share/singboxlite/sing-box-disable-dns-hijack.sh"
PREPARE_MOSDNS="/usr/share/singboxlite/prepare-mosdns-config.uc"
LOG_PREFIX="singboxlite auto-update:"

case "$CONFIG_PATH" in
	/etc/sing-box/*) ;;
	*) CONFIG_PATH="/etc/sing-box/config.json" ;;
esac

case "$CONFIG_PATH" in
	*..*) CONFIG_PATH="/etc/sing-box/config.json" ;;
esac

log_result() {
	uci -q set singboxlite.remote.last_update_time="$(date '+%Y-%m-%d %H:%M:%S')"
	uci -q set singboxlite.remote.last_update_result="$1"
	uci -q commit singboxlite
	logger -t singboxlite "$LOG_PREFIX $1"
}

install_dns_hijack_script() {
	[ -f "$DNS_HIJACK_TEMPLATE" ] || {
		log_result "missing DNS hijack cleanup template"
		exit 1
	}

	cp "$DNS_HIJACK_TEMPLATE" "$DNS_HIJACK_BIN"
	chmod 0755 "$DNS_HIJACK_BIN"
}

uninstall_dns_hijack_script() {
	rm -f "$DNS_HIJACK_BIN"
}

stop_mosdns() {
	[ -x /etc/init.d/mosdns ] && /etc/init.d/mosdns stop >/dev/null 2>&1 || true
}

dnsmasq_uses_mosdns() {
	uci -q show dhcp | grep -F "server='${MOSDNS_ADDR}#${MOSDNS_PORT}'" >/dev/null 2>&1 && return 0
	uci -q show dhcp | grep -F "server='127.0.0.1#${MOSDNS_PORT}'" >/dev/null 2>&1 && return 0
	uci -q show dhcp | grep -F "server='::1#${MOSDNS_PORT}'" >/dev/null 2>&1 && return 0
	uci -q show dhcp | grep -F "server='localhost#${MOSDNS_PORT}'" >/dev/null 2>&1 && return 0
	return 1
}

stop_mosdns_for_singbox_mode() {
	if dnsmasq_uses_mosdns; then
		logger -t singboxlite "$LOG_PREFIX dnsmasq still forwards to MosDNS, keep mosdns running to avoid DNS outage"
		return 0
	fi

	stop_mosdns
}

restart_mosdns() {
	[ -x /etc/init.d/mosdns ] || {
		log_result "mosdns init script not found"
		exit 1
	}
	/etc/init.d/mosdns restart
}

restart_singbox() {
	/etc/init.d/sing-box restart
	sleep 2
	/etc/init.d/sing-box status >/dev/null 2>&1 || {
		log_result "sing-box restart failed"
		exit 1
	}
}

[ -n "$URL" ] || {
	log_result "remote URL is empty"
	exit 1
}

mkdir -p "$TEMP_DIR"

if command -v uclient-fetch >/dev/null 2>&1; then
	uclient-fetch -T 30 -O "$TEMP_FILE" "$URL" >/tmp/singboxlite-update.log 2>&1 || {
		log_result "download failed"
		exit 1
	}
elif command -v wget >/dev/null 2>&1; then
	wget -T 30 -O "$TEMP_FILE" "$URL" >/tmp/singboxlite-update.log 2>&1 || {
		log_result "download failed"
		exit 1
	}
elif command -v curl >/dev/null 2>&1; then
	curl -L --connect-timeout 30 --max-time 30 -o "$TEMP_FILE" "$URL" >/tmp/singboxlite-update.log 2>&1 || {
		log_result "download failed"
		exit 1
	}
else
	log_result "no downloader found"
	exit 1
fi

[ -s "$TEMP_FILE" ] || {
	log_result "downloaded file is empty"
	exit 1
}

APPLY_FILE="$TEMP_FILE"
if [ "$MODE" = "singbox_mosdns" ]; then
	[ -x "$PREPARE_MOSDNS" ] || {
		log_result "missing MosDNS config prepare helper"
		exit 1
	}
	"$PREPARE_MOSDNS" "$TEMP_FILE" "$MOSDNS_FILE" "$MOSDNS_ADDR" "$MOSDNS_PORT" >/tmp/singboxlite-prepare.log 2>&1 || {
		log_result "prepare MosDNS config failed"
		exit 1
	}
	APPLY_FILE="$MOSDNS_FILE"
fi

/usr/bin/sing-box check -c "$APPLY_FILE" >/tmp/singboxlite-check.log 2>&1 || {
	log_result "config check failed"
	exit 1
}

uci -q set singboxlite.main.last_check_result="pass"
uci -q set singboxlite.main.last_check_time="$(date '+%Y-%m-%d %H:%M:%S')"
uci -q set singboxlite.main.last_import_source="remote"
uci -q set singboxlite.main.last_import_time="$(date '+%Y-%m-%d %H:%M:%S')"
uci -q commit singboxlite

[ "$AUTO_APPLY" = "1" ] || {
	log_result "downloaded and checked, auto apply disabled"
	exit 0
}

if [ "$MODE" = "singbox_mosdns" ]; then
	if [ "$DISABLE_DNS_HIJACK" = "1" ]; then
		install_dns_hijack_script
	else
		uninstall_dns_hijack_script
	fi
else
	uninstall_dns_hijack_script
	stop_mosdns_for_singbox_mode
fi

mkdir -p "$(dirname "$CONFIG_PATH")"
BACKUP=""
if [ -f "$CONFIG_PATH" ]; then
	BACKUP="${CONFIG_PATH}.bak-singboxlite-$(date '+%Y%m%d-%H%M%S')"
	cp -p "$CONFIG_PATH" "$BACKUP"
fi

cp "$APPLY_FILE" "$CONFIG_PATH"
[ "$MODE" = "singbox_mosdns" ] && [ "$RESTART_MOSDNS_AFTER_APPLY" = "1" ] && restart_mosdns
restart_singbox

if [ "$MODE" = "singbox_mosdns" ]; then
	if [ "$DISABLE_DNS_HIJACK" = "1" ]; then
		"$DNS_HIJACK_BIN" >/dev/null 2>&1 || {
			log_result "applied, but DNS hijack cleanup failed"
			exit 1
		}
	fi
else
	stop_mosdns_for_singbox_mode
fi

uci -q set singboxlite.main.last_apply_time="$(date '+%Y-%m-%d %H:%M:%S')"
uci -q commit singboxlite
[ -n "$BACKUP" ] && log_result "applied successfully, backup: $BACKUP" || log_result "applied successfully, no previous config"
