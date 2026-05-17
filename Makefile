include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-singbox-lite
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
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
	$(INSTALL_BIN) ./root/usr/share/singboxlite/sing-box-disable-dns-hijack.sh $(1)/usr/share/singboxlite/sing-box-disable-dns-hijack.sh

	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/singboxlite
	$(INSTALL_DATA) ./root/www/luci-static/resources/view/singboxlite/overview.js $(1)/www/luci-static/resources/view/singboxlite/overview.js
	$(INSTALL_DATA) ./root/www/luci-static/resources/view/singboxlite/import.js $(1)/www/luci-static/resources/view/singboxlite/import.js
	$(INSTALL_DATA) ./root/www/luci-static/resources/view/singboxlite/mode.js $(1)/www/luci-static/resources/view/singboxlite/mode.js
	$(INSTALL_DATA) ./root/www/luci-static/resources/view/singboxlite/logs.js $(1)/www/luci-static/resources/view/singboxlite/logs.js
endef

$(eval $(call BuildPackage,luci-app-singbox-lite))
