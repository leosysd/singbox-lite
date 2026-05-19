'use strict';
'require rpc';
'require ui';
'require uci';
'require view';

var callStatus = rpc.declare({ object: 'luci.singboxlite', method: 'status', expect: { '': {} } });
var callCheckCurrent = rpc.declare({ object: 'luci.singboxlite', method: 'check_current', expect: { '': {} } });
var callBackup = rpc.declare({ object: 'luci.singboxlite', method: 'backup_current', expect: { '': {} } });
var callDeleteBackups = rpc.declare({ object: 'luci.singboxlite', method: 'delete_backups', expect: { '': {} } });
var callStartSingbox = rpc.declare({ object: 'luci.singboxlite', method: 'start_singbox', expect: { '': {} } });
var callStopSingbox = rpc.declare({ object: 'luci.singboxlite', method: 'stop_singbox', expect: { '': {} } });
var callRestartSingbox = rpc.declare({ object: 'luci.singboxlite', method: 'restart_singbox', expect: { '': {} } });
var callRestartMosdns = rpc.declare({ object: 'luci.singboxlite', method: 'restart_mosdns', expect: { '': {} } });
var callFetchRemote = rpc.declare({ object: 'luci.singboxlite', method: 'fetch_remote', params: [ 'url' ], expect: { '': {} } });
var callApplyCurrent = rpc.declare({ object: 'luci.singboxlite', method: 'apply_current', expect: { '': {} } });
var callSaveOverviewSettings = rpc.declare({ object: 'luci.singboxlite', method: 'save_overview_settings', params: [ 'settings' ], expect: { '': {} } });
var callSetCron = rpc.declare({ object: 'luci.singboxlite', method: 'set_cron', expect: { '': {} } });

function modeText(mode) {
	return mode === 'singbox_mosdns' ? 'sing-box + mosdns' : 'sing-box';
}

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
			clean_log: yes('sbl-clean-log'),
			tail_lines: val('sbl-tail-lines') || '200'
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

