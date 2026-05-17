'use strict';
'require poll';
'require rpc';
'require ui';
'require view';

var callStatus = rpc.declare({
	object: 'luci.singboxlite',
	method: 'status',
	expect: { '': {} }
});

var callCheck = rpc.declare({
	object: 'luci.singboxlite',
	method: 'check_current',
	expect: { '': {} }
});

var callBackup = rpc.declare({
	object: 'luci.singboxlite',
	method: 'backup_current',
	expect: { '': {} }
});

var callRestartSingbox = rpc.declare({
	object: 'luci.singboxlite',
	method: 'restart_singbox',
	expect: { '': {} }
});

var callRestartMosdns = rpc.declare({
	object: 'luci.singboxlite',
	method: 'restart_mosdns',
	expect: { '': {} }
});

var callCleanLog = rpc.declare({
	object: 'luci.singboxlite',
	method: 'clean_log',
	expect: { '': {} }
});

var callTailLog = rpc.declare({
	object: 'luci.singboxlite',
	method: 'tail_log',
	params: [ 'lines', 'filter' ],
	expect: { '': {} }
});

function modeText(mode) {
	if (mode === 'singbox_mosdns')
		return 'sing-box + mosdns';
	if (mode === 'singbox_dns')
		return '仅 sing-box DNS';
	return '仅导入配置';
}

function okText(value, ok, warn) {
	return E('span', { 'class': 'sbl-pill ' + (ok ? 'ok' : (warn ? 'warn' : 'muted')) }, value);
}

function statCard(label, value, meta, cls) {
	return E('div', { 'class': 'sbl-stat' }, [
		E('div', { 'class': 'sbl-stat-label' }, label),
		E('div', { 'class': 'sbl-stat-value ' + (cls || '') }, value || '-'),
		meta ? E('div', { 'class': 'sbl-stat-meta' }, meta) : ''
	]);
}

function kv(label, value) {
	return E('div', { 'class': 'sbl-kv' }, [
		E('span', {}, label),
		E('strong', {}, value || '-')
	]);
}

function section(title, body, extraClass) {
	return E('section', { 'class': 'sbl-section ' + (extraClass || '') }, [
		E('div', { 'class': 'sbl-section-title' }, title),
		body
	]);
}

function actionButton(text, cls, fn) {
	return E('button', { 'class': 'btn ' + cls, 'click': fn }, text);
}

