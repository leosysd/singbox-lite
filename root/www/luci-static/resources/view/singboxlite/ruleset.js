'use strict';
'require rpc';
'require ui';
'require uci';
'require view';

var callStatus = rpc.declare({ object: 'luci.singboxlite', method: 'status', expect: { '': {} } });
var callUpdateRuleset = rpc.declare({ object: 'luci.singboxlite', method: 'update_ruleset', expect: { '': {} } });
var callRulesetStatus = rpc.declare({ object: 'luci.singboxlite', method: 'ruleset_status', expect: { '': {} } });
var callClearRulesetLog = rpc.declare({ object: 'luci.singboxlite', method: 'clear_ruleset_log', expect: { '': {} } });
var callSetCron = rpc.declare({ object: 'luci.singboxlite', method: 'set_cron', expect: { '': {} } });

var WEEKDAYS = [
	[ '1', '周一' ], [ '2', '周二' ], [ '3', '周三' ], [ '4', '周四' ],
	[ '5', '周五' ], [ '6', '周六' ], [ '0', '周日' ]
];

var RULE_FILES = [
	[ 'direct_srs', 'direct-geosite.srs', 'singbox' ],
	[ 'proxy_srs', 'proxy-geosite.srs', 'singbox' ],
	[ 'direct_json', 'direct-geosite.json', 'singbox' ],
	[ 'proxy_json', 'proxy-geosite.json', 'singbox' ],
	[ 'direct_txt', 'direct-geosite.txt', 'mosdns' ],
	[ 'proxy_txt', 'proxy-geosite.txt', 'mosdns' ]
];

function val(id) {
	var el = document.getElementById(id);
	return el ? el.value : '';
}

function yes(id) {
	var el = document.getElementById(id);
	return el && el.checked ? '1' : '0';
}

function refreshChanges() {
	if (ui.changes && ui.changes.init)
		return ui.changes.init();
	return Promise.resolve();
}

function input(id, value, placeholder) {
	return E('input', { id: id, value: value || '', placeholder: placeholder || '', 'class': 'sblr-input' });
}

function select(id, value, opts) {
	return E('select', { id: id, 'class': 'sblr-input' }, opts.map(function(opt) {
		return E('option', { value: opt[0], selected: value === opt[0] }, opt[1]);
	}));
}

function toggle(id, checked, text) {
	return E('label', { 'class': 'sblr-toggle' }, [
		E('input', { id: id, type: 'checkbox', checked: checked ? true : null }),
		E('span', { 'class': 'sblr-switch' }),
		E('b', {}, text || '启用')
	]);
}

function field(label, node) {
	return E('label', { 'class': 'sblr-field' }, [
		E('span', {}, label),
		node
	]);
}

function notify(title, res) {
	ui.addNotification(null, E('pre', { 'class': res.ok ? '' : 'errors' }, [
		title + '\n' + (res.output || (res.ok ? '操作成功' : '操作失败'))
	]), res.ok ? 'info' : 'error');
}

function weekdayName(value) {
	for (var i = 0; i < WEEKDAYS.length; i++) {
		if (WEEKDAYS[i][0] === value)
			return WEEKDAYS[i][1];
	}
	return '周二';
}

function formatBytes(size) {
	size = Number(size || 0);
	if (size >= 1024 * 1024)
		return (size / 1024 / 1024).toFixed(1) + ' MiB';
	if (size >= 1024)
		return (size / 1024).toFixed(1) + ' KiB';
	return size + ' B';
}

function parseRulesetOutput(output, singboxDir, mosdnsDir) {
	var result = {};
	var lines = (output || '').split(/\n/);

	RULE_FILES.forEach(function(file) {
		result[file[0]] = {
			exists: false,
			size: 0,
			path: (file[2] === 'singbox' ? singboxDir : mosdnsDir) + '/' + file[1]
		};
	});

	lines.forEach(function(line) {
		var m = line.match(/^([a-z_]+)=(yes|no)\s+(?:(\d+)\s+bytes\s+)?(.+)$/);
		if (m && result[m[1]]) {
			result[m[1]].exists = m[2] === 'yes';
			result[m[1]].size = Number(m[3] || 0);
			result[m[1]].path = m[4] || result[m[1]].path;
		}
	});

	return result;
}

