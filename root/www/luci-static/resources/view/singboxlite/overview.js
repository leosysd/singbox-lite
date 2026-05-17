'use strict';
'require form';
'require rpc';
'require ui';
'require uci';
'require view';

var LOCAL_TEMP = '/tmp/singboxlite/import-local.json';

var callStatus = rpc.declare({
	object: 'luci.singboxlite',
	method: 'status',
	expect: { '': {} }
});

var callCheckCurrent = rpc.declare({
	object: 'luci.singboxlite',
	method: 'check_current',
	expect: { '': {} }
});

var callBackup = rpc.declare({
	object: 'luci.singboxlite',
	method: 'backup_current',
	expect: { '': {} }
});

var callDeleteBackups = rpc.declare({
	object: 'luci.singboxlite',
	method: 'delete_backups',
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

var callFetchRemote = rpc.declare({
	object: 'luci.singboxlite',
	method: 'fetch_remote',
	params: [ 'url' ],
	expect: { '': {} }
});

var callCheckImported = rpc.declare({
	object: 'luci.singboxlite',
	method: 'check_imported',
	params: [ 'source' ],
	expect: { '': {} }
});

var callApplyImported = rpc.declare({
	object: 'luci.singboxlite',
	method: 'apply_imported',
	params: [ 'source' ],
	expect: { '': {} }
});

function modeText(mode) {
	if (mode === 'singbox_mosdns')
		return 'sing-box + mosdns';
	return 'sing-box';
}

function notify(title, res) {
	ui.addNotification(null, E('pre', { 'class': res.ok ? '' : 'errors' }, [
		title + '\n' + (res.output || res.backup || (res.ok ? '操作成功' : '操作失败'))
	]), res.ok ? 'info' : 'error');
}

function statCard(label, value, meta, cls) {
	return E('div', { 'class': 'sbl-stat' }, [
		E('div', { 'class': 'sbl-stat-label' }, label),
		E('div', { 'class': 'sbl-stat-value ' + (cls || '') }, value || '-'),
		meta ? E('div', { 'class': 'sbl-stat-meta' }, meta) : ''
	]);
}

function renderCss() {
	return E('style', {}, `
		.sbl-page{color:#344054}
		.sbl-page .sbl-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin:0 0 14px}
		.sbl-page .sbl-title h2{margin:0 0 6px;font-size:22px;color:#344054}
		.sbl-page .sbl-title p{margin:0;color:#667085}
		.sbl-page .sbl-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
		.sbl-page .sbl-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:14px 0}
		.sbl-page .sbl-stat,.sbl-page .cbi-section{background:#fff;border:1px solid #d8dee6;border-radius:8px;box-shadow:0 1px 2px rgba(16,24,40,.03)}
		.sbl-page .sbl-stat{padding:14px 16px;min-height:74px}
		.sbl-page .sbl-stat-label{font-size:12px;color:#667085;margin-bottom:7px}
		.sbl-page .sbl-stat-value{font-size:15px;font-weight:700;color:#344054;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.sbl-page .sbl-stat-value.ok{color:#047857}
		.sbl-page .sbl-stat-value.warn{color:#b45309}
		.sbl-page .sbl-stat-meta{margin-top:6px;font-size:12px;color:#98a2b3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.sbl-page .cbi-section{padding:16px;margin:0 0 14px}
		.sbl-page .cbi-section h3{font-size:15px;color:#344054;margin-bottom:14px}
		.sbl-page .sbl-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
		.sbl-page .sbl-import-box{border:1px solid #e4e7ec;border-radius:8px;padding:16px;background:#fcfcfd;min-height:140px;display:flex;flex-direction:column;justify-content:space-between}
		.sbl-page .sbl-import-box h4{font-size:15px;margin:0 0 8px;color:#344054}
		.sbl-page .sbl-import-box p{margin:0 0 14px;color:#667085;line-height:1.6}
		.sbl-page .sbl-status-note{color:#667085;margin-top:8px}
		.sbl-page .cbi-value-title{min-width:220px}
		@media(max-width:1100px){.sbl-page .sbl-head{align-items:flex-start;flex-direction:column}.sbl-page .sbl-actions{justify-content:flex-start}.sbl-page .sbl-stats,.sbl-page .sbl-two{grid-template-columns:1fr}}
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
		var dnsLine = status.mosdns_running
			? 'MosDNS %s:%s'.format(status.mosdns_addr || '127.0.0.1', status.mosdns_port || '5335')
			: (status.mosdns_installed ? 'MosDNS 未运行' : 'MosDNS 未安装');
		var m, s, o, remoteUrlOption;

		m = new form.Map('singboxlite');
		m.render = L.bind(function(renderOriginal) {
			return renderOriginal.call(m).then(function(node) {
				node.classList.add('sbl-page');
				node.insertBefore(renderCss(), node.firstChild);
				node.insertBefore(E('div', { 'class': 'sbl-head' }, [
					E('div', { 'class': 'sbl-title' }, [
						E('h2', {}, 'SingBox Lite'),
						E('p', {}, '导入本地或远程 sing-box JSON，并选择 sing-box 与 MosDNS 的运行方式。')
					]),
					E('div', { 'class': 'sbl-actions' }, [
						E('button', { 'class': 'btn cbi-button-action', 'click': function() {
							return callCheckCurrent().then(function(res) { notify('检查配置', res); });
						} }, '检查配置'),
						E('button', { 'class': 'btn cbi-button-action', 'click': function() {
							return callBackup().then(function(res) { notify('备份配置', res); });
						} }, '备份配置'),
						E('button', { 'class': 'btn cbi-button-negative', 'click': function() {
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
						} }, '删除备份'),
						E('button', { 'class': 'btn cbi-button-apply', 'click': function() {
							return callRestartSingbox().then(function(res) { notify('重启 sing-box', res); });
						} }, '重启 sing-box'),
						E('button', { 'class': 'btn cbi-button-action', 'click': function() {
							return callRestartMosdns().then(function(res) { notify('重启 MosDNS', res); });
						} }, '重启 MosDNS'),
						E('button', { 'class': 'btn cbi-button-action', 'click': function() {
							location.href = L.url('admin/services/singboxlite/logs');
						} }, '查看日志')
					])
				]), node.firstChild.nextSibling);
				node.insertBefore(E('div', { 'class': 'sbl-stats' }, [
					statCard('sing-box', status.singbox_running ? '运行中' : (status.singbox_installed ? '未运行' : '未安装'), status.singbox_version || '', status.singbox_running ? 'ok' : 'warn'),
					statCard('配置', status.config_path || '/etc/sing-box/config.json', '备份 ' + (status.backup_count || 0) + ' 个'),
					statCard('DNS', dnsLine, status.dns_hijack_script_installed ? '清理脚本已安装' : '清理脚本未安装', status.mosdns_running ? 'ok' : 'warn'),
					statCard('模式', modeText(status.mode), '当前运行模式')
				]), node.firstChild.nextSibling.nextSibling);
				return node;
			});
		}, m, m.render);

		s = m.section(form.TypedSection, null, '配置导入');
		s.anonymous = true;
		s.addremove = false;
		s.render = function() {
			return E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, '配置导入'),
				E('div', { 'class': 'sbl-two' }, [
					E('div', { 'class': 'sbl-import-box' }, [
						E('div', {}, [
							E('h4', {}, '本地 JSON 配置'),
							E('p', {}, '上传 sing-box 原生 JSON 到临时路径，先检查，通过后再应用。')
						]),
						E('div', {}, [
							E('button', { 'class': 'btn cbi-button-action', 'click': function(ev) {
								return ui.uploadFile(LOCAL_TEMP, ev.target).then(function() {
									return callCheckImported('local').then(function(res) { notify('本地配置检查', res); });
								}).catch(function(e) {
									ui.addNotification(null, E('p', e.message), 'error');
								});
							} }, '上传并检查'),
							' ',
							E('button', { 'class': 'btn cbi-button-apply', 'click': function() {
								return callApplyImported('local').then(function(res) { notify('应用本地配置', res); });
							} }, '应用本地配置')
						])
					]),
					E('div', { 'class': 'sbl-import-box' }, [
						E('div', {}, [
							E('h4', {}, '远程 URL 配置'),
							E('p', {}, '远程 URL 在下方设置区填写。保存后可在这里拉取、检查、应用。')
						]),
						E('div', {}, [
							E('button', { 'class': 'btn cbi-button-action', 'click': function() {
								var url = uci.get('singboxlite', 'remote', 'url') || '';
								return callFetchRemote(url).then(function(res) { notify('远程配置检查', res); });
							} }, '拉取并检查'),
							' ',
							E('button', { 'class': 'btn cbi-button-apply', 'click': function() {
								return callApplyImported('remote').then(function(res) { notify('应用远程配置', res); });
							} }, '应用远程配置')
						])
					])
				])
			]);
		};

		s = m.section(form.NamedSection, 'main', 'main', '基础设置');

		o = s.option(form.ListValue, 'mode', '运行模式');
		o.value('singbox_mosdns', 'sing-box + mosdns');
		o.value('singbox_dns', 'sing-box');
		o.default = 'singbox_mosdns';
		o.rmempty = false;

		o = s.option(form.Value, 'config_path', 'sing-box 配置路径');
		o.default = '/etc/sing-box/config.json';
		o.rmempty = false;

		o = s.option(form.Value, 'log_path', 'sing-box 日志路径');
		o.default = '/etc/sing-box/sing-box.log';
		o.rmempty = false;

		s = m.section(form.NamedSection, 'remote', 'remote', '远程配置');

		remoteUrlOption = s.option(form.Value, 'url', '远程 JSON URL');
		remoteUrlOption.placeholder = 'https://example.com/sing-box.json';
		remoteUrlOption.rmempty = true;

		o = s.option(form.Flag, 'auto_update', '自动更新远程配置');
		o.default = o.disabled;
		o.rmempty = false;

		o = s.option(form.Value, 'auto_update_time', '更新时间');
		o.placeholder = '03:00';
		o.default = '03:00';
		o.depends('auto_update', '1');

		o = s.option(form.Flag, 'auto_apply', '检查通过后自动应用');
		o.default = o.disabled;
		o.depends('auto_update', '1');

		s = m.section(form.NamedSection, 'dns', 'dns', 'MosDNS 联动');

		o = s.option(form.Value, 'mosdns_addr', 'MosDNS 地址');
		o.default = '127.0.0.1';

		o = s.option(form.Value, 'mosdns_port', 'MosDNS 端口');
		o.datatype = 'port';
		o.default = '5335';

		s = m.section(form.TypedSection, null, '运行概况');
		s.anonymous = true;
		s.addremove = false;
		s.render = function() {
			return E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, '运行概况'),
				E('div', { 'class': 'sbl-two' }, [
					E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, 'sing-box 版本'), E('div', { 'class': 'cbi-value-field' }, status.singbox_version || '-') ]),
					E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, 'PID'), E('div', { 'class': 'cbi-value-field' }, status.singbox_pid || '-') ]),
					E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, 'MosDNS'), E('div', { 'class': 'cbi-value-field' }, status.mosdns_running ? 'running' : 'not running') ]),
					E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, '日志大小'), E('div', { 'class': 'cbi-value-field' }, '%1024.2mB'.format((status.log_size || 0) * 1024)) ]),
					E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, '上次检查'), E('div', { 'class': 'cbi-value-field' }, status.last_check_result || '-') ]),
					E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, '上次应用'), E('div', { 'class': 'cbi-value-field' }, status.last_apply_time || '-') ])
				])
			]);
		};

		return m.render();
	}
});
