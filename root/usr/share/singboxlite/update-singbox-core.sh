#!/bin/sh

ACTION="${1:-check}"
INCLUDE_PRE="${2:-0}"
TMP_DIR="/tmp/singboxlite-core"
LOG_FILE="/tmp/singboxlite-core.log"
BIN="/usr/bin/sing-box"
API_STABLE="https://api.github.com/repos/SagerNet/sing-box/releases/latest"
API_ALL="https://api.github.com/repos/SagerNet/sing-box/releases?per_page=20"

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

	if command -v curl >/dev/null 2>&1; then
		curl -fL --connect-timeout 45 --max-time 180 -o "$out" "$url"
	elif command -v wget >/dev/null 2>&1; then
		wget -T 45 -O "$out" "$url"
	elif command -v uclient-fetch >/dev/null 2>&1; then
		uclient-fetch -T 45 -O "$out" "$url"
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
		x86_64|amd64) echo "x86_64" ;;
		i386|i486|i586|i686) echo "x86" ;;
		aarch64|arm64) echo "aarch64" ;;
		armv7l|armv7*) echo "armv7" ;;
		riscv64) echo "riscv64" ;;
		loongarch64) echo "loongarch64" ;;
		*) echo "" ;;
	esac
}

api_url() {
	[ "$INCLUDE_PRE" = "1" ] && echo "$API_ALL" || echo "$API_STABLE"
}

release_meta_path() {
	echo "$TMP_DIR/release.json"
}

save_core_state() {
	local latest="$1"
	local result="$2"
	local arch="$3"
	local url="$4"
	local stage="${5:-}"

	uci -q set singboxlite.core='core'
	uci -q set singboxlite.core.include_prerelease="$INCLUDE_PRE"
	uci -q set singboxlite.core.latest_version="$latest"
	uci -q set singboxlite.core.last_check_time="$(date '+%Y-%m-%d %H:%M:%S')"
	uci -q set singboxlite.core.last_check_result="$result"
	uci -q set singboxlite.core.arch="$arch"
	uci -q set singboxlite.core.download_url="$url"
	[ -n "$stage" ] && uci -q set singboxlite.core.last_stage="$stage"
	uci -q commit singboxlite
}

release_tag_from_meta() {
	local meta="$1"
	sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' "$meta" | head -n 1
}

apk_url_from_meta() {
	local meta="$1"
	local arch="$2"

	sed -n 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\([^"]*sing-box_[^"]*_openwrt_'"$arch"'\.apk\)".*/\1/p' "$meta" | head -n 1
}

apk_version_from_url() {
	local url="$1"
	basename "$url" | sed -n 's/^sing-box_\([^_]*\)_openwrt_.*/\1/p'
}

list_apk_assets() {
	local meta="$1"
	sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\(sing-box_[^"]*_openwrt_[^"]*\.apk\)".*/\1/p' "$meta" | tr '\n' ' '
}

load_release_meta() {
	local meta
	meta="$(release_meta_path)"
	rm -f "$meta"
	fetch_url "$(api_url)" "$meta" >> "$LOG_FILE" 2>&1 || return 1
	[ -s "$meta" ] || return 1
	echo "$meta"
}

resolve_release() {
	local arch="$1"
	local meta latest url listed

	meta="$(load_release_meta)" || return 1
	latest="$(release_tag_from_meta "$meta")"
	url="$(apk_url_from_meta "$meta" "$arch")"

	if [ -z "$latest" ]; then
		log "无法从 GitHub Release API 解析版本号"
		return 1
	fi

	if [ -z "$url" ]; then
		listed="$(list_apk_assets "$meta")"
		log "未找到匹配 openwrt-$arch 的 GitHub APK 资源"
		[ -n "$listed" ] && log "可见 APK 资源：$listed"
		return 1
	fi

	printf '%s\n%s\n' "$latest" "$url"
}

check_update() {
	local arch current resolved latest url apkver

	arch="$(detect_arch)"
	current="$(current_version)"
	if [ -z "$arch" ]; then
		save_core_state "" "fail" "" "" "arch"
		log "无法识别当前架构：$(uname -m)"
		return 1
	fi

	resolved="$(resolve_release "$arch")" || {
		save_core_state "" "fail" "$arch" "" "release"
		log "无法获取 sing-box GitHub APK 更新信息"
		return 1
	}

	latest="$(printf '%s\n' "$resolved" | sed -n '1p')"
	url="$(printf '%s\n' "$resolved" | sed -n '2p')"
	apkver="$(apk_version_from_url "$url")"
	[ -n "$apkver" ] && latest="$apkver"

	save_core_state "$latest" "pass" "$arch" "$url" "check"

	log "当前版本：${current:-未知}"
	log "目标版本：$latest"
	log "目标架构：openwrt-$arch"
	log "GitHub APK：$url"

	[ "$current" = "$latest" ] && log "当前已经是目标版本"
	return 0
}

