# luci-app-singbox-lite

SingBox Lite 是一个面向 OpenWrt 的轻量 LuCI App，用来安全导入和管理 sing-box JSON 配置。

它不做复杂代理面板，围绕三个核心场景：

1. 导入本地 sing-box JSON 配置。
2. 导入远程 URL sing-box JSON 配置。
3. 选择运行模式，尤其是 `sing-box + mosdns`。

## 功能

- 显示 sing-box / MosDNS 运行状态。
- 上传本地 JSON 到 `/etc/sing-box/singboxlite/` 并检查。
- 拉取远程 JSON 到 `/etc/sing-box/singboxlite/` 并检查。
- 生成待应用 JSON 后使用 `sing-box format -w -c` 做官方格式化。
- 执行 `sing-box check` 后才允许应用配置。
- 应用前自动备份 `/etc/sing-box/config.json`，只保留一个滚动备份。
- 支持 `sing-box` 与 `sing-box + mosdns` 两种运行模式。
- `sing-box` 模式应用原始 JSON，卸载 DNS DNAT 清理脚本，并停止 MosDNS。
- `sing-box + mosdns` 模式会改写导入 JSON 的 `dns.servers` / `dns.final`，让 sing-box DNS 指向 `127.0.0.1:5335`，移除导入配置里的 `hijack-dns` 规则，并安装执行 DNS DNAT 清理脚本。
- 支持重启 sing-box 和 MosDNS。
- 支持删除 SingBox Lite 自动创建的配置备份。
- 支持查看、筛选、清理 sing-box 日志。
- 支持写入每天清理日志的 cron。
- 支持保存远程配置自动更新时间。
- 内置 `leosysd/ruleset` 路由器侧规则更新能力。
- 支持自定义 sing-box 规则目录、MosDNS 规则目录和 dist 源地址。
- 支持每周定时拉取 6 个规则成品文件。

## 默认路径

```text
sing-box 程序：/usr/bin/sing-box
sing-box 服务：/etc/init.d/sing-box
sing-box 配置：/etc/sing-box/config.json
sing-box 日志：/etc/sing-box/sing-box.log
MosDNS 服务：/etc/init.d/mosdns
MosDNS 地址：127.0.0.1:5335
sing-box 规则目录：/etc/sing-box/rule-set
MosDNS 规则目录：/etc/mosdns/rule
规则集源：https://raw.githubusercontent.com/leosysd/ruleset/main/dist
SingBox Lite 源配置：/etc/sing-box/singboxlite/source.json
SingBox Lite 导入目录：/etc/sing-box/singboxlite
```

## 页面

```text
服务 -> SingBox Lite -> 总览
服务 -> SingBox Lite -> 规则集
服务 -> SingBox Lite -> 日志
```

总览负责导入、运行模式、远程配置和 MosDNS 联动。规则集放在第二页。日志中心放在第三页。

## 安全应用流程

```text
sing-box 模式：
导入本地 JSON 或下载远程 JSON
生成 sing-box 模式待应用 JSON
执行 sing-box format -w -c 待应用 JSON
执行 sing-box check -c 待应用 JSON
停止 sing-box，并确认已经停止
卸载 /usr/bin/sing-box-disable-dns-hijack（已不存在则跳过）
停止 MosDNS
确认 MosDNS 已经停止
清理 dnsmasq 指向 MosDNS 的上游设置
备份旧配置
应用待应用 JSON
启动 sing-box
清理导入/处理中间文件

sing-box + mosdns 模式：
导入本地 JSON 或下载远程 JSON
生成 MosDNS 模式待应用 JSON
修改 dns.servers / dns.final 指向 127.0.0.1:5335
移除 route.rules 中的 hijack-dns，避免 DNS 循环
执行 sing-box format -w -c 处理后的 JSON
执行 sing-box check -c 处理后的 JSON
停止 sing-box，并确认已经停止
安装 /usr/bin/sing-box-disable-dns-hijack（已安装则跳过）
启用 MosDNS 联动设置
备份旧配置
应用处理后的 JSON
启动 MosDNS，等待 3 秒并确认运行
启动 sing-box
执行 DNS DNAT 清理脚本
清理导入/处理中间文件
```

检查失败时不会覆盖正式配置。

## 规则集更新

App 内置 `/usr/share/singboxlite/update-geosite-rules.sh`，默认下载：

```text
/etc/sing-box/rule-set/direct-geosite.srs
/etc/sing-box/rule-set/proxy-geosite.srs
/etc/sing-box/rule-set/direct-geosite.json
/etc/sing-box/rule-set/proxy-geosite.json
/etc/mosdns/rule/direct-geosite.txt
/etc/mosdns/rule/proxy-geosite.txt
```

这些目录可以在 LuCI 第二页“规则集”区域修改。默认自动更新为每周二 07:45。

## 日志中心

第三页“日志”参考 GFSingBox 的日志中心结构，支持：

```text
Sing-box 日志
系统日志
软件日志
级别筛选
关键词搜索
自动刷新
原始日志查看
```

## 开发原则

每次修改先在本地完成，再上传到 `leosysd/singbox-lite` 仓库。
