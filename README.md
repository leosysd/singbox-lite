# luci-app-singbox-lite

SingBox Lite 是一个面向 OpenWrt 的轻量 LuCI App，用来安全导入和管理 sing-box JSON 配置。

它不做复杂代理面板，围绕三个核心场景：

1. 导入本地 sing-box JSON 配置。
2. 导入远程 URL sing-box JSON 配置。
3. 选择运行模式，尤其是 `sing-box + mosdns`。

## 功能

- 显示 sing-box / MosDNS 运行状态。
- 上传本地 JSON 到临时路径并检查。
- 拉取远程 JSON 到临时路径并检查。
- 执行 `sing-box check` 后才允许应用配置。
- 应用前自动备份 `/etc/sing-box/config.json`。
- 支持 `sing-box` 与 `sing-box + mosdns` 两种运行模式。
- `sing-box` 模式应用原始 JSON，卸载 DNS DNAT 清理脚本，并停止 MosDNS。
- `sing-box + mosdns` 模式会改写导入 JSON 的 `dns.servers` / `dns.rules`，让 sing-box DNS 指向 `127.0.0.1:5335`，并安装执行 DNS DNAT 清理脚本。
- 支持重启 sing-box 和 MosDNS。
- 支持删除 SingBox Lite 自动创建的配置备份。
- 支持查看、筛选、清理 sing-box 日志。
- 支持写入每天清理日志的 cron。
- 支持保存远程配置自动更新时间。

## 默认路径

```text
sing-box 程序：/usr/bin/sing-box
sing-box 服务：/etc/init.d/sing-box
sing-box 配置：/etc/sing-box/config.json
sing-box 日志：/etc/sing-box/sing-box.log
MosDNS 服务：/etc/init.d/mosdns
MosDNS 地址：127.0.0.1:5335
```

## 页面

```text
服务 -> SingBox Lite -> 总览
所有常用设置都在总览第一页。
```

## 安全应用流程

```text
sing-box 模式：
导入本地 JSON 或下载远程 JSON
执行 sing-box check -c 原始 JSON
卸载 /usr/bin/sing-box-disable-dns-hijack
停止 MosDNS
备份旧配置
应用原始 JSON
重启 sing-box
再次停止 MosDNS

sing-box + mosdns 模式：
导入本地 JSON 或下载远程 JSON
生成 MosDNS 模式临时 JSON
修改 dns.servers / dns.rules 指向 127.0.0.1:5335
执行 sing-box check -c 处理后的 JSON
安装 /usr/bin/sing-box-disable-dns-hijack
重启 MosDNS
备份旧配置
应用处理后的 JSON
重启 sing-box
执行 DNS DNAT 清理脚本
```

检查失败时不会覆盖正式配置。

## 开发原则

每次修改先在本地完成，再上传到 `leosysd/singbox-lite` 仓库。
