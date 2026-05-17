'use strict';
'require rpc';
'require ui';
'require uci';
'require view';

var LOCAL_TEMP = '/tmp/singboxlite/import-local.json';

var callStatus = rpc.declare({ object: 'luci.singboxlite', method: 'status', expect: { '': {} } });
var callCheckCurrent = rpc.declare({ object: 'luci.singboxlite', method: 'check_current', expect: { '': {} } });
var callBackup = rpc.declare({ object: 'luci.singboxlite', method: 'backup_current', expect: { '': {} } });
var callDeleteBackups = rpc.declare({ object: 'luci.singboxlite', method: 'delete_backups', expect: { '': {} } });
var callRestartSingbox = rpc.declare({ object: 'luci.singboxlite', method: 'restart_singbox', expect: { '': {} } });
var callRestartMosdns = rpc.declare({ object: 'luci.singboxlite', method: 'restart_mosdns', expect: { '': {} } });
var callFetchRemote = rpc.declare({ object: 'luci.singboxlite', method: 'fetch_remote', params: [ 'url' ], expect: { '': {} } });
var callCheckImported = rpc.declare({ object: 'luci.singboxlite', method: 'check_imported', params: [ 'source' ], expect: { '': {} } });
var callApplyImported = rpc.declare({ object: 'luci.singboxlite', method: 'apply_imported', params: [ 'source' ], expect: { '': {} } });
var callSetCron = rpc.declare({ object: 'luci.singboxlite', method: 'set_cron', expect: { '': {} } });

function modeText(mode) {
	return mode === 'singbox_mosdns' ? 'sing-box + mosdns' : 'sing-box';
}

function notify(title, res) {
	ui.addNotification(null, E('pre', { 'class': res.ok ? '' : 'errors' }, [
		title + '\n' + (res.output || res.backup || (res.ok ? '操作成功' : '操作失败'))
	]), res.ok ? 'info' : 'error');
}

function val(id) {
	var el = document.getElementById(id);
	return el ? el.value : '';
}