function statCard(label, value, meta, tone) {
	return E('div', { 'class': 'sblr-stat' }, [
		E('div', { 'class': 'sblr-stat-label' }, label),
		E('div', { 'class': 'sblr-stat-value ' + (tone || '') }, value || '-'),
		E('div', { 'class': 'sblr-stat-meta' }, meta || '-')
	]);
}

function pageTabs(active) {
	return E('div', { 'class': 'sblr-panel sblr-tabs' }, [
		E('button', { 'class': 'sblr-tab ' + (active === 'overview' ? 'active' : ''), 'click': function() { location.href = L.url('admin/services/singboxlite/overview'); } }, '总览'),
		E('button', { 'class': 'sblr-tab ' + (active === 'ruleset' ? 'active' : ''), 'click': function() { location.href = L.url('admin/services/singboxlite/ruleset'); } }, '规则集'),
		E('button', { 'class': 'sblr-tab ' + (active === 'logs' ? 'active' : ''), 'click': function() { location.href = L.url('admin/services/singboxlite/logs'); } }, '日志')
	]);
}

function ruleCard(file, state) {
	return E('div', { 'class': 'sblr-rule' }, [
		E('span', { 'class': 'sblr-dot ' + (state.exists ? 'ok' : 'warn') }),
		E('div', { 'class': 'sblr-rule-main' }, [
			E('b', {}, file[1]),
			E('span', {}, state.path + (state.exists ? ' · ' + formatBytes(state.size) : ''))
		]),
		E('span', { 'class': 'sblr-pill ' + (state.exists ? 'ok' : 'warn') }, state.exists ? '存在' : '缺失')
	]);
}

function saveRuleset(message, writeCron, applyNow) {
	uci.set('singboxlite', 'ruleset', 'repo_raw', val('sblr-repo') || 'https://raw.githubusercontent.com/leosysd/ruleset/main/dist');
	uci.set('singboxlite', 'ruleset', 'singbox_dir', val('sblr-sb-dir') || '/etc/sing-box/rule-set');
	uci.set('singboxlite', 'ruleset', 'mosdns_dir', val('sblr-md-dir') || '/etc/mosdns/rule');
	uci.set('singboxlite', 'ruleset', 'auto_update', yes('sblr-auto'));
	uci.set('singboxlite', 'ruleset', 'update_weekday', val('sblr-weekday') || '2');
	uci.set('singboxlite', 'ruleset', 'update_time', val('sblr-time') || '07:45');
	uci.set('singboxlite', 'ruleset', 'restart_singbox', yes('sblr-restart-sb'));
	uci.set('singboxlite', 'ruleset', 'restart_mosdns', yes('sblr-restart-md'));

	return uci.save().then(function() {
		if (applyNow)
			return uci.apply(10);
	}).then(function() {
		if (writeCron)
			return callSetCron();
	}).then(function(res) {
		if (res && res.ok === false)
			notify('写入定时任务', res);
		return refreshChanges();
	}).then(function() {
		ui.addNotification(null, E('p', {}, message || '已保存规则集设置'), 'info');
	});
}

