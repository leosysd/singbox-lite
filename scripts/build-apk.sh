#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_NAME="luci-app-singbox-lite"
PKG_VERSION="$(awk -F':=' '/^PKG_VERSION:=/ { print $2 }' "$ROOT_DIR/Makefile")"
PKG_RELEASE="$(awk -F':=' '/^PKG_RELEASE:=/ { print $2 }' "$ROOT_DIR/Makefile")"
PKG_FILE="${PKG_NAME}-${PKG_VERSION}-r${PKG_RELEASE}.apk"
OUT_DIR="$ROOT_DIR/dist"
WORK_DIR="${WORK_DIR:-/tmp/${PKG_NAME}-build}"
BUILD_ROOT="$WORK_DIR/root"
SCRIPT_DIR="$WORK_DIR/scripts"
SDK_DIR="${OPENWRT_SDK_DIR:-}"
SDK_URL="${OPENWRT_SDK_URL:-}"

download_sdk() {
	local sdk_archive="$WORK_DIR/openwrt-sdk.tar.zst"
	local sdk_base_url="https://downloads.openwrt.org/snapshots/targets/x86/64"

	mkdir -p "$WORK_DIR"

	if [ -z "$SDK_URL" ]; then
		SDK_URL="$sdk_base_url/$(curl -fsSL "$sdk_base_url/" | sed -n 's/.*href="\(openwrt-sdk-x86-64[^"]*Linux-x86_64\.tar\.zst\)".*/\1/p' | tail -n 1)"
	fi

	if [ "$SDK_URL" = "$sdk_base_url/" ]; then
		echo "Unable to discover OpenWrt SDK URL" >&2
		exit 1
	fi

	curl -fL "$SDK_URL" -o "$sdk_archive"
	tar --zstd -xf "$sdk_archive" -C "$WORK_DIR"
	SDK_DIR="$(find "$WORK_DIR" -maxdepth 1 -type d -name 'openwrt-sdk-*' | head -n 1)"
}

prepare_sdk() {
	if [ -z "$SDK_DIR" ]; then
		download_sdk
	fi

	if [ ! -x "$SDK_DIR/staging_dir/host/bin/apk" ]; then
		echo "OpenWrt SDK apk tool not found in $SDK_DIR" >&2
		exit 1
	fi

	if [ ! -x "$SDK_DIR/staging_dir/host/bin/fakeroot" ]; then
		echo "OpenWrt SDK fakeroot not found in $SDK_DIR" >&2
		exit 1
	fi

	if [ ! -f "$SDK_DIR/private-key.pem" ]; then
		echo "OpenWrt SDK private-key.pem not found in $SDK_DIR" >&2
		exit 1
	fi
}

prepare_post_install() {
	mkdir -p "$SCRIPT_DIR"

	cat > "$SCRIPT_DIR/post-install" <<'POSTINSTALL'
#!/bin/sh
[ -n "$IPKG_INSTROOT" ] && exit 0
uci -q get singboxlite.ruleset >/dev/null || uci -q set singboxlite.ruleset='ruleset'
uci -q get singboxlite.ruleset.repo_raw >/dev/null || uci -q set singboxlite.ruleset.repo_raw='https://raw.githubusercontent.com/leosysd/ruleset/main/dist'
uci -q get singboxlite.ruleset.singbox_dir >/dev/null || uci -q set singboxlite.ruleset.singbox_dir='/etc/sing-box/rule-set'
uci -q get singboxlite.ruleset.mosdns_dir >/dev/null || uci -q set singboxlite.ruleset.mosdns_dir='/etc/mosdns/rule'
uci -q get singboxlite.ruleset.auto_update >/dev/null || uci -q set singboxlite.ruleset.auto_update='1'
uci -q get singboxlite.ruleset.update_time >/dev/null || uci -q set singboxlite.ruleset.update_time='07:45'
uci -q get singboxlite.ruleset.update_weekday >/dev/null || uci -q set singboxlite.ruleset.update_weekday='2'
uci -q get singboxlite.ruleset.restart_singbox >/dev/null || uci -q set singboxlite.ruleset.restart_singbox='0'
uci -q get singboxlite.ruleset.restart_mosdns >/dev/null || uci -q set singboxlite.ruleset.restart_mosdns='0'
mkdir -p /etc/sing-box/singboxlite
uci -q set singboxlite.main.temp_dir='/etc/sing-box/singboxlite'
uci -q set singboxlite.main.source_path='/etc/sing-box/singboxlite/source.json'
[ -f /etc/sing-box/config.json ] && cp -p /etc/sing-box/config.json /etc/sing-box/singboxlite/source.json
[ -f /etc/sing-box/singboxlite-source.json ] && rm -f /etc/sing-box/singboxlite-source.json
rm -rf /tmp/singboxlite
rm -f /etc/sing-box/config.json.bak-singboxlite-*
uci -q commit singboxlite
rm -f /www/luci-static/resources/view/singboxlite/import.js /www/luci-static/resources/view/singboxlite/mode.js
/etc/init.d/rpcd restart >/dev/null 2>&1 || true
/etc/init.d/uhttpd restart >/dev/null 2>&1 || true
exit 0
POSTINSTALL

	chmod 0755 "$SCRIPT_DIR/post-install"
}

prepare_root() {
	rm -rf "$BUILD_ROOT"
	mkdir -p "$BUILD_ROOT"
	cp -a "$ROOT_DIR/root/." "$BUILD_ROOT/"

	find "$BUILD_ROOT" -type d -exec chmod 0755 {} +
	find "$BUILD_ROOT" -type f -exec chmod 0644 {} +
	find "$BUILD_ROOT" -type f \( -name '*.sh' -o -name '*.uc' -o -path '*/usr/share/rpcd/ucode/*' \) -exec chmod 0755 {} +
	[ -f "$BUILD_ROOT/etc/config/singboxlite" ] && chmod 0600 "$BUILD_ROOT/etc/config/singboxlite"

	mkdir -p "$BUILD_ROOT/lib/apk/packages"
	printf '/etc/config/singboxlite\n' > "$BUILD_ROOT/lib/apk/packages/${PKG_NAME}.conffiles"
	sha256sum "$BUILD_ROOT/etc/config/singboxlite" | awk '{print $1 "  /etc/config/singboxlite"}' > "$BUILD_ROOT/lib/apk/packages/${PKG_NAME}.conffiles_static"
	(cd "$BUILD_ROOT" && find . -type f | sed 's#^\.##' | sort) > "$BUILD_ROOT/lib/apk/packages/${PKG_NAME}.list"
}

build_package() {
	mkdir -p "$OUT_DIR"
	rm -f "$OUT_DIR/$PKG_FILE"

	STAGING_DIR_HOST="$SDK_DIR/staging_dir/host" "$SDK_DIR/staging_dir/host/bin/fakeroot" "$SDK_DIR/staging_dir/host/bin/apk" mkpkg \
		--info "name:$PKG_NAME" \
		--info "version:${PKG_VERSION}-r${PKG_RELEASE}" \
		--info "description:Lightweight LuCI app for safely importing and managing sing-box JSON configs." \
		--info "arch:noarch" \
		--info "license:MIT" \
		--info "origin:feeds/base/$PKG_NAME" \
		--info "maintainer:Codex" \
		--info "url:https://github.com/leosysd/singbox-lite" \
		--info "provides:${PKG_NAME}-any" \
		--info "depends:libc luci-base rpcd rpcd-mod-ucode sing-box ucode" \
		--script "post-install:$SCRIPT_DIR/post-install" \
		--script "post-upgrade:$SCRIPT_DIR/post-install" \
		--files "$BUILD_ROOT" \
		--sign "$SDK_DIR/private-key.pem" \
		--output "$OUT_DIR/$PKG_FILE"
}

verify_package() {
	local extract_dir="$WORK_DIR/extract"

	rm -rf "$extract_dir"
	mkdir -p "$extract_dir"
	STAGING_DIR_HOST="$SDK_DIR/staging_dir/host" "$SDK_DIR/staging_dir/host/bin/apk" extract --allow-untrusted --destination "$extract_dir" --no-chown "$OUT_DIR/$PKG_FILE" >/dev/null

	test -x "$extract_dir/usr/share/singboxlite/prepare-mosdns-config.uc"
	test -x "$extract_dir/usr/share/singboxlite/prepare-singbox-config.uc"
	test -x "$extract_dir/usr/share/rpcd/ucode/luci.singboxlite"
	STAGING_DIR_HOST="$SDK_DIR/staging_dir/host" "$SDK_DIR/staging_dir/host/bin/apk" adbdump "$OUT_DIR/$PKG_FILE" | grep -q "post-install"
}

prepare_sdk
prepare_post_install
prepare_root
build_package
verify_package

echo "$OUT_DIR/$PKG_FILE"
