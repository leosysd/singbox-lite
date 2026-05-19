'use strict';
'require rpc';
'require ui';
'require uci';
'require view';

var callStatus = rpc.declare({ object: 'luci.singboxlite', method: 'status', expect: { '': {} } });
var callCheckCurrent = rpc.declare({ object: 'luci.singboxlite', method: 'check_current', expect: { '': {} } });
var callStartSingbox = rpc.declare({ object: 'luci.singboxlite', method: 'start_singbox', expect: { '': {} } });
var callStopSingbox = rpc.declare({ object: 'luci.singboxlite', method: 'stop_singbox', expect: { '': {} } });
var callRestartSingbox = rpc.declare({ object: 'luci.singboxlite', method: 'restart_singbox', expect: { '': {} } });
var callRestartMosdns = rpc.declare({ object: 'luci.singboxlite', method: 'restart_mosdns', expect: { '': {} } });
var callFetchRemote = rpc.declare({ object: 'luci.singboxlite', method: 'fetch_remote', params: [ 'url' ], expect: { '': {} } });
var callApplyCurrent = rpc.declare({ object: 'luci.singboxlite', method: 'apply_current', expect: { '': {} } });
var callSaveOverviewSettings = rpc.declare({ object: 'luci.singboxlite', method: 'save_overview_settings', params: [ 'settings' ], expect: { '': {} } });
var callSetCron = rpc.declare({ object: 'luci.singboxlite', method: 'set_cron', expect: { '': {} } });

function notify(title, res) {
	ui.addNotification(null, E('pre', { 'class': res.ok ? '' : 'errors' }, [
		title + '\n' + (res.output || res.backup || (res.ok ? '操作成功' : '操作失败'))
	]), res.ok ? 'info' : 'error');
}

function reloadAfterApply(res) {
	if (res && (res.ok || res.rollback))
		window.setTimeout(function() { location.reload(); }, 1200);
	return res;
}

function isTimeoutError(e) {
	return e && /timed out/i.test(String(e.message || e));
}

function reloadAfterPendingApply() {
	ui.addNotification(null, E('p', {}, '应用过程仍在后台执行，页面将在稍后刷新状态'), 'info');
	window.setTimeout(function() { location.reload(); }, 15000);
}

function val(id) {
	var el = document.getElementById(id);
	return el ? el.value : '';
}

function yes(id) {
	var el = document.getElementById(id);
	return el && el.checked ? '1' : '0';
}

function stopIfFailed(title, res) {
	if (!res || !res.ok) {
		notify(title, res || { ok: false, output: '操作失败' });
		return Promise.reject(new Error((res && res.output) || '操作失败'));
	}

	notify(title, res);
	return res;
}

function refreshChanges() {
	if (ui.changes && ui.changes.init)
		return ui.changes.init();
	return Promise.resolve();
}

function field(label, node) {
	return E('label', { 'class': 'sbl-field' }, [
		E('span', {}, label),
		node
	]);
}

function input(id, value, placeholder) {
	return E('input', { id: id, value: value || '', placeholder: placeholder || '', 'class': 'sbl-input' });
}

function select(id, value, opts) {
	return E('select', { id: id, 'class': 'sbl-input' }, opts.map(function(opt) {
		return E('option', { value: opt[0], selected: value === opt[0] }, opt[1]);
	}));
}

function setModeValue(mode) {
	var input = document.getElementById('sbl-mode');
	var buttons = document.querySelectorAll('.sbl-mode-btn');

	if (input)
		input.value = mode;

	for (var i = 0; i < buttons.length; i++)
		buttons[i].classList.toggle('active', buttons[i].getAttribute('data-mode') === mode);
}

