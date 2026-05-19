#!/bin/sh

ACTION="${1:-check}"
INCLUDE_PRE="${2:-0}"
TMP_DIR="/tmp/singboxlite-core"
LOG_FILE="/tmp/singboxlite-core.log"
BIN="/usr/bin/sing-box"
API_STABLE="https://api.github.com/repos/SagerNet/sing-box/releases/latest"
API_ALL="https://api.github.com/repos/SagerNet/sing-box/releases?per_page=1"

mkdir -p "$TMP_DIR"

log() {
	local line
	line="$(date '+%Y-%m-%d %H:%M:%S') [singboxlite-core] $*"
	echo "$line" >> "$LOG_FILE"
	echo "$line"
}

fetch_url() {
	local url="$1"
	local out="$2"

	if command -v uclient-fetch >/dev/null 2>&1; then
		uclient-fetch -T 45 -O "$out" "$url"
	elif command -v wget >/dev/null 2>&1; then
		wget -T 45 -O "$out" "$url"
	elif command -v curl >/dev/null 2>&1; then
		curl -L --connect-timeout 45 --max-time 120 -o "$out" "$url"
	else
		return 127
	fi
}

current_version() {
	[ -x "$BIN" ] || return 0
	"$BIN" version 2>/dev/null | head -n 1 | sed 's/^sing-box version //;s/^sing-box //'
}

detect_arch() {
	case "$(uname -m)" in
		x86_64|amd64) echo "amd64" ;;
		i386|i486|i586|i686) echo "386" ;;
		aarch64|arm64) echo "arm64" ;;
		armv7l|armv7*) echo "armv7" ;;
		armv6l|armv6*) echo "armv6" ;;
		armv5l|armv5*) echo "armv5" ;;
		mips64el|mips64le) echo "mips64le" ;;
		mips64) echo "mips64" ;;
		mipsel|mipsle) echo "mipsle-softfloat" ;;
		mips) echo "mips-softfloat" ;;
		riscv64) echo "riscv64" ;;
		s390x) echo "s390x" ;;
		*) echo "" ;;
	esac
}

api_url() {
	[ "$INCLUDE_PRE" = "1" ] && echo "$API_ALL" || echo "$API_STABLE"
}

latest_version() {
	local meta="$TMP_DIR/release.json"
	local api

	api="$(api_url)"
	rm -f "$meta"
	fetch_url "$api" "$meta" >/dev/null 2>&1 || return 1
	sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' "$meta" | head -n 1
}

save_core_state() {
	local latest="$1"
	local result="$2"
	local arch="$3"
	local url="$4"

	uci -q set singboxlite.core='core'
	uci -q set singboxlite.core.include_prerelease="$INCLUDE_PRE"
	uci -q set singboxlite.core.latest_version="$latest"
	uci -q set singboxlite.core.last_check_time="$(date '+%Y-%m-%d %H:%M:%S')"
	uci -q set singboxlite.core.last_check_result="$result"
	uci -q set singboxlite.core.arch="$arch"
	uci -q set singboxlite.core.download_url="$url"
	uci -q commit singboxlite
}

check_update() {
	local arch latest current url

	arch="$(detect_arch)"
	current="$(current_version)"
	if [ -z "$arch" ]; then
		save_core_state "" "fail" "" ""
		log "无法识别当前架构：$(uname -m)"
		return 1
	fi

	latest="$(latest_version)"
	if [ -z "$latest" ]; then
		save_core_state "" "fail" "$arch" ""
		log "无法获取 sing-box 最新版本"
		return 1
	fi

	url="https://github.com/SagerNet/sing-box/releases/download/v${latest}/sing-box-${latest}-linux-${arch}.tar.gz"
	save_core_state "$latest" "pass" "$arch" "$url"

	log "当前版本：${current:-未知}"
	log "最新版本：$latest"
	log "目标架构：linux-$arch"
	log "下载地址：$url"

	[ "$current" = "$latest" ] && log "当前已经是目标版本"
	return 0
}

find_new_binary() {
	find "$TMP_DIR/extract" -type f -name sing-box 2>/dev/null | head -n 1
}

