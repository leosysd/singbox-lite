#!/bin/sh

set -eu

CONFIG_PATH="$(uci -q get singboxlite.main.config_path || echo /etc/sing-box/config.json)"
URL="$(uci -q get singboxlite.remote.url || true)"
AUTO_APPLY="$(uci -q get singboxlite.remote.auto_apply || echo 0)"
MODE="$(uci -q get singboxlite.main.mode || echo singbox_mosdns)"
RESTART_MOSDNS="$(uci -q get singboxlite.dns.restart_mosdns_after_apply || echo 1)"
DISABLE_DNS_HIJACK="$(uci -q get singboxlite.dns.disable_dns_hijack || echo 1)"
TEMP_DIR="$(uci -q get singboxlite.main.temp_dir || echo /tmp/singboxlite)"
TEMP_FILE="$TEMP_DIR/import-remote.json"
LOG_PREFIX="singboxlite auto-update:"

log_result() {
	uci -q set singboxlite.remote.last_update_time="$(date '+%Y-%m-%d %H:%M:%S')"
	uci -q set singboxlite.remote.last_update_result="$1"
	uci -q commit singboxlite
	logger -t singboxlite "$LOG_PREFIX $1"
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

/usr/bin/sing-box check -c "$TEMP_FILE" >/tmp/singboxlite-check.log 2>&1 || {
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

BACKUP="${CONFIG_PATH}.bak-singboxlite-$(date '+%Y%m%d-%H%M%S')"
cp -p "$CONFIG_PATH" "$BACKUP"
cp "$TEMP_FILE" "$CONFIG_PATH"
/etc/init.d/sing-box restart

if [ "$DISABLE_DNS_HIJACK" = "1" ] && [ -x /usr/bin/sing-box-disable-dns-hijack ]; then
	/usr/bin/sing-box-disable-dns-hijack >/dev/null 2>&1 || true
fi

if [ "$MODE" = "singbox_mosdns" ] && [ "$RESTART_MOSDNS" = "1" ] && [ -x /etc/init.d/mosdns ]; then
	/etc/init.d/mosdns restart
fi

uci -q set singboxlite.main.last_apply_time="$(date '+%Y-%m-%d %H:%M:%S')"
uci -q commit singboxlite
log_result "applied successfully, backup: $BACKUP"