function notifyResult(title, res) {
	ui.addNotification(null, E('pre', { 'class': res.ok ? '' : 'errors' }, [
		title + '\n' + (res.output || res.backup || (res.ok ? '操作成功' : '操作失败'))
	]), res.ok ? 'info' : 'error');
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callStatus(), {}),
			L.resolveDefault(callTailLog(8, ''), {})
		]);
	},

	render: function(data) {
		var status = data[0] || {};
		var logs = data[1] || {};
		var dnsLine = status.mosdns_running
			? 'MosDNS %s:%s'.format(status.mosdns_addr || '127.0.0.1', status.mosdns_port || '5335')
			: (status.mosdns_installed ? 'MosDNS 未运行' : 'MosDNS 未安装');

		return E('div', { 'class': 'singboxlite sbl-page' }, [
			E('style', {}, `
				.sbl-page{color:#344054}
				.sbl-page .sbl-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin:0 0 14px}
				.sbl-page .sbl-title h2{margin:0 0 6px;font-size:22px;color:#344054}
				.sbl-page .sbl-title p{margin:0;color:#667085}
				.sbl-page .sbl-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
				.sbl-page .sbl-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:14px 0}
				.sbl-page .sbl-stat,.sbl-page .sbl-section{background:#fff;border:1px solid #d8dee6;border-radius:8px;box-shadow:0 1px 2px rgba(16,24,40,.03)}
				.sbl-page .sbl-stat{padding:14px 16px;min-height:74px}
				.sbl-page .sbl-stat-label{font-size:12px;color:#667085;margin-bottom:7px}
				.sbl-page .sbl-stat-value{font-size:15px;font-weight:700;color:#344054;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
				.sbl-page .sbl-stat-value.ok{color:#047857}
				.sbl-page .sbl-stat-value.warn{color:#b45309}
				.sbl-page .sbl-stat-meta{margin-top:6px;font-size:12px;color:#98a2b3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
				.sbl-page .sbl-main{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(380px,.85fr);gap:14px;align-items:start}
				.sbl-page .sbl-left,.sbl-page .sbl-right{display:flex;flex-direction:column;gap:14px}
				.sbl-page .sbl-section{padding:16px}
				.sbl-page .sbl-section-title{font-size:15px;font-weight:700;color:#344054;margin-bottom:14px}
				.sbl-page .sbl-import-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
				.sbl-page .sbl-import-box{border:1px solid #e4e7ec;border-radius:8px;padding:16px;background:#fcfcfd;min-height:138px;display:flex;flex-direction:column;justify-content:space-between}
				.sbl-page .sbl-import-box h3{font-size:15px;margin:0 0 8px;color:#344054}
				.sbl-page .sbl-import-box p{margin:0 0 14px;color:#667085;line-height:1.6}
				.sbl-page .sbl-mode-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
				.sbl-page .sbl-pill{display:inline-flex;align-items:center;border-radius:7px;padding:5px 10px;font-weight:700;border:1px solid transparent}
				.sbl-page .sbl-pill.ok{color:#047857;background:#d1fae5;border-color:#a7f3d0}
				.sbl-page .sbl-pill.warn{color:#b45309;background:#fef3c7;border-color:#fde68a}
				.sbl-page .sbl-pill.muted{color:#475467;background:#f2f4f7;border-color:#e4e7ec}
				.sbl-page .sbl-kv{display:flex;justify-content:space-between;gap:14px;padding:9px 0;border-bottom:1px solid #edf1f5}
				.sbl-page .sbl-kv:last-child{border-bottom:0}
				.sbl-page .sbl-kv span{color:#667085}
				.sbl-page .sbl-kv strong{text-align:right;color:#344054;word-break:break-all}
				.sbl-page .sbl-log{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;background:#0f172a;color:#dbeafe;border-radius:8px;padding:14px;min-height:260px;max-height:360px;overflow:auto;margin:0}
				.sbl-page .sbl-result{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
				.sbl-page a.btn{display:inline-flex;align-items:center;width:max-content}
				@media(max-width:1100px){.sbl-page .sbl-main,.sbl-page .sbl-stats,.sbl-page .sbl-import-grid,.sbl-page .sbl-result{grid-template-columns:1fr}.sbl-page .sbl-head{align-items:flex-start;flex-direction:column}.sbl-page .sbl-actions{justify-content:flex-start}}
			`),

			E('div', { 'class': 'sbl-head' }, [
				E('div', { 'class': 'sbl-title' }, [
					E('h2', {}, 'SingBox Lite'),
					E('p', {}, '导入本地或远程 sing-box JSON，并选择 sing-box 与 MosDNS 的运行方式。')
				]),
				E('div', { 'class': 'sbl-actions' }, [
					actionButton('检查配置', 'cbi-button-action', function() {
						return callCheck().then(function(res) { notifyResult('配置检查', res); });
					}),
					actionButton('备份配置', 'cbi-button-action', function() {
						return callBackup().then(function(res) { notifyResult('备份配置', res); });
					}),
					actionButton('重启 sing-box', 'cbi-button-apply', function() {
						return callRestartSingbox().then(function(res) { notifyResult('重启 sing-box', res); });
					}),
					actionButton('重启 MosDNS', 'cbi-button-action', function() {
						return callRestartMosdns().then(function(res) { notifyResult('重启 MosDNS', res); });
					}),
					actionButton('清理日志', 'cbi-button-negative', function() {
						return ui.showModal('确认清理日志', [
							E('p', {}, '确定要清空 sing-box 日志吗？'),
							E('div', { 'class': 'right' }, [
								E('button', { 'class': 'btn', 'click': ui.hideModal }, '取消'),
								E('button', { 'class': 'btn cbi-button-negative', 'click': function() {
									ui.hideModal();
									return callCleanLog().then(function(res) { notifyResult('清理日志', res); });
								} }, '清理')
							])
						]);
					})
				])
			]),

			E('div', { 'class': 'sbl-stats' }, [
				statCard('sing-box', status.singbox_running ? '运行中' : (status.singbox_installed ? '未运行' : '未安装'), status.singbox_version || '', status.singbox_running ? 'ok' : 'warn'),
				statCard('配置', status.config_path || '/etc/sing-box/config.json', '当前配置文件'),
				statCard('DNS', dnsLine, 'MosDNS 联动', status.mosdns_running ? 'ok' : 'warn'),
				statCard('模式', modeText(status.mode), '当前运行模式')
			]),

			E('div', { 'class': 'sbl-main' }, [
				E('div', { 'class': 'sbl-left' }, [
					section('配置导入', E('div', { 'class': 'sbl-import-grid' }, [
						E('div', { 'class': 'sbl-import-box' }, [
							E('div', {}, [
								E('h3', {}, '本地 JSON 配置'),
								E('p', {}, '上传 sing-box 原生 JSON，先检查，通过后再应用到路由器。')
							]),
							E('a', { 'class': 'btn cbi-button-action', 'href': L.url('admin/services/singboxlite/import') }, '打开本地导入')
						]),
						E('div', { 'class': 'sbl-import-box' }, [
							E('div', {}, [
								E('h3', {}, '远程 URL 配置'),
								E('p', {}, '从 URL 拉取 JSON，支持自动更新，拉取后同样先检查。')
							]),
							E('a', { 'class': 'btn cbi-button-action', 'href': L.url('admin/services/singboxlite/import') }, '打开远程导入')
						])
					])),

					section('运行模式', E('div', {}, [
						E('div', { 'class': 'sbl-mode-row' }, [
							okText('sing-box + mosdns', status.mode === 'singbox_mosdns', false),
							okText('仅 sing-box DNS', status.mode === 'singbox_dns', false),
							okText('仅导入配置', status.mode === 'import_only', false)
						]),
						kv('当前模式', modeText(status.mode)),
						kv('MosDNS 地址', '%s:%s'.format(status.mosdns_addr || '127.0.0.1', status.mosdns_port || '5335')),
						kv('禁用 DNS 劫持', '开启'),
						kv('应用后重启 MosDNS', status.mode === 'singbox_mosdns' ? '开启' : '不适用'),
						E('p', {}, E('a', { 'class': 'btn cbi-button-action', 'href': L.url('admin/services/singboxlite/mode') }, '调整运行模式'))
					])),

					section('配置检查结果', E('div', { 'class': 'sbl-result' }, [
						E('div', {}, [
							kv('上次检查', status.last_check_result || '-'),
							kv('检查时间', status.last_check_time || '-')
						]),
						E('div', {}, [
							kv('上次应用', status.last_apply_time || '-'),
							kv('远程 URL', status.remote_url || '-')
						])
					]))
				]),

				E('div', { 'class': 'sbl-right' }, [
					section('运行概况', E('div', {}, [
						kv('sing-box 版本', status.singbox_version || '-'),
						kv('PID', status.singbox_pid || '-'),
						kv('MosDNS', status.mosdns_running ? 'running' : 'not running'),
						kv('日志大小', '%1024.2mB'.format((status.log_size || 0) * 1024)),
						kv('配置路径', status.config_path || '-')
					])),
					section('最近日志', E('pre', { 'class': 'sbl-log' }, logs.log || '暂无日志'))
				])
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