function yes(id) {
	var el = document.getElementById(id);
	return el && el.checked ? '1' : '0';
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

function toggle(id, checked, text) {
	return E('label', { 'class': 'sbl-toggle' }, [
		E('input', { id: id, type: 'checkbox', checked: checked ? true : null }),
		E('span', { 'class': 'sbl-switch' }),
		E('b', {}, text || '启用')
	]);
}

function saveSettings(message, applyCron) {
	uci.set('singboxlite', 'main', 'mode', val('sbl-mode') || 'singbox_mosdns');
	uci.set('singboxlite', 'main', 'config_path', val('sbl-config-path') || '/etc/sing-box/config.json');
	uci.set('singboxlite', 'main', 'log_path', val('sbl-log-path') || '/etc/sing-box/sing-box.log');
	uci.set('singboxlite', 'remote', 'url', val('sbl-remote-url'));
	uci.set('singboxlite', 'remote', 'auto_update', yes('sbl-remote-auto'));
	uci.set('singboxlite', 'remote', 'auto_update_time', val('sbl-remote-time') || uci.get('singboxlite', 'remote', 'auto_update_time') || '03:00');
	uci.set('singboxlite', 'remote', 'auto_apply', yes('sbl-remote-apply'));
	uci.set('singboxlite', 'dns', 'mosdns_addr', val('sbl-mosdns-addr') || '127.0.0.1');
	uci.set('singboxlite', 'dns', 'mosdns_port', val('sbl-mosdns-port') || '5335');
	uci.set('singboxlite', 'log', 'cleanup_enabled', yes('sbl-clean-log'));
	uci.set('singboxlite', 'log', 'tail_lines', val('sbl-tail-lines') || '200');

	return uci.save().then(function() {
		return uci.commit('singboxlite');
	}).then(function() {
		if (applyCron)
			return callSetCron();
	}).then(function() {
		ui.addNotification(null, E('p', {}, message || '已保存设置'), 'info');
	});
}

function statCard(label, value, meta, tone) {
	return E('div', { 'class': 'sbl-stat' }, [
		E('div', { 'class': 'sbl-stat-label' }, label),
		E('div', { 'class': 'sbl-stat-value ' + (tone || '') }, value || '-'),
		E('div', { 'class': 'sbl-stat-meta' }, meta || '-')
	]);
}

function importBox(title, text, chip, chipTone, buttons) {
	return E('div', { 'class': 'sbl-import-box' }, [
		E('div', {}, [
			E('h3', {}, title),
			E('p', {}, text),
			E('div', { 'class': 'sbl-chip-row' }, [
				E('span', { 'class': 'sbl-chip ' + (chipTone || '') }, chip),
				E('span', { 'class': 'sbl-muted' }, title.indexOf('本地') >= 0 ? LOCAL_TEMP : '上次更新 -')
			])
		]),
		E('div', { 'class': 'sbl-card-actions' }, buttons)
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
		.sbl-import-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}
		.sbl-import-box{border:1px solid #dbe3ef;border-radius:7px;background:#fbfcff;padding:12px;min-height:132px;display:flex;flex-direction:column;justify-content:space-between}
		.sbl-import-box h3{margin:0 0 8px;font-size:14px}
		.sbl-import-box p{margin:0 0 8px;line-height:1.35;color:#5f7088;font-size:12px}
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
		.sbl-flow-row{display:flex;justify-content:space-between;border-bottom:1px solid #e4eaf2;padding:8px 0;color:#5f7088}
		.sbl-flow-row b{color:#102038}
		.sbl-footer{justify-content:flex-end;margin-top:2px}
		@media(max-width:1100px){.sbl-grid,.sbl-settings,.sbl-import-grid,.sbl-stats{grid-template-columns:1fr}.sbl-hero{align-items:flex-start;flex-direction:column}.sbl-actions{justify-content:flex-start}.sbl-field{grid-template-columns:120px minmax(0,1fr)}}
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
		var cleanupTime = uci.get('singboxlite', 'log', 'cleanup_time') || '03:10';

		return E('div', { 'class': 'sbl-page' }, [
			css(),
			E('div', { 'class': 'sbl-panel sbl-hero' }, [
				E('div', { 'class': 'sbl-title' }, [
					E('h2', {}, 'SingBox Lite'),
					E('p', {}, '导入 sing-box 原生 JSON，检查通过后应用；当前模式会自动处理 MosDNS 联动。')
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
					E('button', { 'class': 'sbl-btn primary', 'click': function() { return callRestartSingbox().then(function(res) { notify('重启 sing-box', res); }); } }, '↻ 重启 sing-box'),
					E('button', { 'class': 'sbl-btn primary', 'click': function() { return callRestartMosdns().then(function(res) { notify('重启 MosDNS', res); }); } }, '↻ 重启 MosDNS'),
					E('button', { 'class': 'sbl-btn', 'click': function() { location.href = L.url('admin/services/singboxlite/logs'); } }, '= 查看日志')
				])
			]),
			E('div', { 'class': 'sbl-stats' }, [
				statCard('sing-box', status.singbox_running ? '运行中' : (status.singbox_installed ? '未运行' : '未安装'), (status.singbox_version || '').replace(/^sing-box /, '') + (status.singbox_pid ? ' · PID ' + status.singbox_pid : ''), status.singbox_running ? 'ok' : 'warn'),
				statCard('配置', status.config_path || configPath, '备份 ' + (status.backup_count || 0) + ' 个 · 上次应用 -'),
				statCard('DNS', 'MosDNS ' + (status.mosdns_addr || mosdnsAddr) + ':' + (status.mosdns_port || mosdnsPort), status.dns_hijack_script_installed ? 'DNS DNAT 清理脚本已安装' : 'DNS DNAT 清理脚本未安装', status.mosdns_running ? 'ok' : 'warn'),
				statCard('模式', modeText(status.mode || mode), (status.mode === 'singbox_mosdns' || mode === 'singbox_mosdns') ? '会替换导入配置的 DNS 段' : '应用原始 JSON')
			]),
			E('div', { 'class': 'sbl-grid' }, [
				E('div', {}, [
					E('div', { 'class': 'sbl-panel sbl-card' }, [
						E('h3', {}, '配置导入'),
						E('div', { 'class': 'sbl-import-grid' }, [
							importBox('本地 JSON 配置', '上传到临时路径后先执行 sing-box check，通过后再覆盖正式配置。', '可导入', '', [
								E('button', { 'class': 'sbl-btn primary', 'click': function(ev) {
									return ui.uploadFile(LOCAL_TEMP, ev.target).then(function() {
										return callCheckImported('local').then(function(res) { notify('本地配置检查', res); });
									}).catch(function(e) { ui.addNotification(null, E('p', e.message), 'error'); });
								} }, '↑ 上传并检查'),
								E('button', { 'class': 'sbl-btn', 'click': function() { return callApplyImported('local').then(function(res) { notify('应用本地配置', res); }); } }, '✓ 应用本地配置')
							]),
							importBox('远程 URL 配置', '读取右侧填写的 URL；保存当前输入后拉取、检查并生成待应用文件。', '待检查', 'warn', [
								E('button', { 'class': 'sbl-btn primary', 'click': function() {
									return saveSettings('已保存远程 URL').then(function() {
										return callFetchRemote(val('sbl-remote-url')).then(function(res) { notify('远程配置检查', res); });
									});
								} }, '↓ 拉取并检查'),
								E('button', { 'class': 'sbl-btn', 'click': function() { return callApplyImported('remote').then(function(res) { notify('应用远程配置', res); }); } }, '✓ 应用远程配置')
							])
						])
					]),
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
						E('h3', {}, '运行设置'),
						E('div', { 'class': 'sbl-settings' }, [
							E('div', { 'class': 'sbl-section' }, [
								E('h4', {}, '基础'),
								field('运行模式', select('sbl-mode', mode, [ [ 'singbox_mosdns', 'sing-box + mosdns' ], [ 'singbox_dns', 'sing-box' ] ])),
								field('配置路径', input('sbl-config-path', configPath)),
								field('日志路径', input('sbl-log-path', logPath))
							]),
							E('div', { 'class': 'sbl-section' }, [
								E('h4', {}, '远程配置'),
								field('JSON URL', input('sbl-remote-url', remoteUrl, 'https://example.com/sing-box.json')),
								field('自动更新', toggle('sbl-remote-auto', remoteAuto, '每天 ' + remoteTime)),
								field('检查后应用', toggle('sbl-remote-apply', remoteApply, '启用'))
							]),
							E('div', { 'class': 'sbl-section' }, [
								E('h4', {}, 'MosDNS 联动'),
								field('MosDNS 地址', input('sbl-mosdns-addr', mosdnsAddr)),
								field('MosDNS 端口', input('sbl-mosdns-port', mosdnsPort)),
								field('应用后重启', toggle('sbl-mosdns-restart', true, '启用'))
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
								E('div', { 'class': 'sbl-flow-row' }, [ E('span', {}, '1. 导入'), E('b', {}, '本地或远程 JSON') ]),
								E('div', { 'class': 'sbl-flow-row' }, [ E('span', {}, '3. 备份'), E('b', {}, '保留旧配置') ])
							]),
							E('div', {}, [
								E('div', { 'class': 'sbl-flow-row' }, [ E('span', {}, '2. 检查'), E('b', {}, 'sing-box check') ]),
								E('div', { 'class': 'sbl-flow-row' }, [ E('span', {}, '4. 应用'), E('b', {}, '重启相关服务') ])
							])
						])
					])
				])
			]),
			E('div', { 'class': 'sbl-footer' }, [
				E('button', { 'class': 'sbl-btn primary', 'click': function() { return saveSettings('已保存并应用设置', true); } }, '✓ 保存并应用'),
				E('button', { 'class': 'sbl-btn', 'click': function() { return saveSettings('已保存设置'); } }, '保存'),
				E('button', { 'class': 'sbl-btn danger', 'click': function() { location.reload(); } }, '重置')
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
