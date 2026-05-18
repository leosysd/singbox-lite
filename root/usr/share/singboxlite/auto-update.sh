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
TEMP_DIR="$(uci -q get singboxlite.main.temp_dir || echo /etc/sing-box/singboxlite)"
TEMP_FILE="$TEMP_DIR/import-remote.json"
MOSDNS_FILE="$TEMP_DIR/import-mosdns.json"
SINGBOX_FILE="$TEMP_DIR/import-singbox.json"
SOURCE_FILE="$TEMP_DIR/source.json"
DNS_HIJACK_BIN="/usr/bin/sing-box-disable-dns-hijack"
DNS_HIJACK_TEMPLATE="/usr/share/singboxlite/sing-box-disable-dns-hijack.sh"
PREPARE_MOSDNS="/usr/share/singboxlite/prepare-mosdns-config.uc"
PREPARE_SINGBOX="/usr/share/singboxlite/prepare-singbox-config.uc"
LOG_PREFIX="singboxlite auto-update:"

case "$CONFIG_PATH" in
	/etc/sing-box/*) ;;
	*) CONFIG_PATH="/etc/sing-box/config.json" ;;
esac

case "$CONFIG_PATH" in
	*..*) CONFIG_PATH="/etc/sing-box/config.json" ;;
esac

case "$TEMP_DIR" in
	/etc/sing-box/*) ;;
	*) TEMP_DIR="/etc/sing-box/singboxlite" ;;
esac

case "$TEMP_DIR" in
	*..*) TEMP_DIR="/etc/sing-box/singboxlite" ;;
esac

TEMP_FILE="$TEMP_DIR/import-remote.json"
MOSDNS_FILE="$TEMP_DIR/import-mosdns.json"
SINGBOX_FILE="$TEMP_DIR/import-singbox.json"
SOURCE_FILE="$TEMP_DIR/source.json"

log_result() {
	uci -q set singboxlite.remote.last_update_time="$(date '+%Y-%m-%d %H:%M:%S')"
	uci -q set singboxlite.remote.last_update_result="$1"
	uci -q commit singboxlite
	logger -t singboxlite "$LOG_PREFIX $1"
}

install_dns_hijack_script() {
	[ -f "$DNS_HIJACK_BIN" ] && return 0

	[ -f "$DNS_HIJACK_TEMPLATE" ] || {
		log_result "missing DNS hijack cleanup template"
		exit 1
	}

	cp "$DNS_HIJACK_TEMPLATE" "$DNS_HIJACK_BIN"
	chmod 0755 "$DNS_HIJACK_BIN"
}

uninstall_dns_hijack_script() {
	[ -f "$DNS_HIJACK_BIN" ] || return 0
	rm -f "$DNS_HIJACK_BIN"
}

run_dns_hijack_script() {
	[ -x "$DNS_HIJACK_BIN" ] && "$DNS_HIJACK_BIN" || true
}

stop_mosdns() {
	uci -q set mosdns.config.redirect='0'
	uci -q set mosdns.config.local_dns_redirect='0'
	uci -q set mosdns.config.enabled='0'
	uci -q commit mosdns
	[ -x /etc/init.d/mosdns ] && /etc/init.d/mosdns stop >/dev/null 2>&1 || true
	sleep 1
	if [ -x /etc/init.d/mosdns ] && /etc/init.d/mosdns status 2>/dev/null | grep -qi running; then
		log_result "mosdns still running after stop"
		exit 1
	fi
}

cleanup_dnsmasq_mosdns_upstream() {
	uci -q del_list dhcp.@dnsmasq[0].server="${MOSDNS_ADDR}#${MOSDNS_PORT}" 2>/dev/null || true
	uci -q del_list dhcp.@dnsmasq[0].server="127.0.0.1#${MOSDNS_PORT}" 2>/dev/null || true
	uci -q del_list dhcp.@dnsmasq[0].server="::1#${MOSDNS_PORT}" 2>/dev/null || true
	uci -q del_list dhcp.@dnsmasq[0].server="localhost#${MOSDNS_PORT}" 2>/dev/null || true
	uci -q set dhcp.@dnsmasq[0].noresolv='0'
	uci -q commit dhcp
	[ -x /etc/init.d/dnsmasq ] && /etc/init.d/dnsmasq restart >/dev/null 2>&1 || true
}

restart_mosdns() {
	[ -x /etc/init.d/mosdns ] || {
		log_result "mosdns init script not found"
		exit 1
	}
	uci -q set mosdns.config.enabled='1'
	uci -q set mosdns.config.redirect='1'
	uci -q set mosdns.config.local_dns_redirect='0'
	uci -q commit mosdns
	/etc/init.d/mosdns restart
}

enable_mosdns() {
	uci -q set mosdns.config.enabled='1'
	uci -q set mosdns.config.redirect='1'
	uci -q set mosdns.config.local_dns_redirect='0'
	uci -q commit mosdns
}

restart_singbox() {
	/etc/init.d/sing-box restart
	sleep 2
	/etc/init.d/sing-box status >/dev/null 2>&1 || {
		log_result "sing-box restart failed"
		exit 1
	}
}

stop_singbox_for_apply() {
	[ -x /etc/init.d/sing-box ] || {
		log_result "sing-box init script not found"
		exit 1
	}
	/etc/init.d/sing-box stop >/dev/null 2>&1 || {
		log_result "sing-box stop failed"
		exit 1
	}
	sleep 1
	if /etc/init.d/sing-box status 2>/dev/null | grep -qi running; then
		log_result "sing-box still running after stop"
		exit 1
	fi
}

start_singbox_for_apply() {
	[ -x /etc/init.d/sing-box ] || {
		log_result "sing-box init script not found"
		exit 1
	}
	/etc/init.d/sing-box start
	sleep 2
	/etc/init.d/sing-box status >/dev/null 2>&1 || {
		log_result "sing-box start failed"
		exit 1
	}
}

start_mosdns_for_apply() {
	[ -x /etc/init.d/mosdns ] || {
		log_result "mosdns init script not found"
		exit 1
	}
	uci -q set mosdns.config.enabled='1'
	uci -q set mosdns.config.redirect='1'
	uci -q set mosdns.config.local_dns_redirect='0'
	uci -q commit mosdns
	/etc/init.d/mosdns restart
	sleep 3
	/etc/init.d/mosdns status >/dev/null 2>&1 || {
		log_result "mosdns start failed"
		exit 1
	}
}

dns_lookup_probe() {
	TARGET="$1"
	LABEL="$2"
	nslookup github.com "$TARGET" >/tmp/singboxlite-dns-probe.log 2>&1 && grep -q "Address" /tmp/singboxlite-dns-probe.log || {
		log_result "$LABEL DNS probe failed"
		return 1
	}
}

dns_probe_after_apply() {
	if [ "$MODE" = "singbox_mosdns" ]; then
		dns_lookup_probe "127.0.0.1:${MOSDNS_PORT}" "mosdns" || return 1
		dns_lookup_probe "127.0.0.1" "local dns" || return 1
	else
		dns_lookup_probe "127.0.0.1" "sing-box" || return 1
	fi
}

rollback_after_failed_apply() {
	[ -n "${BACKUP:-}" ] && [ -f "$BACKUP" ] && cp -p "$BACKUP" "$CONFIG_PATH" || true
	uci -q set singboxlite.main.mode='singbox_dns'
	uci -q commit singboxlite
	uninstall_dns_hijack_script
	stop_mosdns
	cleanup_dnsmasq_mosdns_upstream
	start_singbox_for_apply
	log_result "DNS probe failed, rolled back to sing-box mode"
	exit 1
}

format_config() {
	/usr/bin/sing-box format -w -c "$1" >>/tmp/singboxlite-prepare.log 2>&1 || {
		log_result "config format failed"
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
else
	[ -x "$PREPARE_SINGBOX" ] || {
		log_result "missing sing-box config prepare helper"
		exit 1
	}
	"$PREPARE_SINGBOX" "$TEMP_FILE" "$SINGBOX_FILE" >/tmp/singboxlite-prepare.log 2>&1 || {
		log_result "prepare sing-box config failed"
		exit 1
	}
	APPLY_FILE="$SINGBOX_FILE"
fi

format_config "$APPLY_FILE"

/usr/bin/sing-box check -c "$APPLY_FILE" >/tmp/singboxlite-check.log 2>&1 || {
	log_result "config check failed"
	exit 1
}

uci -q set singboxlite.main.last_check_result="pass"
uci -q set singboxlite.main.last_check_time="$(date '+%Y-%m-%d %H:%M:%S')"
uci -q set singboxlite.main.last_import_source="remote"
uci -q set singboxlite.main.last_import_time="$(date '+%Y-%m-%d %H:%M:%S')"
cp -p "$TEMP_FILE" "$SOURCE_FILE"
uci -q set singboxlite.main.source_path="$SOURCE_FILE"
uci -q commit singboxlite

[ "$AUTO_APPLY" = "1" ] || {
	log_result "downloaded and checked, auto apply disabled"
	exit 0
}

stop_singbox_for_apply

if [ "$MODE" = "singbox_mosdns" ]; then
	if [ "$DISABLE_DNS_HIJACK" = "1" ]; then
		install_dns_hijack_script
	else
		uninstall_dns_hijack_script
	fi
	enable_mosdns
else
	uninstall_dns_hijack_script
	stop_mosdns
	cleanup_dnsmasq_mosdns_upstream
fi

mkdir -p "$(dirname "$CONFIG_PATH")"
BACKUP=""
if [ -f "$CONFIG_PATH" ]; then
	BACKUP="${CONFIG_PATH}.bak-singboxlite"
	rm -f "${CONFIG_PATH}".bak-singboxlite-* 2>/dev/null || true
	cp -p "$CONFIG_PATH" "$BACKUP"
fi

cp "$APPLY_FILE" "$CONFIG_PATH"
[ "$MODE" = "singbox_mosdns" ] && start_mosdns_for_apply
start_singbox_for_apply
[ "$MODE" = "singbox_mosdns" ] && [ "$DISABLE_DNS_HIJACK" = "1" ] && run_dns_hijack_script
dns_probe_after_apply || rollback_after_failed_apply
rm -f "$TEMP_FILE" "$MOSDNS_FILE" "$SINGBOX_FILE"

uci -q set singboxlite.main.last_apply_time="$(date '+%Y-%m-%d %H:%M:%S')"
uci -q commit singboxlite
[ -n "$BACKUP" ] && log_result "applied successfully, backup: $BACKUP" || log_result "applied successfully, no previous config"
