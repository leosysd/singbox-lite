'use strict';
'require form';
'require rpc';
'require ui';
'require uci';
'require view';

var callStatus = rpc.declare({
	object: 'luci.singboxlite',
	method: 'status',
	expect: { '': {} }
});

var callUpdateRuleset = rpc.declare({
	object: 'luci.singboxlite',
	method: 'update_ruleset',
	expect: { '': {} }
});

var callRulesetStatus = rpc.declare({
	object: 'luci.singboxlite',
	method: 'ruleset_status',
	expect: { '': {} }
});

var callClearRulesetLog = rpc.declare({
	object: 'luci.singboxlite',
	method: 'clear_ruleset_log',
	expect: { '': {} }
});

var callSetCron = rpc.declare({
	object: 'luci.singboxlite',
	method: 'set_cron',
	expect: { '': {} }
});

function notify(title, res) {
	ui.addNotification(null, E('pre', { 'class': res.ok ? '' : 'errors' }, [
		title + '\n' + (res.output || (res.ok ? '操作成功' : '操作失败'))
	]), res.ok ? 'info' : 'error');
}

function stat(label, value, meta, cls) {
	return E('div', { 'class': 'sblr-stat' }, [
		E('div', { 'class': 'sblr-stat-label' }, label),
		E('div', { 'class': 'sblr-stat-value ' + (cls || '') }, value || '-'),
		meta ? E('div', { 'class': 'sblr-stat-meta' }, meta) : ''
	]);
}

function css() {
	return E('style', {}, `
		.sblr-page{color:#344054}
		.sblr-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin:0 0 14px}
		.sblr-head h2{margin:0 0 6px;font-size:22px;color:#344054}
		.sblr-head p{margin:0;color:#667085}
		.sblr-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
		.sblr-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0 0 14px}
		.sblr-stat,.sblr-page .cbi-section{background:#fff;border:1px solid #d8dee6;border-radius:8px;box-shadow:0 1px 2px rgba(16,24,40,.03)}
		.sblr-stat{padding:14px 16px;min-height:74px}
		.sblr-stat-label{font-size:12px;color:#667085;margin-bottom:7px}
		.sblr-stat-value{font-size:15px;font-weight:700;color:#344054;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.sblr-stat-value.ok{color:#047857}
		.sblr-stat-value.warn{color:#b45309}
		.sblr-stat-meta{margin-top:6px;font-size:12px;color:#98a2b3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.sblr-page .cbi-section{padding:16px;margin:0 0 14px}
		.sblr-page .cbi-section h3{font-size:15px;color:#344054;margin-bottom:14px}
		.sblr-output{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;background:#0f172a;color:#dbeafe;border-radius:8px;padding:14px;min-height:180px;max-height:360px;overflow:auto;margin:0}
		.sblr-page .cbi-value-title{min-width:220px}
		@media(max-width:1100px){.sblr-head{align-items:flex-start;flex-direction:column}.sblr-actions{justify-content:flex-start}.sblr-stats{grid-template-columns:1fr}}
	`);
}

function setOutput(text) {
	var node = document.getElementById('sblr-output');
	if (node)
		node.textContent = text || '暂无输出';
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('singboxlite'),
			L.resolveDefault(callStatus(), {}),
			L.resolveDefault(callRulesetStatus(), {})
		]);
	},

	render: function(data) {
		var status = data[1] || {};
		var rules = data[2] || {};
		var m, s, o;

		m = new form.Map('singboxlite');
		m.render = L.bind(function(renderOriginal) {
			return renderOriginal.call(m).then(function(node) {
				node.classList.add('sblr-page');
				node.insertBefore(css(), node.firstChild);
				node.insertBefore(E('div', { 'class': 'sblr-head' }, [
					E('div', {}, [
						E('h2', {}, '规则集'),
						E('p', {}, '内置 leosysd/ruleset 路由器侧更新器，可自定义 sing-box 与 MosDNS 规则输出目录。')
					]),
					E('div', { 'class': 'sblr-actions' }, [
						E('button', { 'class': 'btn cbi-button-apply', 'click': function() {
							return m.save().then(function() {
								setOutput('正在更新规则集...');
								return callUpdateRuleset().then(function(res) {
									notify('更新规则集', res);
									setOutput(res.output);
								});
							});
						} }, '立即更新规则集'),
						E('button', { 'class': 'btn cbi-button-action', 'click': function() {
							return callRulesetStatus().then(function(res) {
								notify('规则状态', res);
								setOutput(res.output);
							});
						} }, '查看状态'),
						E('button', { 'class': 'btn cbi-button-action', 'click': function() {
							return m.save().then(function() {
								return callSetCron().then(function(res) {
									ui.addNotification(null, E('p', res.changed ? '已写入定时任务' : '定时任务无需变更'), 'info');
								});
							});
						} }, '写入定时任务'),
						E('button', { 'class': 'btn cbi-button-negative', 'click': function() {
							return callClearRulesetLog().then(function(res) {
								notify('清理规则日志', res);
							});
						} }, '清理日志')
					])
				]), node.firstChild.nextSibling);
				node.insertBefore(E('div', { 'class': 'sblr-stats' }, [
					stat('sing-box 目录', status.ruleset_singbox_dir || '/etc/sing-box/rule-set', '输出 .srs / .json'),
					stat('MosDNS 目录', status.ruleset_mosdns_dir || '/etc/mosdns/rule', '输出 .txt'),
					stat('上次更新', status.ruleset_last_update_result || '-', status.ruleset_last_update_time || '', status.ruleset_last_update_result === 'pass' ? 'ok' : 'warn')
				]), node.firstChild.nextSibling.nextSibling);
				return node;
			});
		}, m, m.render);

		s = m.section(form.NamedSection, 'ruleset', 'ruleset', '规则集设置');

		o = s.option(form.Value, 'repo_raw', 'dist 源地址');
		o.default = 'https://raw.githubusercontent.com/leosysd/ruleset/main/dist';
		o.rmempty = false;

		o = s.option(form.Value, 'singbox_dir', 'sing-box 规则目录');
		o.default = '/etc/sing-box/rule-set';
		o.rmempty = false;

		o = s.option(form.Value, 'mosdns_dir', 'MosDNS 规则目录');
		o.default = '/etc/mosdns/rule';
		o.rmempty = false;

		o = s.option(form.Flag, 'auto_update', '自动更新规则集');
		o.default = o.enabled;
		o.rmempty = false;

		o = s.option(form.Value, 'update_time', '更新时间');
		o.default = '07:45';
		o.placeholder = '07:45';
		o.depends('auto_update', '1');

		o = s.option(form.ListValue, 'update_weekday', '更新星期');
		o.value('1', '周一');
		o.value('2', '周二');
		o.value('3', '周三');
		o.value('4', '周四');
		o.value('5', '周五');
		o.value('6', '周六');
		o.value('0', '周日');
		o.default = '2';
		o.depends('auto_update', '1');

		o = s.option(form.Flag, 'restart_singbox', '更新后重启 sing-box');
		o.default = o.disabled;
		o.rmempty = false;

		o = s.option(form.Flag, 'restart_mosdns', '更新后重启 MosDNS');
		o.default = o.disabled;
		o.rmempty = false;

		s = m.section(form.TypedSection, null, '规则文件状态');
		s.anonymous = true;
		s.addremove = false;
		s.render = function() {
			return E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, '规则文件状态'),
				E('pre', { 'class': 'sblr-output', id: 'sblr-output' }, rules.output || '暂无输出')
			]);
		};

		return m.render();
	}
});
