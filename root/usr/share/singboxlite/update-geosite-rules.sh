#!/bin/sh

set -u

NAME="singboxlite-ruleset"
REPO_RAW="${REPO_RAW:-$(uci -q get singboxlite.ruleset.repo_raw || echo https://raw.githubusercontent.com/leosysd/ruleset/main/dist)}"
SINGBOX_DIR="${SINGBOX_DIR:-$(uci -q get singboxlite.ruleset.singbox_dir || echo /etc/sing-box/rule-set)}"
MOSDNS_DIR="${MOSDNS_DIR:-$(uci -q get singboxlite.ruleset.mosdns_dir || echo /etc/mosdns/rule)}"
SINGBOX_RESTART="${SINGBOX_RESTART:-$(uci -q get singboxlite.ruleset.restart_singbox || echo 0)}"
MOSDNS_RESTART="${MOSDNS_RESTART:-$(uci -q get singboxlite.ruleset.restart_mosdns || echo 0)}"
WORK_DIR="${WORK_DIR:-/etc/sing-box/singboxlite/ruleset}"
TMP_DIR="$WORK_DIR/tmp"
LOCK_DIR="$WORK_DIR/lock"
LOG_FILE="${LOG_FILE:-/tmp/singboxlite-ruleset.log}"

log() {
	local line
	line="$(date '+%Y-%m-%d %H:%M:%S') [$NAME] $*"
	mkdir -p "$(dirname "$LOG_FILE")"
	printf '%s\n' "$line" >> "$LOG_FILE"
	printf '%s\n' "$line" >&2
}

save_result() {
	uci -q set singboxlite.ruleset.last_update_time="$(date '+%Y-%m-%d %H:%M:%S')"
	uci -q set singboxlite.ruleset.last_update_result="$1"
	uci -q commit singboxlite
}

die() {
	log "ERROR: $*"
	save_result "fail: $*"
	exit 1
}

