# luci-app-singbox-lite

SingBox Lite 是一个面向 OpenWrt 的轻量 LuCI App，用来安全导入和管理 sing-box JSON 配置。

它不做复杂代理面板，第一版只围绕三个核心场景：

1. 导入本地 sing-box JSON 配置。
2. 导入远程 URL sing-box JSON 配置。
3. 选择运行模式，尤其是 `sing-box + mosdns`。

## 功能

- 显示 sing-box / MosDNS 运行状态。
- 上传本地 JSON 到临时路径并检查。
- 拉取远程 JSON 到临时路径并检查。
- 执行 `sing-box check` 后才允许应用配置。
- 应用前自动备份 `/etc/sing-box/config.json`。
- 支持重启 sing-box 和 MosDNS。
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
服务 -> SingBox Lite -> 配置导入
服务 -> SingBox Lite -> 运行模式
服务 -> SingBox Lite -> 日志
```

## 安全应用流程

```text
导入配置
写入 /tmp/singboxlite
执行 sing-box check
检查通过后备份旧配置
替换 /etc/sing-box/config.json
重启 sing-box
按运行模式决定是否重启 MosDNS
```

检查失败时不会覆盖正式配置。

## 开发原则

每次修改先在本地完成，再上传到 `leosysd/singbox-lite` 仓库。