function modePicker(value) {
	value = value || 'singbox_mosdns';

	return E('div', { 'class': 'sbl-mode-picker' }, [
		E('input', { id: 'sbl-mode', type: 'hidden', value: value }),
		E('button', { type: 'button', 'class': 'sbl-mode-btn ' + (value === 'singbox_mosdns' ? 'active' : ''), 'data-mode': 'singbox_mosdns', 'click': function() { setModeValue('singbox_mosdns'); } }, [
			E('b', {}, 'sing-box + mosdns'),
			E('span', {}, '开启 MosDNS DNS 转发')
		]),
		E('button', { type: 'button', 'class': 'sbl-mode-btn ' + (value === 'singbox_dns' ? 'active' : ''), 'data-mode': 'singbox_dns', 'click': function() { setModeValue('singbox_dns'); } }, [
			E('b', {}, 'sing-box'),
			E('span', {}, '关闭 MosDNS DNS 转发')
		])
	]);
}

function toggle(id, checked, text) {
	return E('label', { 'class': 'sbl-toggle' }, [
		E('input', { id: id, type: 'checkbox', checked: checked ? true : null }),
		E('span', { 'class': 'sbl-switch' }),
		E('b', {}, text || '启用')
	]);
}

function saveSettings(message, applyCron, applyNow) {
	return callSaveOverviewSettings({
		mode: val('sbl-mode') || 'singbox_mosdns',
		config_path: val('sbl-config-path') || '/etc/sing-box/config.json',
		log_path: val('sbl-log-path') || '/etc/sing-box/sing-box.log',
		remote_url: val('sbl-remote-url'),
		remote_auto: yes('sbl-remote-auto'),
		remote_time: val('sbl-remote-time') || uci.get('singboxlite', 'remote', 'auto_update_time') || '03:00',
		remote_apply: yes('sbl-remote-apply'),
			mosdns_addr: val('sbl-mosdns-addr') || '127.0.0.1',
			mosdns_port: val('sbl-mosdns-port') || '5335',
			disable_dns_hijack: yes('sbl-disable-dns-hijack'),
			restart_mosdns: yes('sbl-restart-mosdns'),
			clean_log: document.getElementById('sbl-clean-log') ? yes('sbl-clean-log') : (uci.get('singboxlite', 'log', 'cleanup_enabled') || '0'),
			tail_lines: val('sbl-tail-lines') || uci.get('singboxlite', 'log', 'tail_lines') || '200'
		}).then(function() {
		if (applyCron)
			return callSetCron();
	}).then(function(res) {
		if (res && res.ok === false)
			notify('写入定时任务', res);
		return refreshChanges();
	}).then(function() {
		ui.addNotification(null, E('p', {}, message || '已保存设置'), 'info');
	});
}

function saveAndApplyAll() {
	return saveSettings('已保存设置，开始应用', true, true).then(function() {
		if (val('sbl-remote-url') !== '')
			return callFetchRemote(val('sbl-remote-url')).then(function(res) {
				return stopIfFailed('远程配置预检', res);
			});
	}).then(function() {
		return callApplyCurrent();
	}).then(function(res) {
		notify('保存并应用', res);
		return reloadAfterApply(res);
	}).catch(function(e) {
		if (isTimeoutError(e)) {
			reloadAfterPendingApply();
			return;
		}

		if (e)
			L.error(e);
	});
}

function statCard(label, value, meta, tone) {
	return E('div', { 'class': 'sbl-stat' }, [
		E('div', { 'class': 'sbl-stat-label' }, label),
		E('div', { 'class': 'sbl-stat-value ' + (tone || '') }, value || '-'),
		E('div', { 'class': 'sbl-stat-meta' }, meta || '-')
	]);
}

function operationCard(title, body, nodes) {
	return E('div', { 'class': 'sbl-op-card' }, [
		E('h3', {}, title),
		body ? E('p', {}, body) : '',
		E('div', { 'class': 'sbl-op-actions' }, nodes || [])
	]);
}

function overviewItem(label, value) {
	return E('div', { 'class': 'sbl-overview-item' }, [
		E('span', {}, label),
		E('b', {}, value || '-')
	]);
}

function openClashPanel() {
	var host = window.location.hostname || '10.0.0.1';
	var protocol = window.location.protocol || 'http:';

	window.open(protocol + '//' + host + ':9090/ui/', '_blank', 'noopener');
}