validate_dirs() {
	case "$SINGBOX_DIR" in
		/etc/sing-box/*) ;;
		*) die "sing-box ruleset dir must be under /etc/sing-box/" ;;
	esac

	case "$MOSDNS_DIR" in
		/etc/mosdns/*) ;;
		*) die "MosDNS ruleset dir must be under /etc/mosdns/" ;;
	esac

	case "$SINGBOX_DIR:$MOSDNS_DIR" in
		*..*) die "ruleset dir must not contain .." ;;
	esac
}

usage() {
	cat <<EOF
Commands:
  update     Download and install generated rule files
  status     Show generated rule file status
  clear-log  Clear update log

Environment overrides:
  REPO_RAW=$REPO_RAW
  SINGBOX_DIR=$SINGBOX_DIR
  MOSDNS_DIR=$MOSDNS_DIR
EOF
}

ensure_dirs() {
	validate_dirs
	mkdir -p "$SINGBOX_DIR" "$MOSDNS_DIR" "$WORK_DIR" "$TMP_DIR"
}

lock_update() {
	ensure_dirs
	if ! mkdir "$LOCK_DIR" 2>/dev/null; then
		die "another ruleset update is already running"
	fi
	trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM
}

fetch_file() {
	local name="$1"
	local tmp="$TMP_DIR/$name.tmp"
	local url="$REPO_RAW/$name"

	rm -f "$tmp"
	log "download $url"

	if command -v uclient-fetch >/dev/null 2>&1; then
		uclient-fetch -T 30 -O "$tmp" "$url" >/dev/null 2>&1 && [ -s "$tmp" ] && return 0
	fi

	rm -f "$tmp"
	if command -v wget >/dev/null 2>&1; then
		wget -T 30 -O "$tmp" "$url" >/dev/null 2>&1 && [ -s "$tmp" ] && return 0
	fi

	rm -f "$tmp"
	if command -v curl >/dev/null 2>&1; then
		curl -fL --connect-timeout 30 --max-time 60 -o "$tmp" "$url" >/dev/null 2>&1 && [ -s "$tmp" ] && return 0
	fi

	return 1
}

install_file() {
	local tmp="$1"
	local final="$2"
	local bak="$final.bak"

	[ -s "$tmp" ] || die "downloaded file is empty: $tmp"

	if [ -e "$final" ]; then
		cp -f "$final" "$bak" || die "failed to backup $final"
	fi

	mv -f "$tmp" "$final" || die "failed to replace $final"
	log "installed $final"
}

update_rules() {
	lock_update

	fetch_file direct-geosite.srs || die "failed to download direct-geosite.srs"
	fetch_file proxy-geosite.srs || die "failed to download proxy-geosite.srs"
	fetch_file direct-geosite.json || die "failed to download direct-geosite.json"
	fetch_file proxy-geosite.json || die "failed to download proxy-geosite.json"
	fetch_file direct-geosite.txt || die "failed to download direct-geosite.txt"
	fetch_file proxy-geosite.txt || die "failed to download proxy-geosite.txt"

	install_file "$TMP_DIR/direct-geosite.srs.tmp" "$SINGBOX_DIR/direct-geosite.srs"
	install_file "$TMP_DIR/proxy-geosite.srs.tmp" "$SINGBOX_DIR/proxy-geosite.srs"
	install_file "$TMP_DIR/direct-geosite.json.tmp" "$SINGBOX_DIR/direct-geosite.json"
	install_file "$TMP_DIR/proxy-geosite.json.tmp" "$SINGBOX_DIR/proxy-geosite.json"
	install_file "$TMP_DIR/direct-geosite.txt.tmp" "$MOSDNS_DIR/direct-geosite.txt"
	install_file "$TMP_DIR/proxy-geosite.txt.tmp" "$MOSDNS_DIR/proxy-geosite.txt"

	if [ "$SINGBOX_RESTART" = "1" ] && [ -x /etc/init.d/sing-box ]; then
		log "restart sing-box"
		/etc/init.d/sing-box restart >> "$LOG_FILE" 2>&1 || die "failed to restart sing-box"
	fi

	if [ "$MOSDNS_RESTART" = "1" ] && [ -x /etc/init.d/mosdns ]; then
		log "restart mosdns"
		/etc/init.d/mosdns restart >> "$LOG_FILE" 2>&1 || die "failed to restart mosdns"
	fi

	rm -rf "$TMP_DIR"
	save_result "pass"
	log "update completed"
}

status_file() {
	local label="$1"
	local path="$2"

	if [ -s "$path" ]; then
		printf '%s=yes %s bytes %s\n' "$label" "$(wc -c < "$path" | tr -d ' ')" "$path"
	else
		printf '%s=no %s\n' "$label" "$path"
	fi
}

status_rules() {
	validate_dirs
	status_file direct_srs "$SINGBOX_DIR/direct-geosite.srs"
	status_file proxy_srs "$SINGBOX_DIR/proxy-geosite.srs"
	status_file direct_json "$SINGBOX_DIR/direct-geosite.json"
	status_file proxy_json "$SINGBOX_DIR/proxy-geosite.json"
	status_file direct_txt "$MOSDNS_DIR/direct-geosite.txt"
	status_file proxy_txt "$MOSDNS_DIR/proxy-geosite.txt"
	printf 'singbox_dir=%s\n' "$SINGBOX_DIR"
	printf 'mosdns_dir=%s\n' "$MOSDNS_DIR"
	printf 'repo_raw=%s\n' "$REPO_RAW"
	printf 'log_file=%s\n' "$LOG_FILE"
}

clear_log() {
	mkdir -p "$(dirname "$LOG_FILE")"
	: > "$LOG_FILE"
	log "log cleared"
}

case "${1:-}" in
	update) update_rules ;;
	status) status_rules ;;
	clear-log) clear_log ;;
	-h|--help|help|"") usage ;;
	*) usage; exit 1 ;;
esac