update_core() {
	local arch latest current url archive newbin newver copied running status_res

	check_update || return 1

	arch="$(uci -q get singboxlite.core.arch)"
	latest="$(uci -q get singboxlite.core.latest_version)"
	url="$(uci -q get singboxlite.core.download_url)"
	current="$(current_version)"

	if [ -n "$current" ] && [ "$current" = "$latest" ]; then
		uci -q set singboxlite.core.last_update_time="$(date '+%Y-%m-%d %H:%M:%S')"
		uci -q set singboxlite.core.last_update_result='pass'
		uci -q commit singboxlite
		log "当前已经是 $latest，跳过替换"
		return 0
	fi

	archive="$TMP_DIR/sing-box-${latest}-linux-${arch}.tar.gz"
	rm -rf "$TMP_DIR/extract" "$archive" "$TMP_DIR/sing-box.new"
	mkdir -p "$TMP_DIR/extract"

	log "开始下载核心：$url"
	fetch_url "$url" "$archive" >> "$LOG_FILE" 2>&1 || {
		uci -q set singboxlite.core.last_update_time="$(date '+%Y-%m-%d %H:%M:%S')"
		uci -q set singboxlite.core.last_update_result='fail'
		uci -q commit singboxlite
		log "核心下载失败"
		return 1
	}

	tar -xzf "$archive" -C "$TMP_DIR/extract" >> "$LOG_FILE" 2>&1 || {
		uci -q set singboxlite.core.last_update_time="$(date '+%Y-%m-%d %H:%M:%S')"
		uci -q set singboxlite.core.last_update_result='fail'
		uci -q commit singboxlite
		log "核心解压失败"
		return 1
	}

	newbin="$(find_new_binary)"
	if [ -z "$newbin" ] || [ ! -f "$newbin" ]; then
		uci -q set singboxlite.core.last_update_time="$(date '+%Y-%m-%d %H:%M:%S')"
		uci -q set singboxlite.core.last_update_result='fail'
		uci -q commit singboxlite
		log "压缩包内没有找到 sing-box 二进制"
		return 1
	fi

	chmod 0755 "$newbin"
	newver="$("$newbin" version 2>/dev/null | head -n 1 | sed 's/^sing-box version //;s/^sing-box //')"
	if [ -z "$newver" ]; then
		uci -q set singboxlite.core.last_update_time="$(date '+%Y-%m-%d %H:%M:%S')"
		uci -q set singboxlite.core.last_update_result='fail'
		uci -q commit singboxlite
		log "下载的新核心无法运行，停止替换"
		return 1
	fi

	log "新核心版本：$newver"

	if [ -f /etc/sing-box/config.json ]; then
		"$newbin" check -c /etc/sing-box/config.json >> "$LOG_FILE" 2>&1 || {
			uci -q set singboxlite.core.last_update_time="$(date '+%Y-%m-%d %H:%M:%S')"
			uci -q set singboxlite.core.last_update_result='fail'
			uci -q commit singboxlite
			log "新核心检查当前配置失败，停止替换"
			return 1
		}
	fi

	cp "$newbin" /usr/bin/sing-box.new && chmod 0755 /usr/bin/sing-box.new && /usr/bin/sing-box.new version >/dev/null 2>&1
	copied=$?
	if [ "$copied" -ne 0 ]; then
		rm -f /usr/bin/sing-box.new
		uci -q set singboxlite.core.last_update_time="$(date '+%Y-%m-%d %H:%M:%S')"
		uci -q set singboxlite.core.last_update_result='fail'
		uci -q commit singboxlite
		log "写入临时核心失败，未替换正式文件"
		return 1
	fi

	/etc/init.d/sing-box status >/dev/null 2>&1 && running=1 || running=0
	mv -f /usr/bin/sing-box.new "$BIN" && chmod 0755 "$BIN" || {
		rm -f /usr/bin/sing-box.new
		uci -q set singboxlite.core.last_update_time="$(date '+%Y-%m-%d %H:%M:%S')"
		uci -q set singboxlite.core.last_update_result='fail'
		uci -q commit singboxlite
		log "替换 /usr/bin/sing-box 失败"
		return 1
	}

	log "核心已替换为 $newver，等待 10 秒后重启 sing-box"
	sleep 10
	/etc/init.d/sing-box restart >> "$LOG_FILE" 2>&1
	status_res=$?
	sleep 2
	/etc/init.d/sing-box status >/dev/null 2>&1 || status_res=1

	if [ "$status_res" -ne 0 ]; then
		uci -q set singboxlite.core.last_update_time="$(date '+%Y-%m-%d %H:%M:%S')"
		uci -q set singboxlite.core.last_update_result='fail'
		uci -q commit singboxlite
		log "核心已替换，但 sing-box 重启失败"
		return 1
	fi

	uci -q set singboxlite.core.last_update_time="$(date '+%Y-%m-%d %H:%M:%S')"
	uci -q set singboxlite.core.last_update_result='pass'
	uci -q set singboxlite.core.latest_version="$newver"
	uci -q commit singboxlite
	log "核心更新完成，sing-box 已重启"
	return 0
}

case "$ACTION" in
	check)
		check_update
		;;
	update)
		update_core
		;;
	clear-log)
		: > "$LOG_FILE"
		echo "核心更新日志已清理"
		;;
	*)
		echo "Usage: $0 {check|update|clear-log} [include_prerelease:0|1]"
		exit 2
		;;
esac