function css() {
	return E('style', {}, `
		.sbl-page{color:#0f1f35;font-size:12px}
		.sbl-panel{background:#fff;border:1px solid #d5deeb;border-radius:7px;box-shadow:0 1px 2px rgba(16,24,40,.03)}
		.sbl-hero{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 16px;margin-bottom:10px}
		.sbl-title h2{margin:0 0 4px;font-size:18px;line-height:1.1;color:#102038}
		.sbl-title p{margin:0;color:#5f7088;font-size:12px;line-height:1.3}
		.sbl-actions,.sbl-card-actions,.sbl-footer{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
		.sbl-actions{justify-content:flex-end}
		.sbl-btn{min-height:28px;border-radius:6px;border:1px solid #b8c7ff;background:#fff;color:#4f62df;padding:0 11px;font-size:12px;font-weight:800;cursor:pointer}
		.sbl-btn.primary{background:#5b6ee1;border-color:#5b6ee1;color:#fff}
		.sbl-btn.danger{background:#f23655;border-color:#f23655;color:#fff}
		.sbl-btn:hover{filter:brightness(.98)}
		.sbl-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:10px}
		.sbl-stat{padding:12px 13px;min-height:58px}
		.sbl-stat-label{font-size:11px;color:#5f7088;text-transform:uppercase;font-weight:800;margin-bottom:4px}
		.sbl-stat-value{font-size:13px;font-weight:900;color:#102038;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.sbl-stat-value.ok{color:#008763}.sbl-stat-value.warn{color:#b76b05}
		.sbl-stat-meta{font-size:11px;color:#7a8ba3;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.sbl-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:10px;align-items:start}
		.sbl-card{padding:12px 13px;margin-bottom:10px}
		.sbl-card>h3,.sbl-subtitle{margin:0 0 10px;font-size:13px;color:#102038}
			.sbl-chip-row{display:flex;align-items:center;gap:8px}
		.sbl-chip{display:inline-flex;align-items:center;min-height:21px;border-radius:999px;padding:0 9px;font-size:11px;font-weight:900;background:#eafaf2;color:#008763}
		.sbl-chip.warn{background:#fff4cf;color:#b76b05}
		.sbl-muted{color:#7a8ba3;font-size:11px}
		.sbl-settings{display:grid;grid-template-columns:1fr 1fr;gap:14px 18px}
		.sbl-settings h4{margin:0 0 7px;font-size:12px;color:#102038}
		.sbl-section{border-bottom:1px solid #e4eaf2;padding-bottom:9px}
		.sbl-section:nth-last-child(-n+2){border-bottom:0;padding-bottom:0}
		.sbl-field{display:grid;grid-template-columns:116px minmax(0,1fr);align-items:center;gap:8px;margin:6px 0}
		.sbl-field>span{font-weight:800;color:#102038;text-align:right}
		.sbl-input{height:29px;border:1px solid #cbd6e6;border-radius:5px;background:#fff;color:#102038;box-sizing:border-box;padding:0 9px;width:100%;font-size:12px}
		.sbl-mode-picker{display:grid;grid-template-columns:1fr 1fr;gap:7px}
		.sbl-mode-btn{min-height:42px;border:1px solid #cbd6e6;border-radius:6px;background:#fff;color:#102038;padding:6px 9px;text-align:left;cursor:pointer}
		.sbl-mode-btn b{display:block;font-size:12px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.sbl-mode-btn span{display:block;margin-top:3px;color:#7a8ba3;font-size:11px;line-height:1.2}
		.sbl-mode-btn.active{border-color:#5b6ee1;background:#eef2ff;color:#4f62df}
		.sbl-mode-btn.active span{color:#4f62df}
		.sbl-toggle{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:#5f7088;font-weight:700}
		.sbl-toggle input{display:none}
		.sbl-switch{position:relative;width:32px;height:17px;border-radius:999px;background:#cbd5e1;display:inline-block}
		.sbl-switch:before{content:"";position:absolute;width:13px;height:13px;border-radius:999px;background:#fff;left:2px;top:2px;transition:.15s}
		.sbl-toggle input:checked+.sbl-switch{background:#5b6ee1}
		.sbl-toggle input:checked+.sbl-switch:before{transform:translateX(15px)}
			.sbl-meta-list{display:grid;grid-template-columns:1fr 1fr;gap:0 22px}
			.sbl-meta{display:flex;justify-content:space-between;border-bottom:1px solid #e4eaf2;padding:8px 0;gap:12px}
			.sbl-meta span{color:#5f7088}.sbl-meta b{color:#102038}
			.sbl-flow{display:grid;grid-template-columns:1fr 1fr;gap:0 24px}
			.sbl-flow-row{display:grid;grid-template-columns:26px minmax(0,1fr) auto;gap:8px;align-items:center;border-bottom:1px solid #e4eaf2;padding:8px 0;color:#5f7088}
			.sbl-flow-row b{display:block;color:#102038;margin-bottom:2px}.sbl-flow-row span:last-child{font-size:11px}
			.sbl-step{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:999px;background:#eef2ff;color:#4f62df;font-weight:900}
			.sbl-footer{justify-content:flex-end;margin-top:2px}
				@media(max-width:1100px){.sbl-grid,.sbl-settings,.sbl-stats{grid-template-columns:1fr}.sbl-hero{align-items:flex-start;flex-direction:column}.sbl-actions{justify-content:flex-start}.sbl-field{grid-template-columns:120px minmax(0,1fr)}}
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
		var configPath = uci.get('singboxlite', 'main', 'config_path') || '/etc/sing-box/config.json';
		var logPath = uci.get('singboxlite', 'main', 'log_path') || '/etc/sing-box/sing-box.log';
		var remoteUrl = uci.get('singboxlite', 'remote', 'url') || '';
		var remoteAuto = uci.get('singboxlite', 'remote', 'auto_update') === '1';
		var remoteTime = uci.get('singboxlite', 'remote', 'auto_update_time') || '03:00';
		var remoteApply = uci.get('singboxlite', 'remote', 'auto_apply') === '1';
		var mosdnsAddr = uci.get('singboxlite', 'dns', 'mosdns_addr') || '127.0.0.1';
		var mosdnsPort = uci.get('singboxlite', 'dns', 'mosdns_port') || '5335';
		var disableDnsHijack = uci.get('singboxlite', 'dns', 'disable_dns_hijack') !== '0';
		var restartMosdns = uci.get('singboxlite', 'dns', 'restart_mosdns_after_apply') !== '0';
		var cleanupTime = uci.get('singboxlite', 'log', 'cleanup_time') || '03:10';
		var activeMode = status.mode || mode;
		var dnsTitle = activeMode === 'singbox_mosdns'
			? 'MosDNS ' + (status.mosdns_addr || mosdnsAddr) + ':' + (status.mosdns_port || mosdnsPort)
			: 'sing-box 接管';
		var dnsMeta = activeMode === 'singbox_mosdns'
			? (status.dns_hijack_script_installed ? 'DNS DNAT 清理脚本已安装' : 'DNS DNAT 清理脚本未安装')
			: (status.dns_hijack_script_installed ? '清理脚本仍存在' : 'DNS 劫持由 sing-box 处理');
			var dnsTone = activeMode === 'singbox_mosdns'
				? (status.mosdns_running ? 'ok' : 'warn')
				: (status.dns_hijack_script_installed ? 'warn' : 'ok');
			var selectedModeMeta = mode === activeMode
				? (activeMode === 'singbox_mosdns' ? '配置与运行状态一致' : '配置与运行状态一致')
				: '选择未应用，当前仍是 ' + modeText(activeMode);

		return E('div', { 'class': 'sbl-page' }, [
			css(),
			E('div', { 'class': 'sbl-panel sbl-hero' }, [
				E('div', { 'class': 'sbl-title' }, [
						E('h2', {}, 'SingBox Lite'),
						E('p', {}, '保存并应用时会自动拉取远程 JSON，检查通过后应用；当前模式会自动处理 MosDNS 联动。')
				]),
				E('div', { 'class': 'sbl-actions' }, [
					E('button', { 'class': 'sbl-btn', 'click': function() { return callCheckCurrent().then(function(res) { notify('检查配置', res); }); } }, '✓ 检查配置'),
					E('button', { 'class': 'sbl-btn', 'click': function() { return callBackup().then(function(res) { notify('备份配置', res); }); } }, '↥ 备份配置'),
					E('button', { 'class': 'sbl-btn danger', 'click': function() {
						return ui.showModal('确认删除备份', [
							E('p', {}, '确定要删除 SingBox Lite 创建的配置备份吗？'),
							E('div', { 'class': 'right' }, [
								E('button', { 'class': 'btn', 'click': ui.hideModal }, '取消'),
								E('button', { 'class': 'btn cbi-button-negative', 'click': function() {
									ui.hideModal();
									return callDeleteBackups().then(function(res) { notify('删除备份', res); });
								} }, '删除')
							])
						]);
					} }, '× 删除备份'),
					E('button', { 'class': 'sbl-btn primary', 'click': function() { return callStartSingbox().then(function(res) { notify('启动 sing-box', res); }); } }, '▶ 启动 sing-box'),
					E('button', { 'class': 'sbl-btn', 'click': function() { return callStopSingbox().then(function(res) { notify('停止 sing-box', res); }); } }, '■ 停止 sing-box'),
					E('button', { 'class': 'sbl-btn primary', 'click': function() { return callRestartSingbox().then(function(res) { notify('重启 sing-box', res); }); } }, '↻ 重启 sing-box'),
					E('button', { 'class': 'sbl-btn primary', 'click': function() { return callRestartMosdns().then(function(res) { notify('重启 MosDNS', res); }); } }, '↻ 重启 MosDNS'),
					E('button', { 'class': 'sbl-btn', 'click': function() { location.href = L.url('admin/services/singboxlite/logs'); } }, '= 查看日志')
				])
			]),
			E('div', { 'class': 'sbl-stats' }, [
				statCard('sing-box', status.singbox_running ? '运行中' : (status.singbox_installed ? '未运行' : '未安装'), (status.singbox_version || '').replace(/^sing-box /, '') + (status.singbox_pid ? ' · PID ' + status.singbox_pid : ''), status.singbox_running ? 'ok' : 'warn'),
					statCard('配置', status.config_path || configPath, '备份 ' + (status.backup_count || 0) + ' 个 · 上次应用 ' + (status.last_apply_time || '-')),
					statCard('DNS', dnsTitle, dnsMeta, dnsTone),
					statCard('模式', modeText(mode), selectedModeMeta, mode === activeMode ? 'ok' : 'warn')
				]),
			E('div', { 'class': 'sbl-grid' }, [
					E('div', {}, [
						E('div', { 'class': 'sbl-panel sbl-card' }, [
							E('h3', {}, '运行概况'),
						E('div', { 'class': 'sbl-meta-list' }, [
							E('div', { 'class': 'sbl-meta' }, [ E('span', {}, 'sing-box 版本'), E('b', {}, (status.singbox_version || '-').replace(/^sing-box version /, '')) ]),
							E('div', { 'class': 'sbl-meta' }, [ E('span', {}, 'PID'), E('b', {}, status.singbox_pid || '-') ]),
							E('div', { 'class': 'sbl-meta' }, [ E('span', {}, 'MosDNS'), E('b', {}, status.mosdns_running ? 'running' : 'not running') ]),
							E('div', { 'class': 'sbl-meta' }, [ E('span', {}, '日志大小'), E('b', {}, '%1024.2mB'.format(status.log_size || 0)) ]),
							E('div', { 'class': 'sbl-meta' }, [ E('span', {}, '上次检查'), E('b', {}, status.last_check_result || '-') ]),
							E('div', { 'class': 'sbl-meta' }, [ E('span', {}, '上次应用'), E('b', {}, status.last_apply_time || '-') ])
						])
					])
				]),
				E('div', {}, [
					E('div', { 'class': 'sbl-panel sbl-card' }, [
						E('h3', {}, '运行与远程设置'),
						E('div', { 'class': 'sbl-settings' }, [
							E('div', { 'class': 'sbl-section' }, [
								E('h4', {}, '基础'),
								field('配置路径', input('sbl-config-path', configPath)),
								field('日志路径', input('sbl-log-path', logPath))
							]),
							E('div', { 'class': 'sbl-section' }, [
								E('h4', {}, '远程配置'),
								field('运行模式', modePicker(mode)),
								field('远程配置 URL', input('sbl-remote-url', remoteUrl, 'https://example.com/sing-box.json')),
								field('自动更新', toggle('sbl-remote-auto', remoteAuto, '每天 ' + remoteTime)),
								field('检查后应用', toggle('sbl-remote-apply', remoteApply, '启用'))
							]),
							E('div', { 'class': 'sbl-section' }, [
								E('h4', {}, 'MosDNS 联动'),
								field('MosDNS 地址', input('sbl-mosdns-addr', mosdnsAddr)),
								field('MosDNS 端口', input('sbl-mosdns-port', mosdnsPort)),
								field('禁用 DNS 劫持', toggle('sbl-disable-dns-hijack', disableDnsHijack, '启用')),
								field('重启 MosDNS', toggle('sbl-restart-mosdns', restartMosdns, restartMosdns ? '应用时重启' : '仅写入配置')),
								field('应用顺序', E('span', { 'class': 'sbl-muted' }, 'MosDNS 模式会先启动 MosDNS，等待 10 秒确认运行，再启动 sing-box'))
							]),
							E('div', { 'class': 'sbl-section' }, [
								E('h4', {}, '维护'),
								field('清理日志', toggle('sbl-clean-log', uci.get('singboxlite', 'log', 'cleanup_enabled') === '1', '每天 ' + cleanupTime)),
								field('显示行数', input('sbl-tail-lines', uci.get('singboxlite', 'log', 'tail_lines') || '200')),
								field('备份策略', input('sbl-backup-policy', '应用前自动备份'))
							])
						])
					]),
						E('div', { 'class': 'sbl-panel sbl-card' }, [
							E('h3', {}, '应用流程'),
							E('div', { 'class': 'sbl-flow' }, [
								E('div', {}, [
										E('div', { 'class': 'sbl-flow-row' }, [ E('span', { 'class': 'sbl-step' }, '1'), E('div', {}, [ E('b', {}, '拉取远程配置'), E('span', {}, '保存并应用时自动下载 URL') ]), E('span', {}, 'fetch') ]),
										E('div', { 'class': 'sbl-flow-row' }, [ E('span', { 'class': 'sbl-step' }, '3'), E('div', {}, [ E('b', {}, '临时回滚备份'), E('span', {}, '失败回滚，成功后自动删除') ]), E('span', {}, 'backup') ]),
										E('div', { 'class': 'sbl-flow-row' }, [ E('span', { 'class': 'sbl-step' }, '5'), E('div', {}, [ E('b', {}, '启动相关服务'), E('span', {}, 'MosDNS 模式先等 10 秒再启动 sing-box') ]), E('span', {}, 'restart') ])
									]),
									E('div', {}, [
										E('div', { 'class': 'sbl-flow-row' }, [ E('span', { 'class': 'sbl-step' }, '2'), E('div', {}, [ E('b', {}, '预检配置'), E('span', {}, 'JSON 有效并通过 sing-box check') ]), E('span', {}, 'check') ]),
									E('div', { 'class': 'sbl-flow-row' }, [ E('span', { 'class': 'sbl-step' }, '4'), E('div', {}, [ E('b', {}, '写入正式配置'), E('span', {}, '同时处理 MosDNS/dnsmasq 联动') ]), E('span', {}, 'apply') ]),
									E('div', { 'class': 'sbl-flow-row' }, [ E('span', { 'class': 'sbl-step' }, '6'), E('div', {}, [ E('b', {}, 'DNS 探测'), E('span', {}, '失败会自动回滚，避免保持断网状态') ]), E('span', {}, 'probe') ])
								])
							])
					])
				])
			]),
			E('div', { 'class': 'sbl-footer' }, [
				E('button', { 'class': 'sbl-btn primary', 'click': function() { return saveAndApplyAll(); } }, '✓ 保存并应用'),
				E('button', { 'class': 'sbl-btn', 'click': function() { return saveSettings('已保存设置，等待应用', false, false); } }, '保存'),
				E('button', { 'class': 'sbl-btn danger', 'click': function() { location.reload(); } }, '重置')
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