function pageTabs(active) {
	return E('div', { 'class': 'sbl-panel sbl-tabs' }, [
		E('button', { 'class': 'sbl-tab ' + (active === 'overview' ? 'active' : ''), 'click': function() { location.href = L.url('admin/services/singboxlite/overview'); } }, '总览'),
		E('button', { 'class': 'sbl-tab ' + (active === 'ruleset' ? 'active' : ''), 'click': function() { location.href = L.url('admin/services/singboxlite/ruleset'); } }, '规则集'),
		E('button', { 'class': 'sbl-tab ' + (active === 'logs' ? 'active' : ''), 'click': function() { location.href = L.url('admin/services/singboxlite/logs'); } }, '日志')
	]);
}

function css() {
	return E('style', {}, `
		.cbi-tabmenu,.tabs:not(.sbl-tabs):not(.sblr-tabs):not(.sbll-tabs){display:none!important}
		.sbl-page{color:#14223a;font-size:12px;margin:-12px;padding:12px 18px 18px;background:linear-gradient(180deg,#5f70e8 0,#5f70e8 62px,#eaf2ff 62px,#f7fbff 100%);min-height:calc(100vh - 110px)}
		.sbl-shell{max-width:1440px;margin:0 auto}
		.sbl-panel{background:rgba(255,255,255,.97);border:1px solid #d8e4f5;border-radius:10px;box-shadow:0 14px 34px rgba(64,91,160,.10)}
		.sbl-hero{position:relative;overflow:hidden;background:linear-gradient(115deg,#204d76 0,#276be2 62%,#60a4ff 100%);border-color:rgba(255,255,255,.28);padding:12px 16px 10px;margin-bottom:8px;color:#fff;min-height:112px;box-sizing:border-box;display:flex;align-items:center}
		.sbl-hero:after{content:"";position:absolute;right:-42px;top:-32px;width:190px;height:190px;border-radius:999px;background:rgba(255,255,255,.12)}
		.sbl-hero-top{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:18px;width:100%}
		.sbl-brand{display:flex;align-items:center;gap:10px;margin-bottom:6px}
		.sbl-logo{width:30px;height:30px;border-radius:10px;background:rgba(255,255,255,.18);display:inline-flex;align-items:center;justify-content:center;font-weight:900}
		.sbl-brand b{display:block;font-size:13px}.sbl-brand span{display:block;font-size:11px;color:rgba(255,255,255,.72)}
		.sbl-title h2{margin:0 0 5px;font-size:17px;line-height:1.1;color:#fff;font-weight:800}
		.sbl-title p{margin:0;color:rgba(255,255,255,.82);font-size:12px;line-height:1.3;max-width:720px}
		.sbl-actions,.sbl-card-actions,.sbl-footer,.sbl-op-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
		.sbl-actions{position:relative;z-index:1;justify-content:flex-end}
		.sbl-btn{min-height:30px;border-radius:10px;border:1px solid #cdddf5;background:#fff;color:#2662d9;padding:0 12px;font-size:12px;font-weight:800;cursor:pointer}
		.sbl-btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}
		.sbl-btn.danger{background:#f04f4f;border-color:#f04f4f;color:#fff}
		.sbl-btn.soft{background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.2);color:#fff}
		.sbl-btn:hover{filter:brightness(.98)}
		.sbl-tabs{height:40px;display:flex;align-items:center;gap:6px;padding:0 10px;margin:8px 0;border-radius:8px;box-shadow:0 12px 28px rgba(64,91,160,.08)}
		.sbl-tab{height:28px;display:inline-flex;align-items:center;padding:0 14px;border:0;border-radius:7px;background:transparent;color:#4b6382;font-size:12px;font-weight:900;cursor:pointer}
		.sbl-tab.active{color:#fff;background:#2563eb;box-shadow:0 6px 14px rgba(37,99,235,.22)}
		.sbl-status-strip{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:12px 0;background:rgba(255,255,255,.98);border:1px solid #d8e4f5;border-radius:14px;padding:10px 14px;box-shadow:0 14px 34px rgba(64,91,160,.09)}
		.sbl-crumb{color:#60728e;font-weight:800}
		.sbl-enabled{display:inline-flex;align-items:center;border-radius:999px;background:#e8fbf0;color:#07905f;border:1px solid #bceacf;padding:6px 12px;font-weight:900;white-space:nowrap}
		.sbl-overview-strip{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-bottom:12px}
		.sbl-overview-item{min-height:70px;background:#fff;border:1px solid #d8e4f5;border-radius:14px;padding:13px 14px;box-shadow:0 14px 34px rgba(64,91,160,.08);overflow:hidden}
		.sbl-overview-item span{display:block;color:#65758f;font-weight:800;margin-bottom:6px}
		.sbl-overview-item b{display:block;color:#132845;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.sbl-main{display:grid;gap:12px}
		.sbl-op-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
		.sbl-op-card{min-height:112px;border:1px solid #d8e4f5;border-radius:10px;background:#fff;padding:13px;box-sizing:border-box}
		.sbl-op-card p{margin:0 0 16px;color:#70849f;line-height:1.45;min-height:32px}
		.sbl-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-items:start}
		.sbl-card{padding:16px;margin-bottom:12px}
		.sbl-chip-row{display:flex;align-items:center;gap:8px}
		.sbl-chip{display:inline-flex;align-items:center;min-height:21px;border-radius:999px;padding:0 9px;font-size:11px;font-weight:900;background:#eafaf2;color:#008763}
		.sbl-chip.warn{background:#fff4cf;color:#b76b05}
		.sbl-muted{color:#7a8ba3;font-size:11px}
		.sbl-settings{display:grid;grid-template-columns:1fr 1fr;gap:14px}
		.sbl-settings h4{margin:0 0 9px;font-size:12px;color:#263959}
		.sbl-section{border:1px solid #dce7f6;border-radius:12px;padding:14px;background:#fbfdff}
		.sbl-field{display:grid;grid-template-columns:108px minmax(0,1fr);align-items:center;gap:8px;margin:8px 0}
		.sbl-field>span{font-weight:800;color:#425672;text-align:right}
		.sbl-input{height:31px;border:1px solid #cbd8e8;border-radius:9px;background:#fff;color:#102038;box-sizing:border-box;padding:0 10px;width:100%;font-size:12px}
		.sbl-mode-picker{display:grid;grid-template-columns:1fr 1fr;gap:7px}
		.sbl-mode-btn{min-height:46px;border:1px solid #cbd8e8;border-radius:11px;background:#fff;color:#102038;padding:7px 10px;text-align:left;cursor:pointer}
		.sbl-mode-btn b{display:block;font-size:12px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.sbl-mode-btn span{display:block;margin-top:3px;color:#7a8ba3;font-size:11px;line-height:1.2}
		.sbl-mode-btn.active{border-color:#8fb4ff;background:#eef5ff;color:#2563eb}
		.sbl-mode-btn.active span{color:#2563eb}
		.sbl-toggle{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:#5f7088;font-weight:700}
		.sbl-toggle input{display:none}
		.sbl-switch{position:relative;width:34px;height:18px;border-radius:999px;background:#cbd5e1;display:inline-block}
		.sbl-switch:before{content:"";position:absolute;width:14px;height:14px;border-radius:999px;background:#fff;left:2px;top:2px;transition:.15s}
		.sbl-toggle input:checked+.sbl-switch{background:#2563eb}
		.sbl-toggle input:checked+.sbl-switch:before{transform:translateX(16px)}
		.sbl-meta-list{display:grid;grid-template-columns:1fr 1fr;gap:0 22px}
		.sbl-meta{display:flex;justify-content:space-between;border-bottom:1px solid #e4eaf2;padding:8px 0;gap:12px}
		.sbl-meta span{color:#5f7088}.sbl-meta b{color:#102038;text-align:right}
		.sbl-footer{justify-content:flex-end;margin-top:2px}
		@media(max-width:1280px){.sbl-grid{grid-template-columns:1fr}.sbl-op-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.sbl-overview-strip{grid-template-columns:repeat(3,minmax(0,1fr))}}
		@media(max-width:900px){.sbl-settings,.sbl-meta-list,.sbl-op-grid,.sbl-overview-strip{grid-template-columns:1fr}.sbl-hero-top,.sbl-status-strip{align-items:flex-start;flex-direction:column}.sbl-actions{justify-content:flex-start}.sbl-field{grid-template-columns:104px minmax(0,1fr)}}
		`);
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('singboxlite'),
			L.resolveDefault(callStatus(), {})
		]);
	},

	render: function(data) {
		var status = data[1] || {};
		var mode = uci.get('singboxlite', 'main', 'mode') || 'singbox_mosdns';
		var remoteUrl = uci.get('singboxlite', 'remote', 'url') || '';
		var remoteAuto = uci.get('singboxlite', 'remote', 'auto_update') === '1';
		var remoteTime = uci.get('singboxlite', 'remote', 'auto_update_time') || '03:00';
		var remoteApply = uci.get('singboxlite', 'remote', 'auto_apply') === '1';
		var mosdnsAddr = uci.get('singboxlite', 'dns', 'mosdns_addr') || '127.0.0.1';
		var mosdnsPort = uci.get('singboxlite', 'dns', 'mosdns_port') || '5335';
		var disableDnsHijack = uci.get('singboxlite', 'dns', 'disable_dns_hijack') !== '0';
		var restartMosdns = uci.get('singboxlite', 'dns', 'restart_mosdns_after_apply') !== '0';
		var activeMode = status.mode || mode;
		var dnsMeta = activeMode === 'singbox_mosdns'
			? (status.dns_hijack_script_installed ? 'DNS DNAT 清理脚本已安装' : 'DNS DNAT 清理脚本未安装')
			: (status.dns_hijack_script_installed ? '清理脚本仍存在' : 'DNS 劫持由 sing-box 处理');

		return E('div', { 'class': 'sbl-page' }, [
			css(),
			E('div', { 'class': 'sbl-shell' }, [
				E('div', { 'class': 'sbl-panel sbl-hero' }, [
					E('div', { 'class': 'sbl-hero-top' }, [
						E('div', { 'class': 'sbl-title' }, [
							E('div', { 'class': 'sbl-brand' }, [
								E('span', { 'class': 'sbl-logo' }, 'SB'),
								E('span', {}, [ E('b', {}, 'SingBox Lite'), E('span', {}, 'LuCI 控制台') ])
							]),
							E('h2', {}, '更轻、更稳的 sing-box 控制台'),
							E('p', {}, '保存并应用会自动拉取远程 JSON，完成配置预检、临时回滚备份、MosDNS 联动和 DNS 探测。')
						]),
						E('div', { 'class': 'sbl-actions' }, [
							E('button', { 'class': 'sbl-btn soft', 'click': function() { return callCheckCurrent().then(function(res) { notify('检查配置', res); }); } }, '检查配置'),
							E('button', { 'class': 'sbl-btn soft', 'click': function() { location.href = L.url('admin/services/singboxlite/logs'); } }, '查看日志'),
							E('button', { 'class': 'sbl-btn primary', 'click': function() { return saveAndApplyAll(); } }, '保存并应用')
						])
					])
				]),
				pageTabs('overview'),
				E('div', { 'class': 'sbl-status-strip' }, [
					E('div', { 'class': 'sbl-crumb' }, '当前页面：总览 · 保存并应用会拉取远程配置并检查后写入'),
					E('span', { 'class': 'sbl-enabled' }, status.singbox_running ? '已启用' : '未运行')
				]),
				E('div', { 'class': 'sbl-overview-strip' }, [
					overviewItem('sing-box 版本', (status.singbox_version || '-').replace(/^sing-box version /, '').replace(/^sing-box /, '')),
					overviewItem('PID', status.singbox_pid || '-'),
					overviewItem('MosDNS', status.mosdns_running ? 'running' : 'not running'),
					overviewItem('日志大小', '%1024.2mB'.format(status.log_size || 0)),
					overviewItem('上次检查', status.last_check_result || '-'),
					overviewItem('上次应用', status.last_apply_time || '-')
				]),
				E('div', { 'class': 'sbl-main' }, [
					E('div', { 'class': 'sbl-op-grid' }, [
						operationCard('配置操作', '保存基础设置，或者拉取远程配置并完整应用。', [
							E('button', { 'class': 'sbl-btn', 'click': function() { return saveSettings('已保存设置，等待应用', false, false); } }, '仅保存'),
							E('button', { 'class': 'sbl-btn primary', 'click': function() { return saveAndApplyAll(); } }, '保存并应用')
						]),
						operationCard('服务操作', '临时启动、停止或重启 sing-box，不改配置内容。', [
							E('button', { 'class': 'sbl-btn primary', 'click': function() { return callStartSingbox().then(function(res) { notify('启动 sing-box', res); }); } }, '启动'),
							E('button', { 'class': 'sbl-btn danger', 'click': function() { return callStopSingbox().then(function(res) { notify('停止 sing-box', res); }); } }, '停止'),
							E('button', { 'class': 'sbl-btn', 'click': function() { return callRestartSingbox().then(function(res) { notify('重启 sing-box', res); }); } }, '重启')
						]),
						operationCard('MosDNS 联动', dnsMeta, [
							E('button', { 'class': 'sbl-btn primary', 'click': function() { return callRestartMosdns().then(function(res) { notify('重启 MosDNS', res); }); } }, '重启 MosDNS')
						]),
						operationCard('sing-box 更新注意', '更新核心前确认架构和版本，Alpha/Beta 可能不稳定；更新后需要重启 sing-box。', [
							E('button', { 'class': 'sbl-btn', 'click': function() { return callCheckCurrent().then(function(res) { notify('更新前检查', res); }); } }, '检查配置')
						]),
						operationCard('Clash API', '打开 sing-box 的 Clash 控制面板，地址使用当前路由器 IP 与 9090 端口。', [
							E('button', { 'class': 'sbl-btn primary', 'click': openClashPanel }, '打开面板')
						])
					]),
					E('div', { 'class': 'sbl-grid' }, [
						E('div', { 'class': 'sbl-panel sbl-card' }, [
							E('h3', {}, '运行与远程设置'),
							E('div', { 'class': 'sbl-settings' }, [
								E('div', { 'class': 'sbl-section' }, [
									E('h4', {}, '远程配置'),
									field('运行模式', modePicker(mode)),
									field('远程 URL', input('sbl-remote-url', remoteUrl, 'https://example.com/sing-box.json')),
									field('自动更新', toggle('sbl-remote-auto', remoteAuto, '每天 ' + remoteTime)),
									field('检查后应用', toggle('sbl-remote-apply', remoteApply, '启用'))
								]),
								E('div', { 'class': 'sbl-section' }, [
									E('h4', {}, 'MosDNS'),
									field('地址', input('sbl-mosdns-addr', mosdnsAddr)),
									field('端口', input('sbl-mosdns-port', mosdnsPort)),
									field('禁用劫持', toggle('sbl-disable-dns-hijack', disableDnsHijack, '启用')),
									field('重启 MosDNS', toggle('sbl-restart-mosdns', restartMosdns, restartMosdns ? '应用时重启' : '仅写入配置'))
								])
							])
						])
					]),
					E('div', { 'class': 'sbl-footer' }, [
						E('button', { 'class': 'sbl-btn primary', 'click': function() { return saveAndApplyAll(); } }, '保存并应用'),
						E('button', { 'class': 'sbl-btn', 'click': function() { return saveSettings('已保存设置，等待应用', false, false); } }, '保存'),
						E('button', { 'class': 'sbl-btn danger', 'click': function() { location.reload(); } }, '重置')
					])
				])
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
