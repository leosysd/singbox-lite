#!/bin/sh

set -u

NAME="singboxlite-app-update"
PKG_NAME="luci-app-singbox-lite"
REPO="${APP_REPO:-leosysd/singbox-lite}"
API_URL="${APP_API_URL:-https://api.github.com/repos/$REPO/releases/latest}"
APK_URL="${APP_APK_URL:-https://github.com/$REPO/releases/latest/download/luci-app-singbox-lite.apk}"
TMP_DIR="${TMP_DIR:-/tmp/singboxlite-app-update}"
LOG_FILE="${LOG_FILE:-/tmp/singboxlite-app-update.log}"
APK_FILE="$TMP_DIR/luci-app-singbox-lite.apk"
VERSION_FILE="/usr/share/singboxlite/version"

log() {
	local line
	line="$(date '+%Y-%m-%d %H:%M:%S') [$NAME] $*"
	mkdir -p "$(dirname "$LOG_FILE")"
	printf '%s\n' "$line" >> "$LOG_FILE"
	printf '%s\n' "$line" >&2
}

ensure_app_section() {
	uci -q get singboxlite.app >/dev/null || uci -q set singboxlite.app='app'
}

set_app_cfg() {
	ensure_app_section
	uci -q set "singboxlite.app.$1=$2"
}

commit_app_cfg() {
	uci -q commit singboxlite
}

mark_result() {
	local action="$1"
	local result="$2"

	set_app_cfg "last_${action}_time" "$(date '+%Y-%m-%d %H:%M:%S')"
	set_app_cfg "last_${action}_result" "$result"
	commit_app_cfg
}

fetch_url() {
	local url="$1"
	local output="$2"

	rm -f "$output"
	if command -v curl >/dev/null 2>&1; then
		curl -fL --connect-timeout 30 --max-time 120 -A "$PKG_NAME" -o "$output" "$url"
		return $?
	fi

	if command -v wget >/dev/null 2>&1; then
		wget -T 30 -O "$output" "$url"
		return $?
	fi

	if command -v uclient-fetch >/dev/null 2>&1; then
		uclient-fetch -T 30 -O "$output" "$url"
		return $?
	fi

	return 1
}

current_version() {
	local ver

	ver="$(cat "$VERSION_FILE" 2>/dev/null || true)"
	if [ -n "$ver" ]; then
		printf '%s\n' "$ver"
		return
	fi

	ver="$(uci -q get singboxlite.app.current_version 2>/dev/null || true)"
	if [ -n "$ver" ]; then
		printf '%s\n' "$ver"
		return
	fi

	if command -v apk >/dev/null 2>&1; then
		ver="$(apk info -v "$PKG_NAME" 2>/dev/null | sed -n "s/^$PKG_NAME-//p" | head -n 1)"
		if [ -z "$ver" ]; then
			ver="$(apk list --installed "$PKG_NAME" 2>/dev/null | sed -n "s/^$PKG_NAME-\\([^ ]*\\).*/\\1/p" | head -n 1)"
		fi
		printf '%s\n' "$ver"
	fi
}

normalize_version() {
	printf '%s' "$1" | sed 's/^v//'
}

latest_version_from_meta() {
	sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -n 1
}

check_update() {
	local meta current latest latest_norm available

	mkdir -p "$TMP_DIR"
	meta="$TMP_DIR/latest.json"

	log "check app release: $API_URL"
	fetch_url "$API_URL" "$meta" >/dev/null 2>&1 || {
		mark_result "check" "fail: fetch"
		log "无法获取 SingBox Lite 最新发布信息"
		return 1
	}

	latest="$(latest_version_from_meta "$meta")"
	if [ -z "$latest" ]; then
		mark_result "check" "fail: parse"
		log "无法解析 SingBox Lite 最新版本"
		return 1
	fi

	current="$(current_version)"
	latest_norm="$(normalize_version "$latest")"
	available="yes"
	[ -n "$current" ] && [ "$current" = "$latest_norm" ] && available="no"

	set_app_cfg "current_version" "$current"
	set_app_cfg "latest_version" "$latest"
	set_app_cfg "download_url" "$APK_URL"
	set_app_cfg "update_available" "$available"
	mark_result "check" "pass"

	printf '当前版本：%s\n' "${current:-未知}"
	printf '最新版本：%s\n' "$latest"
	printf '下载地址：%s\n' "$APK_URL"
	if [ "$available" = "yes" ]; then
		printf '发现可用更新\n'
	else
		printf '已经是最新版本\n'
	fi
}

schedule_luci_restart() {
	(
		sleep 2
		rm -rf /tmp/luci-indexcache /tmp/luci-modulecache
		/etc/init.d/rpcd restart >/dev/null 2>&1 || true
		/etc/init.d/uhttpd restart >/dev/null 2>&1 || true
	) >/dev/null 2>&1 &
}

update_app() {
	local current latest latest_norm installed

	if ! command -v apk >/dev/null 2>&1; then
		mark_result "update" "fail: apk"
		log "当前系统没有 apk 命令，无法安装 SingBox Lite APK"
		return 1
	fi

	check_update || return 1

	current="$(uci -q get singboxlite.app.current_version || true)"
	latest="$(uci -q get singboxlite.app.latest_version || true)"
	latest_norm="$(normalize_version "$latest")"

	if [ -n "$current" ] && [ "$current" = "$latest_norm" ]; then
		mark_result "update" "pass: already-latest"
		printf 'SingBox Lite 已经是最新版本：%s\n' "$current"
		return 0
	fi

	mkdir -p "$TMP_DIR"
	log "download app apk: $APK_URL"
	fetch_url "$APK_URL" "$APK_FILE" >> "$LOG_FILE" 2>&1 || {
		mark_result "update" "fail: download"
		log "SingBox Lite APK 下载失败"
		return 1
	}

	if [ ! -s "$APK_FILE" ]; then
		mark_result "update" "fail: empty"
		log "SingBox Lite APK 为空"
		return 1
	fi

	log "install app apk"
	SINGBOXLITE_SKIP_RESTART=1 apk add --allow-untrusted "$APK_FILE" >> "$LOG_FILE" 2>&1 || {
		mark_result "update" "fail: install"
		log "SingBox Lite APK 安装失败"
		return 1
	}

	installed="$(current_version)"
	set_app_cfg "current_version" "$installed"
	set_app_cfg "latest_version" "$latest"
	set_app_cfg "download_url" "$APK_URL"
	set_app_cfg "update_available" "no"
	mark_result "update" "pass"
	rm -f "$APK_FILE"
	schedule_luci_restart

	printf 'SingBox Lite 已更新到：%s\n' "${installed:-$latest}"
	printf 'LuCI 服务将在几秒后自动重启，请稍后刷新页面。\n'
}

case "${1:-check}" in
	check)
		check_update
		;;
	update)
		update_app
		;;
	*)
		printf 'Usage: %s {check|update}\n' "$0" >&2
		exit 1
		;;
esac