function css() {
	return E('style', {}, `
		.cbi-tabmenu,.tabs:not(.sbl-tabs):not(.sblr-tabs):not(.sbll-tabs){display:none!important}
		.sblr-page{color:#0f1f35;font-size:12px;margin:-12px;padding:34px 18px 18px;background:linear-gradient(180deg,#5f70e8 0,#5f70e8 76px,#eaf2ff 76px,#f7fbff 100%);min-height:calc(100vh - 110px)}
		.sblr-shell{max-width:1440px;margin:0 auto}
		.sblr-panel{background:rgba(255,255,255,.97);border:1px solid #d5deeb;border-radius:10px;box-shadow:0 14px 34px rgba(64,91,160,.10)}
		.sblr-hero{position:relative;overflow:hidden;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px 10px;margin-bottom:8px;background:linear-gradient(115deg,#204d76 0,#276be2 62%,#60a4ff 100%);border-color:rgba(255,255,255,.28);color:#fff}
		.sblr-hero:after{content:"";position:absolute;right:-42px;top:-32px;width:190px;height:190px;border-radius:999px;background:rgba(255,255,255,.12)}
		.sblr-title,.sblr-actions{position:relative;z-index:1}
		.sblr-tabs{height:38px;display:flex;align-items:center;gap:2px;padding:0 10px;margin:8px 0;border-radius:7px;box-shadow:0 12px 28px rgba(64,91,160,.08)}
		.sblr-tab{height:38px;display:inline-flex;align-items:center;padding:0 14px;border:0;border-bottom:3px solid transparent;background:transparent;color:#4b6382;font-size:12px;font-weight:900;cursor:pointer}
		.sblr-tab.active{color:#2563eb;border-bottom-color:#2563eb}
		.sblr-title h2{margin:0 0 3px;font-size:17px;line-height:1.1;color:#fff}
		.sblr-title p{margin:0;color:rgba(255,255,255,.82);font-size:12px;line-height:1.25}
		.sblr-actions,.sblr-footer{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
		.sblr-actions{justify-content:flex-end}
		.sblr-btn{min-height:26px;border-radius:6px;border:1px solid #b8c7ff;background:#fff;color:#4f62df;padding:0 10px;font-size:12px;font-weight:800;cursor:pointer}
		.sblr-hero .sblr-btn:not(.primary):not(.danger){background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.24);color:#fff}
		.sblr-btn.primary{background:#5b6ee1;border-color:#5b6ee1;color:#fff}
		.sblr-btn.danger{background:#f23655;border-color:#f23655;color:#fff}
		.sblr-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:8px}
		.sblr-stat{padding:8px 10px;min-height:42px}
		.sblr-stat-label{font-size:11px;color:#5f7088;text-transform:uppercase;font-weight:800;margin-bottom:2px}
		.sblr-stat-value{font-size:13px;font-weight:900;color:#102038;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.sblr-stat-value.ok{color:#008763}.sblr-stat-value.warn{color:#b76b05}
		.sblr-stat-meta{font-size:11px;color:#7a8ba3;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.sblr-grid{display:grid;grid-template-columns:minmax(0,.96fr) minmax(0,1.04fr);gap:8px;align-items:start}
		.sblr-grid>div{min-width:0}
		.sblr-card{padding:10px 11px;margin-bottom:8px}
		.sblr-card>h3,.sblr-subtitle{margin:0 0 8px;font-size:13px;color:#102038}
		.sblr-box{border:1px solid #dbe3ef;border-radius:7px;background:#fbfcff;padding:8px 10px;margin-bottom:8px}
		.sblr-box h4{margin:0 0 6px;font-size:12px;color:#102038}
		.sblr-field{display:grid;grid-template-columns:104px minmax(0,1fr);align-items:center;gap:8px;margin:4px 0}
		.sblr-field>span{font-weight:800;color:#102038;text-align:right}
		.sblr-input{height:27px;border:1px solid #cbd6e6;border-radius:5px;background:#fff;color:#102038;box-sizing:border-box;padding:0 8px;width:100%;font-size:12px}
		.sblr-two{display:grid;grid-template-columns:1fr 1fr;gap:8px}
		.sblr-toggle{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:#5f7088;font-weight:700}
		.sblr-toggle input{display:none}
		.sblr-switch{position:relative;width:32px;height:17px;border-radius:999px;background:#cbd5e1;display:inline-block}
		.sblr-switch:before{content:"";position:absolute;width:13px;height:13px;border-radius:999px;background:#fff;left:2px;top:2px;transition:.15s}
		.sblr-toggle input:checked+.sblr-switch{background:#5b6ee1}
		.sblr-toggle input:checked+.sblr-switch:before{transform:translateX(15px)}
		.sblr-rules{display:grid;grid-template-columns:1fr 1fr;gap:8px}
		.sblr-rule{display:grid;grid-template-columns:12px minmax(0,1fr) auto;gap:8px;align-items:center;border:1px solid #dbe3ef;border-radius:7px;background:#fbfcff;padding:7px 9px;min-height:42px}
		.sblr-dot{width:8px;height:8px;border-radius:999px;display:inline-block}
		.sblr-dot.ok{background:#008763}.sblr-dot.warn{background:#c87209}
		.sblr-rule-main b{display:block;font-size:12px;color:#102038;margin-bottom:2px}
		.sblr-rule-main span{display:block;color:#5f7088;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.sblr-pill{display:inline-flex;align-items:center;min-height:20px;border-radius:999px;padding:0 8px;font-size:11px;font-weight:900}
		.sblr-pill.ok{background:#eafaf2;color:#008763}.sblr-pill.warn{background:#fff4cf;color:#b76b05}
		.sblr-flow-row{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:7px;align-items:center;border-bottom:1px solid #e4eaf2;padding:6px 0}
		.sblr-flow-row:last-child{border-bottom:0}
		.sblr-step{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:999px;background:#eef2ff;color:#4f62df;font-weight:900}
		.sblr-flow-main b{display:block;color:#102038;margin-bottom:1px}.sblr-flow-main span{color:#5f7088}
		.sblr-flow-meta{color:#5f7088;font-size:11px}
		.sblr-footer{justify-content:flex-end;margin-top:2px}
		@media(max-width:1100px){.sblr-grid,.sblr-stats,.sblr-rules,.sblr-two{grid-template-columns:1fr}.sblr-hero{align-items:flex-start;flex-direction:column}.sblr-actions{justify-content:flex-start}.sblr-field{grid-template-columns:120px minmax(0,1fr)}}
	`);
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
		var repo = uci.get('singboxlite', 'ruleset', 'repo_raw') || 'https://raw.githubusercontent.com/leosysd/ruleset/main/dist';
		var singboxDir = uci.get('singboxlite', 'ruleset', 'singbox_dir') || '/etc/sing-box/rule-set';
		var mosdnsDir = uci.get('singboxlite', 'ruleset', 'mosdns_dir') || '/etc/mosdns/rule';
		var autoUpdate = uci.get('singboxlite', 'ruleset', 'auto_update') === '1';
		var updateTime = uci.get('singboxlite', 'ruleset', 'update_time') || '07:45';
		var updateWeekday = uci.get('singboxlite', 'ruleset', 'update_weekday') || '2';
		var restartSingbox = uci.get('singboxlite', 'ruleset', 'restart_singbox') === '1';
		var restartMosdns = uci.get('singboxlite', 'ruleset', 'restart_mosdns') === '1';
		var parsed = parseRulesetOutput(rules.output || '', singboxDir, mosdnsDir);

		return E('div', { 'class': 'sblr-page' }, [
			css(),
			E('div', { 'class': 'sblr-shell' }, [
			E('div', { 'class': 'sblr-panel sblr-hero' }, [
				E('div', { 'class': 'sblr-title' }, [
					E('h2', {}, '规则集'),
					E('p', {}, '从 leosysd/ruleset 拉取成品文件，分别写入 sing-box 与 MosDNS 规则目录。')
				]),
				E('div', { 'class': 'sblr-actions' }, [
					E('button', { 'class': 'sblr-btn primary', 'click': function() {
						return saveRuleset('已保存规则集设置', false, true).then(function() {
							return callUpdateRuleset().then(function(res) {
								notify('更新规则集', res);
							});
						});
					} }, '↻ 立即更新'),
					E('button', { 'class': 'sblr-btn', 'click': function() {
						return callRulesetStatus().then(function(res) {
							notify('规则状态', res);
						});
					} }, '✓ 查看状态'),
					E('button', { 'class': 'sblr-btn', 'click': function() {
						return saveRuleset('已保存并写入定时任务', true, true);
					} }, '◴ 写入定时任务'),
					E('button', { 'class': 'sblr-btn danger', 'click': function() {
						return callClearRulesetLog().then(function(res) {
							notify('清理规则日志', res);
						});
					} }, '× 清理日志')
				])
			]),
			pageTabs('ruleset'),
			E('div', { 'class': 'sblr-stats' }, [
				statCard('更新状态', status.ruleset_last_update_result || '-', status.ruleset_last_update_time || '-', status.ruleset_last_update_result === 'pass' ? 'ok' : 'warn'),
				statCard('sing-box 目录', singboxDir, '输出 .srs / .json'),
				statCard('MosDNS 目录', mosdnsDir, '输出 .txt'),
					statCard('定时更新', autoUpdate ? weekdayName(updateWeekday) + ' ' + updateTime : '关闭', autoUpdate ? '仅运行中的服务会被重启' : '不会写入规则集定时任务')
			]),
			E('div', { 'class': 'sblr-grid' }, [
				E('div', {}, [
					E('div', { 'class': 'sblr-panel sblr-card' }, [
						E('h3', {}, '规则集设置'),
						E('div', { 'class': 'sblr-box' }, [
							E('h4', {}, '源与目录'),
							field('dist 源地址', input('sblr-repo', repo)),
							field('sing-box 目录', input('sblr-sb-dir', singboxDir)),
							field('MosDNS 目录', input('sblr-md-dir', mosdnsDir))
						]),
						E('div', { 'class': 'sblr-two' }, [
							E('div', { 'class': 'sblr-box' }, [
								E('h4', {}, '自动更新'),
								field('启用', toggle('sblr-auto', autoUpdate, '每周执行')),
								field('星期', select('sblr-weekday', updateWeekday, WEEKDAYS)),
								field('时间', input('sblr-time', updateTime, '07:45'))
							]),
							E('div', { 'class': 'sblr-box' }, [
									E('h4', {}, '更新后动作'),
									field('重启 sing-box', toggle('sblr-restart-sb', restartSingbox, restartSingbox ? '开启' : '关闭')),
									field('重启 MosDNS', toggle('sblr-restart-md', restartMosdns, restartMosdns ? '开启' : '关闭')),
									field('失败处理', E('span', { 'class': 'sblr-flow-meta' }, '下载未全部成功时保留旧规则'))
								])
							]),
						E('div', { 'class': 'sblr-box' }, [
							E('h4', {}, '执行流程'),
								E('div', { 'class': 'sblr-flow-row' }, [ E('span', { 'class': 'sblr-step' }, '1'), E('div', { 'class': 'sblr-flow-main' }, [ E('b', {}, '下载 6 个成品文件'), E('span', {}, 'srs / json / txt 分别用于 sing-box 和 MosDNS') ]), E('span', { 'class': 'sblr-flow-meta' }, '30 秒超时') ]),
								E('div', { 'class': 'sblr-flow-row' }, [ E('span', { 'class': 'sblr-step' }, '2'), E('div', { 'class': 'sblr-flow-main' }, [ E('b', {}, '写入临时目录'), E('span', {}, '全部下载成功后再替换正式文件') ]), E('span', { 'class': 'sblr-flow-meta' }, '/etc/sing-box/singboxlite/ruleset') ]),
								E('div', { 'class': 'sblr-flow-row' }, [ E('span', { 'class': 'sblr-step' }, '3'), E('div', { 'class': 'sblr-flow-main' }, [ E('b', {}, '备份并替换'), E('span', {}, '旧规则保留 .bak，避免半更新状态') ]), E('span', { 'class': 'sblr-flow-meta' }, '原子替换') ]),
								E('div', { 'class': 'sblr-flow-row' }, [ E('span', { 'class': 'sblr-step' }, '4'), E('div', { 'class': 'sblr-flow-main' }, [ E('b', {}, '按运行状态重启 MosDNS'), E('span', {}, '只有 MosDNS 正在运行且开关开启才会重启') ]), E('span', { 'class': 'sblr-flow-meta' }, '等待 10 秒') ]),
								E('div', { 'class': 'sblr-flow-row' }, [ E('span', { 'class': 'sblr-step' }, '5'), E('div', { 'class': 'sblr-flow-main' }, [ E('b', {}, '按运行状态重启 sing-box'), E('span', {}, '只有 sing-box 正在运行且开关开启才会重启') ]), E('span', { 'class': 'sblr-flow-meta' }, '按需执行') ])
							])
					])
				]),
				E('div', {}, [
						E('div', { 'class': 'sblr-panel sblr-card' }, [
							E('h3', {}, '规则文件状态'),
							E('div', { 'class': 'sblr-rules' }, RULE_FILES.map(function(file) {
								return ruleCard(file, parsed[file[0]]);
							}))
						])
					])
				]),
			E('div', { 'class': 'sblr-footer' }, [
				E('button', { 'class': 'sblr-btn primary', 'click': function() { return saveRuleset('已保存并写入规则集定时任务', true, true); } }, '✓ 保存并写入定时任务'),
				E('button', { 'class': 'sblr-btn', 'click': function() { return saveRuleset('已保存规则集设置，等待应用', false, false); } }, '保存'),
				E('button', { 'class': 'sblr-btn danger', 'click': function() { location.reload(); } }, '重置')
			])
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