mark_update_result() {
	local result="$1"
	local stage="$2"
	uci -q set singboxlite.core.last_update_time="$(date '+%Y-%m-%d %H:%M:%S')"
	uci -q set singboxlite.core.last_update_result="$result"
	uci -q set singboxlite.core.last_stage="$stage"
	uci -q commit singboxlite
}

validate_downloaded_apk() {
	local apk_file="$1"

	[ -s "$apk_file" ] || {
		log "下载的 APK 文件为空"
		return 1
	}

	if head -c 128 "$apk_file" 2>/dev/null | grep -qi '<html\|<!doctype\|{"message"'; then
		log "下载结果看起来不是 APK 包，可能是 GitHub 错误页"
		return 1
	fi

	return 0
}

install_apk() {
	local apk_file="$1"

	if ! command -v apk >/dev/null 2>&1; then
		log "当前系统没有 apk 命令，无法安装 GitHub APK 包"
		return 1
	fi

	apk add --allow-untrusted "$apk_file" >> "$LOG_FILE" 2>&1
}

stop_singbox_for_update() {
	if [ ! -x /etc/init.d/sing-box ]; then
		log "未找到 /etc/init.d/sing-box，无法停止服务"
		return 1
	fi

	log "停止 sing-box 服务"
	/etc/init.d/sing-box stop >> "$LOG_FILE" 2>&1 || return 1
	sleep 1
	if /etc/init.d/sing-box status >/dev/null 2>&1; then
		log "sing-box 停止后仍在运行"
		return 1
	fi

	return 0
}

start_singbox_after_update() {
	if [ ! -x /etc/init.d/sing-box ]; then
		log "未找到 /etc/init.d/sing-box，无法启动服务"
		return 1
	fi

	log "启动 sing-box 服务"
	/etc/init.d/sing-box start >> "$LOG_FILE" 2>&1 || return 1
	sleep 2
	/etc/init.d/sing-box status >/dev/null 2>&1
}

update_core() {
	local latest current url apk_file newver

	check_update || return 1

	latest="$(uci -q get singboxlite.core.latest_version)"
	url="$(uci -q get singboxlite.core.download_url)"
	current="$(current_version)"

	if [ -n "$current" ] && [ "$current" = "$latest" ]; then
		mark_update_result "pass" "same-version"
		log "当前已经是 $latest，跳过安装"
		return 0
	fi

	apk_file="$TMP_DIR/sing-box-${latest}.apk"
	rm -f "$apk_file"

	log "开始下载 GitHub APK：$url"
	fetch_url "$url" "$apk_file" >> "$LOG_FILE" 2>&1 || {
		mark_update_result "fail" "download"
		log "核心 APK 下载失败"
		return 1
	}

	validate_downloaded_apk "$apk_file" || {
		mark_update_result "fail" "download-check"
		return 1
	}

	stop_singbox_for_update || {
		mark_update_result "fail" "stop"
		log "更新前停止 sing-box 失败"
		return 1
	}

	log "开始安装核心 APK"
	install_apk "$apk_file" || {
		mark_update_result "fail" "install"
		log "核心 APK 安装失败"
		start_singbox_after_update >/dev/null 2>&1 || true
		return 1
	}
	rm -f "$apk_file"

	newver="$(current_version)"
	if [ -z "$newver" ]; then
		mark_update_result "fail" "version"
		log "安装后无法读取 sing-box 版本"
		start_singbox_after_update >/dev/null 2>&1 || true
		return 1
	fi

	log "已安装核心版本：$newver"

	if [ -f /etc/sing-box/config.json ]; then
		"$BIN" check -c /etc/sing-box/config.json >> "$LOG_FILE" 2>&1 || {
			mark_update_result "fail" "config-check"
			log "新核心检查当前配置失败"
			return 1
		}
	fi

	start_singbox_after_update || {
		mark_update_result "fail" "start"
		log "核心已安装，但 sing-box 启动失败"
		return 1
	}

	if [ -f /etc/sing-box/config.json ]; then
		"$BIN" check -c /etc/sing-box/config.json >> "$LOG_FILE" 2>&1 || {
			mark_update_result "fail" "post-start-config-check"
			log "启动后配置复检失败"
			return 1
		}
	fi

	uci -q set singboxlite.core.last_update_time="$(date '+%Y-%m-%d %H:%M:%S')"
	uci -q set singboxlite.core.last_update_result='pass'
	uci -q set singboxlite.core.latest_version="$newver"
	uci -q set singboxlite.core.last_stage='done'
	uci -q commit singboxlite
	log "核心更新完成"
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
