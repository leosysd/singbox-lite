include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-singbox-lite
PKG_VERSION:=0.1.0
PKG_RELEASE:=16
PKG_LICENSE:=MIT
PKG_MAINTAINER:=Codex
PKGARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-singbox-lite
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=SingBox Lite
  DEPENDS:=+luci-base +rpcd +rpcd-mod-ucode +ucode +sing-box
  PKGARCH:=all
endef

define Package/luci-app-singbox-lite/description
 Lightweight LuCI app for safely importing and managing sing-box JSON configs.
endef

define Build/Compile
endef

define Package/luci-app-singbox-lite/conffiles
/etc/config/singboxlite
endef

define Package/luci-app-singbox-lite/postinst
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] && exit 0
uci -q get singboxlite.ruleset >/dev/null || uci -q set singboxlite.ruleset='ruleset'
uci -q get singboxlite.ruleset.repo_raw >/dev/null || uci -q set singboxlite.ruleset.repo_raw='https://raw.githubusercontent.com/leosysd/ruleset/main/dist'
uci -q get singboxlite.ruleset.singbox_dir >/dev/null || uci -q set singboxlite.ruleset.singbox_dir='/etc/sing-box/rule-set'
uci -q get singboxlite.ruleset.mosdns_dir >/dev/null || uci -q set singboxlite.ruleset.mosdns_dir='/etc/mosdns/rule'
uci -q get singboxlite.ruleset.auto_update >/dev/null || uci -q set singboxlite.ruleset.auto_update='1'
uci -q get singboxlite.ruleset.update_time >/dev/null || uci -q set singboxlite.ruleset.update_time='07:45'
uci -q get singboxlite.ruleset.update_weekday >/dev/null || uci -q set singboxlite.ruleset.update_weekday='2'
uci -q get singboxlite.ruleset.restart_singbox >/dev/null || uci -q set singboxlite.ruleset.restart_singbox='0'
uci -q get singboxlite.ruleset.restart_mosdns >/dev/null || uci -q set singboxlite.ruleset.restart_mosdns='1'
uci -q get singboxlite.core >/dev/null || uci -q set singboxlite.core='core'
uci -q get singboxlite.core.include_prerelease >/dev/null || uci -q set singboxlite.core.include_prerelease='0'
uci -q get singboxlite.log.auto_refresh >/dev/null || uci -q set singboxlite.log.auto_refresh='0'
mkdir -p /etc/sing-box/singboxlite
uci -q set singboxlite.main.temp_dir='/etc/sing-box/singboxlite'
uci -q set singboxlite.main.source_path='/etc/sing-box/singboxlite/source.json'
[ ! -f /etc/sing-box/singboxlite/source.json ] && [ -f /etc/sing-box/config.json ] && cp -p /etc/sing-box/config.json /etc/sing-box/singboxlite/source.json
[ -f /etc/sing-box/singboxlite-source.json ] && rm -f /etc/sing-box/singboxlite-source.json
rm -rf /tmp/singboxlite
rm -f /etc/sing-box/config.json.bak-singboxlite-*
uci -q commit singboxlite
rm -f /www/luci-static/resources/view/singboxlite/import.js /www/luci-static/resources/view/singboxlite/mode.js
/etc/init.d/rpcd restart >/dev/null 2>&1 || true
/etc/init.d/uhttpd restart >/dev/null 2>&1 || true
exit 0
endef

define Package/luci-app-singbox-lite/install
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./root/etc/config/singboxlite $(1)/etc/config/singboxlite

	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-singbox-lite.json $(1)/usr/share/luci/menu.d/luci-app-singbox-lite.json

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-singbox-lite.json $(1)/usr/share/rpcd/acl.d/luci-app-singbox-lite.json

	$(INSTALL_DIR) $(1)/usr/share/rpcd/ucode
	$(INSTALL_BIN) ./root/usr/share/rpcd/ucode/luci.singboxlite $(1)/usr/share/rpcd/ucode/luci.singboxlite

	$(INSTALL_DIR) $(1)/usr/share/singboxlite
	$(INSTALL_BIN) ./root/usr/share/singboxlite/auto-update.sh $(1)/usr/share/singboxlite/auto-update.sh
	$(INSTALL_BIN) ./root/usr/share/singboxlite/prepare-mosdns-config.uc $(1)/usr/share/singboxlite/prepare-mosdns-config.uc
	$(INSTALL_BIN) ./root/usr/share/singboxlite/prepare-singbox-config.uc $(1)/usr/share/singboxlite/prepare-singbox-config.uc
	$(INSTALL_BIN) ./root/usr/share/singboxlite/sing-box-disable-dns-hijack.sh $(1)/usr/share/singboxlite/sing-box-disable-dns-hijack.sh
	$(INSTALL_BIN) ./root/usr/share/singboxlite/update-geosite-rules.sh $(1)/usr/share/singboxlite/update-geosite-rules.sh
	$(INSTALL_BIN) ./root/usr/share/singboxlite/update-singbox-core.sh $(1)/usr/share/singboxlite/update-singbox-core.sh

	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/singboxlite
	$(INSTALL_DATA) ./root/www/luci-static/resources/view/singboxlite/overview.js $(1)/www/luci-static/resources/view/singboxlite/overview.js
	$(INSTALL_DATA) ./root/www/luci-static/resources/view/singboxlite/ruleset.js $(1)/www/luci-static/resources/view/singboxlite/ruleset.js
	$(INSTALL_DATA) ./root/www/luci-static/resources/view/singboxlite/logs.js $(1)/www/luci-static/resources/view/singboxlite/logs.js
endef

$(eval $(call BuildPackage,luci-app-singbox-lite))
