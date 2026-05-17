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

function badge(text, kind) {
	return E('span', { 'class': 'singboxlite-badge singboxlite-badge-' + (kind || 'neutral') }, text);
}

function field(label, value) {
	return E('div', { 'class': 'singboxlite-field' }, [
		E('span', { 'class': 'singboxlite-field-label' }, label),
		E('span', { 'class': 'singboxlite-field-value' }, value || '-')
	]);
}

function panel(title, body) {
	return E('div', { 'class': 'singboxlite-panel' }, [
		E('h3', {}, title),
		E('div', {}, body)
	]);
}

function notifyResult(title, res) {
	ui.addNotification(null, E('pre', { 'class': 'errors' }, [
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

		var root = E('div', { 'class': 'singboxlite' }, [
			E('style', {}, `
				.singboxlite .status-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:12px 0 16px}
				.singboxlite .status-cell,.singboxlite-panel{background:#fff;border:1px solid #d8dee6;border-radius:8px;padding:14px}
				.singboxlite .status-cell strong{display:block;color:#1f2937;margin-bottom:4px}
				.singboxlite .toolbar{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}
				.singboxlite .layout{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(360px,.7fr);gap:16px}
				.singboxlite .grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
				.singboxlite-panel h3{font-size:15px;margin:0 0 12px}
				.singboxlite-field{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid #eef1f5}
				.singboxlite-field:last-child{border-bottom:0}
				.singboxlite-field-label{color:#667085}
				.singboxlite-field-value{font-weight:600;text-align:right;word-break:break-all}
				.singboxlite-badge{display:inline-flex;align-items:center;border-radius:6px;padding:2px 8px;font-weight:600}
				.singboxlite-badge-ok{color:#047857;background:#d1fae5}
				.singboxlite-badge-warn{color:#92400e;background:#fef3c7}
				.singboxlite-badge-neutral{color:#334155;background:#e2e8f0}
				.singboxlite-log{font-family:monospace;white-space:pre-wrap;background:#0f172a;color:#dbeafe;border-radius:8px;padding:12px;min-height:210px;overflow:auto}
				@media(max-width:900px){.singboxlite .status-strip,.singboxlite .layout,.singboxlite .grid2{grid-template-columns:1fr}}
			`),
			E('h2', {}, 'SingBox Lite'),
			E('p', {}, '安全导入 sing-box JSON 配置，并选择 sing-box 与 MosDNS 的运行方式。'),
			E('div', { 'class': 'status-strip', id: 'status-strip' }, [
				E('div', { 'class': 'status-cell' }, [ E('strong', {}, 'sing-box'), status.singbox_running ? badge('运行中', 'ok') : badge(status.singbox_installed ? '未运行' : '未安装', 'warn') ]),
				E('div', { 'class': 'status-cell' }, [ E('strong', {}, '配置'), status.config_path || '-' ]),
				E('div', { 'class': 'status-cell' }, [ E('strong', {}, 'DNS'), status.mosdns_running ? 'MosDNS %s:%s'.format(status.mosdns_addr, status.mosdns_port) : 'MosDNS 未运行' ]),
				E('div', { 'class': 'status-cell' }, [ E('strong', {}, '模式'), modeText(status.mode) ])
			]),
			E('div', { 'class': 'toolbar' }, [
				E('button', { 'class': 'btn cbi-button-action', 'click': function() { return callCheck().then(function(res) { notifyResult('配置检查', res); }); } }, '检查配置'),
				E('button', { 'class': 'btn cbi-button-action', 'click': function() { return callBackup().then(function(res) { notifyResult('备份配置', res); }); } }, '备份配置'),
				E('button', { 'class': 'btn cbi-button-apply', 'click': function() { return callRestartSingbox().then(function(res) { notifyResult('重启 sing-box', res); }); } }, '重启 sing-box'),
				E('button', { 'class': 'btn cbi-button-action', 'click': function() { return callRestartMosdns().then(function(res) { notifyResult('重启 MosDNS', res); }); } }, '重启 MosDNS'),
				E('button', { 'class': 'btn cbi-button-negative', 'click': function() {
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
				} }, '清理日志')
			]),
			E('div', { 'class': 'layout' }, [
				E('div', {}, [
					panel('配置导入', E('div', { 'class': 'grid2' }, [
						E('div', {}, [
							E('h4', {}, '本地 JSON 配置'),
							E('p', {}, '上传 sing-box 原生 JSON，先检查再应用。'),
							E('a', { 'class': 'btn cbi-button-action', 'href': L.url('admin/services/singboxlite/import') }, '打开本地导入')
						]),
						E('div', {}, [
							E('h4', {}, '远程 URL 配置'),
							E('p', {}, '从 URL 拉取 JSON，支持保存远程地址。'),
							E('a', { 'class': 'btn cbi-button-action', 'href': L.url('admin/services/singboxlite/import') }, '打开远程导入')
						])
					])),
					panel('运行模式', E('div', {}, [
						field('当前模式', modeText(status.mode)),
						field('MosDNS 地址', '%s:%s'.format(status.mosdns_addr || '127.0.0.1', status.mosdns_port || '5335')),
						E('a', { 'class': 'btn cbi-button-action', 'href': L.url('admin/services/singboxlite/mode') }, '调整运行模式')
					]))
				]),
				E('div', {}, [
					panel('运行概况', E('div', {}, [
						field('sing-box 版本', status.singbox_version || '-'),
						field('PID', status.singbox_pid || '-'),
						field('MosDNS', status.mosdns_running ? 'running' : 'not running'),
						field('日志大小', '%1024.2mB'.format((status.log_size || 0) * 1024)),
						field('上次检查', status.last_check_result || '-'),
						field('上次应用', status.last_apply_time || '-')
					])),
					panel('最近日志', E('pre', { 'class': 'singboxlite-log' }, logs.log || '暂无日志'))
				])
			])
		]);

		poll.add(function() {
			return L.resolveDefault(callStatus(), {}).then(function(s) {
				var cells = document.querySelectorAll('#status-strip .status-cell');
				if (cells.length >= 4) {
					cells[0].lastChild.textContent = s.singbox_running ? '运行中' : (s.singbox_installed ? '未运行' : '未安装');
					cells[1].lastChild.textContent = s.config_path || '-';
					cells[2].lastChild.textContent = s.mosdns_running ? 'MosDNS %s:%s'.format(s.mosdns_addr, s.mosdns_port) : 'MosDNS 未运行';
					cells[3].lastChild.textContent = modeText(s.mode);
				}
			});
		});

		return root;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
