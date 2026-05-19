'use strict';
'require rpc';
'require ui';
'require uci';
'require view';

var activeSource = 'singbox';
var refreshTimer = null;
var lastRawLog = '';
var lastStatus = {};

var callStatus = rpc.declare({ object: 'luci.singboxlite', method: 'status', expect: { '': {} } });
var callTailSourceLog = rpc.declare({ object: 'luci.singboxlite', method: 'tail_source_log', params: [ 'source', 'lines' ], expect: { '': {} } });
var callCleanLog = rpc.declare({ object: 'luci.singboxlite', method: 'clean_log', expect: { '': {} } });
var callClearRulesetLog = rpc.declare({ object: 'luci.singboxlite', method: 'clear_ruleset_log', expect: { '': {} } });
var callSetCron = rpc.declare({ object: 'luci.singboxlite', method: 'set_cron', expect: { '': {} } });

function val(id) {
	var el = document.getElementById(id);
	return el ? el.value : '';
}

function refreshChanges() {
	if (ui.changes && ui.changes.init)
		return ui.changes.init();
	return Promise.resolve();
}

function sourceLabel(source) {
	if (source === 'system')
		return '系统日志';
	if (source === 'app')
		return '软件日志';
	return 'Sing-box 日志';
}

function sourcePath(source) {
	if (source === 'system')
		return 'logread';
	if (source === 'app')
		return '/tmp/singboxlite-ruleset.log';
	return 'logread | grep sing-box';
}

function formatBytes(size) {
	size = Number(size || 0);
	if (size >= 1024 * 1024 * 1024)
		return (size / 1024 / 1024 / 1024).toFixed(2) + ' GiB';
	if (size >= 1024 * 1024)
		return (size / 1024 / 1024).toFixed(2) + ' MiB';
	if (size >= 1024)
		return (size / 1024).toFixed(1) + ' KiB';
	return size + ' B';
}

function levelOf(line) {
	if (/(fatal|error|failed|失败|错误)/i.test(line))
		return 'error';
	if (/(warn|warning|timeout|stale|警告)/i.test(line))
		return 'warn';
	if (/(debug|trace|调试)/i.test(line))
		return 'debug';
	return 'info';
}

function timeOf(line) {
	var m = line.match(/(\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2})/);
	if (m)
		return m[1];
	m = line.match(/([A-Z]+\\[[0-9:.]+\\])/);
	return m ? m[1] : '-';
}

function topicOf(line) {
	var m = line.match(/\b(dns|route|inbound|outbound|service|cache|ruleset|rule_set)\b/i);
	if (!m)
		return activeSource;
	return m[1].replace('_', '-').toLowerCase();
}

function statCard(label, value, meta, tone, idValue, idMeta) {
	return E('div', { 'class': 'sbll-stat' }, [
		E('div', { 'class': 'sbll-stat-label' }, label),
		E('div', { 'class': 'sbll-stat-value ' + (tone || ''), id: idValue || null }, value || '-'),
		E('div', { 'class': 'sbll-stat-meta', id: idMeta || null }, meta || '-')
	]);
}

function pageTabs(active) {
	return E('div', { 'class': 'sbll-panel sbll-tabs' }, [
		E('button', { 'class': 'sbll-tab ' + (active === 'overview' ? 'active' : ''), 'click': function() { location.href = L.url('admin/services/singboxlite/overview'); } }, '总览'),
		E('button', { 'class': 'sbll-tab ' + (active === 'ruleset' ? 'active' : ''), 'click': function() { location.href = L.url('admin/services/singboxlite/ruleset'); } }, '规则集'),
		E('button', { 'class': 'sbll-tab ' + (active === 'logs' ? 'active' : ''), 'click': function() { location.href = L.url('admin/services/singboxlite/logs'); } }, '日志')
	]);
}

function selectLines(current) {
	var values = [ '100', '200', '300', '500' ];
	return E('select', { 'class': 'sbll-input', id: 'sbll-lines', 'change': function() {
		return saveLogSettings('', false).then(refreshLog);
	} }, values.map(function(n) {
		return E('option', { value: n, selected: String(current) === n }, '最近 ' + n + ' 行');
	}));
}

function filteredLines(raw) {
	var level = val('sbll-level') || 'all';
	var keyword = (val('sbll-search') || '').toLowerCase();
	var lines = (raw || '').split(/\n/).filter(function(line) {
		return line.trim() !== '';
	}).reverse();

	return lines.filter(function(line) {
		var lv = levelOf(line);
		if (level !== 'all' && lv !== level)
			return false;
		if (keyword !== '' && line.toLowerCase().indexOf(keyword) < 0)
			return false;
		return true;
	});
}

function updateText(id, text) {
	var node = document.getElementById(id);
	if (node)
		node.textContent = text;
}

function renderSummary(lines, counts) {
	var summary = document.getElementById('sbll-summary');
	if (!summary)
		return;

	summary.innerHTML = '';
	summary.append(
		E('span', { 'class': 'sbll-chip' }, [ '来源 ', E('b', {}, sourceLabel(activeSource)) ]),
		E('span', { 'class': 'sbll-chip' }, [ '显示 ', E('b', {}, String(lines.length) + ' 行') ]),
		E('span', { 'class': 'sbll-chip error' }, [ '错误 ', E('b', {}, String(counts.error)) ]),
		E('span', { 'class': 'sbll-chip warn' }, [ '警告 ', E('b', {}, String(counts.warn)) ]),
		E('span', { 'class': 'sbll-chip' }, [ '关键词 ', E('b', {}, val('sbll-search') || '无') ])
	);
}

function renderLog(raw, size) {
	var list = document.getElementById('sbll-list');
	var rawBox = document.getElementById('sbll-raw');
	var lines;
	var counts = { error: 0, warn: 0, info: 0, debug: 0 };

	lastRawLog = raw || '';
	lines = filteredLines(lastRawLog);
	lines.forEach(function(line) {
		counts[levelOf(line)]++;
	});

	if (rawBox)
		rawBox.textContent = lastRawLog || '暂无日志';

	updateText('sbll-source-value', sourceLabel(activeSource));
	updateText('sbll-source-meta', sourcePath(activeSource));
	updateText('sbll-size-value', formatBytes(size || lastStatus.log_size || lastRawLog.length || 0));
	updateText('sbll-match-value', lines.length + ' 行');
	updateText('sbll-match-meta', '错误 ' + counts.error + ' · 警告 ' + counts.warn + ' · 信息 ' + counts.info);
	renderSummary(lines, counts);

	if (!list)
		return;

	list.innerHTML = '';
	if (!lines.length) {
		list.appendChild(E('div', { 'class': 'sbll-row ' + activeSource }, [
			E('div', { 'class': 'sbll-index' }, '-'),
			E('div', { 'class': 'sbll-time' }, '-'),
			E('div', { 'class': 'sbll-level info' }, 'INFO'),
			E('div', { 'class': 'sbll-msg' }, '暂无匹配日志'),
			E('div', { 'class': 'sbll-topic' }, activeSource)
		]));
		return;
	}

	lines.forEach(function(line, idx) {
		var level = levelOf(line);
		list.appendChild(E('div', { 'class': 'sbll-row ' + level + ' ' + activeSource, title: line }, [
			E('div', { 'class': 'sbll-index' }, String(idx + 1)),
			E('div', { 'class': 'sbll-time' }, timeOf(line)),
			E('div', { 'class': 'sbll-level ' + level }, level.toUpperCase()),
			E('div', { 'class': 'sbll-msg' }, line),
			E('div', { 'class': 'sbll-topic' }, topicOf(line))
		]));
	});
}

function refreshLog() {
	var lines = Number(val('sbll-lines') || uci.get('singboxlite', 'log', 'tail_lines') || 200);
	return callTailSourceLog(activeSource, lines).then(function(res) {
		renderLog(res.log || res.output || '', res.size);
	});
}

function setSource(source) {
	activeSource = source;
	document.querySelectorAll('.sbll-source').forEach(function(btn) {
		btn.classList.toggle('active', btn.getAttribute('data-source') === source);
	});
	return refreshLog();
}

function setAutoRefresh(enabled) {
	var checkbox = document.getElementById('sbll-auto-refresh');

	if (refreshTimer) {
		window.clearInterval(refreshTimer);
		refreshTimer = null;
	}
	if (enabled)
		refreshTimer = window.setInterval(function() {
			if (!document.getElementById('sbll-page')) {
				setAutoRefresh(false);
				return;
			}
			refreshLog();
			}, 5000);
	if (checkbox)
		checkbox.checked = enabled ? true : false;
	updateText('sbll-auto-value', enabled ? '开启' : '关闭');
	updateText('sbll-auto-meta', enabled ? '每 5 秒刷新一次' : '手动刷新');
}

function cleanCurrentLog() {
	if (activeSource === 'system' || activeSource === 'singbox') {
		ui.addNotification(null, E('p', {}, activeSource === 'singbox' ? '当前 sing-box 日志来自系统日志 logread，这里不单独清理。' : '系统日志由 OpenWrt 管理，这里不清理。'), 'info');
		return;
	}

	return ui.showModal('确认清理日志', [
			E('p', {}, '确定要清理规则集/软件日志吗？'),
		E('div', { 'class': 'right' }, [
			E('button', { 'class': 'btn', 'click': ui.hideModal }, '取消'),
			E('button', { 'class': 'btn cbi-button-negative', 'click': function() {
				ui.hideModal();
					return callClearRulesetLog().then(function(res) {
					ui.addNotification(null, E('p', {}, res.output || '日志已清理'), res.ok ? 'info' : 'error');
					return refreshLog();
				});
			} }, '清理')
		])
	]);
}

function saveLogSettings(message, writeCron) {
	uci.set('singboxlite', 'log', 'tail_lines', val('sbll-lines') || '200');
	var autoRefresh = document.getElementById('sbll-auto-refresh');
	uci.set('singboxlite', 'log', 'auto_refresh', autoRefresh && autoRefresh.checked ? '1' : '0');

	return uci.save().then(function() {
		if (writeCron)
			return uci.apply(10);
	}).then(function() {
		if (writeCron)
			return callSetCron();
	}).then(function(res) {
		if (res && res.ok === false)
			ui.addNotification(null, E('p', {}, res.output || '写入定时任务失败'), 'error');
		return refreshChanges();
	}).then(function() {
		if (message)
			ui.addNotification(null, E('p', {}, message), 'info');
	});
}

function css() {
	return E('style', {}, `
		.cbi-tabmenu,.tabs:not(.sbl-tabs):not(.sblr-tabs):not(.sbll-tabs){display:none!important}
		.sbll-page{color:#0f1f35;font-size:12px;margin:-12px;padding:48px 18px 28px;background:linear-gradient(180deg,#5f70e8 0,#5f70e8 92px,#eaf2ff 92px,#f7fbff 100%);min-height:calc(100vh - 110px)}
		.sbll-page>*{max-width:1440px;margin-left:auto;margin-right:auto}
		.sbll-panel{background:rgba(255,255,255,.97);border:1px solid #d5deeb;border-radius:14px;box-shadow:0 18px 45px rgba(64,91,160,.12)}
		.sbll-hero{position:relative;overflow:hidden;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px 14px;margin-bottom:10px;background:linear-gradient(115deg,#204d76 0,#276be2 62%,#60a4ff 100%);border-color:rgba(255,255,255,.28);color:#fff}
		.sbll-hero:after{content:"";position:absolute;right:-42px;top:-32px;width:190px;height:190px;border-radius:999px;background:rgba(255,255,255,.12)}
		.sbll-title,.sbll-actions{position:relative;z-index:1}
		.sbll-tabs{height:46px;display:flex;align-items:center;gap:2px;padding:0 12px;margin:12px 0;border-radius:8px;box-shadow:0 16px 40px rgba(64,91,160,.10)}
		.sbll-tab{height:46px;display:inline-flex;align-items:center;padding:0 16px;border:0;border-bottom:3px solid transparent;background:transparent;color:#4b6382;font-size:12px;font-weight:900;cursor:pointer}
		.sbll-tab.active{color:#2563eb;border-bottom-color:#2563eb}
		.sbll-title h2{margin:0 0 4px;font-size:18px;line-height:1.1;color:#fff}
		.sbll-title p{margin:0;color:rgba(255,255,255,.82);font-size:12px;line-height:1.3}
		.sbll-actions,.sbll-toolbar,.sbll-sources,.sbll-footer{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
		.sbll-actions{justify-content:flex-end}
		.sbll-btn{min-height:28px;border-radius:6px;border:1px solid #b8c7ff;background:#fff;color:#4f62df;padding:0 11px;font-size:12px;font-weight:800;cursor:pointer}
		.sbll-hero .sbll-btn:not(.primary):not(.danger){background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.24);color:#fff}
		.sbll-btn.primary,.sbll-source.active{background:#5b6ee1;border-color:#5b6ee1;color:#fff}
		.sbll-btn.danger{background:#f23655;border-color:#f23655;color:#fff}
		.sbll-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:10px}
		.sbll-stat{padding:12px 13px;min-height:58px}
		.sbll-stat-label{font-size:11px;color:#5f7088;text-transform:uppercase;font-weight:800;margin-bottom:4px}
		.sbll-stat-value{font-size:13px;font-weight:900;color:#102038;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.sbll-stat-value.ok{color:#008763}.sbll-stat-value.warn{color:#b76b05}.sbll-stat-value.danger{color:#dc2947}
		.sbll-stat-meta{font-size:11px;color:#7a8ba3;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.sbll-toolbar{padding:10px 13px;margin-bottom:10px}
		.sbll-sources{gap:5px}
		.sbll-source{min-height:28px;border-radius:6px;border:1px solid #cbd6e6;background:#fff;color:#102038;padding:0 11px;font-size:12px;font-weight:900;cursor:pointer}
		.sbll-switchline{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:#5f7088;font-weight:700}
		.sbll-switchline input{display:none}
		.sbll-switch{position:relative;width:32px;height:17px;border-radius:999px;background:#cbd5e1;display:inline-block}
		.sbll-switch:before{content:"";position:absolute;width:13px;height:13px;border-radius:999px;background:#fff;left:2px;top:2px;transition:.15s}
		.sbll-switchline input:checked+.sbll-switch{background:#5b6ee1}
		.sbll-switchline input:checked+.sbll-switch:before{transform:translateX(15px)}
		.sbll-input{height:29px;border:1px solid #cbd6e6;border-radius:5px;background:#fff;color:#102038;box-sizing:border-box;padding:0 9px;font-size:12px}
		.sbll-search{flex:1 1 340px;min-width:240px}
		.sbll-main{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:10px;align-items:start}
		.sbll-card{padding:12px 13px;margin-bottom:10px}
		.sbll-card>h3{margin:0 0 10px;font-size:13px;color:#102038}
		.sbll-summary{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px}
		.sbll-chip{display:inline-flex;align-items:center;min-height:23px;border-radius:999px;border:1px solid #dbe3ef;background:#fbfcff;color:#5f7088;padding:0 9px;font-size:11px}
		.sbll-chip b{color:#102038;margin-left:3px}.sbll-chip.error{background:#fff3f5;color:#dc2947}.sbll-chip.warn{background:#fff8df;color:#b76b05}
		.sbll-list{border:1px solid #dbe3ef;border-radius:7px;overflow:auto;max-height:570px;background:#fff}
		.sbll-row{display:grid;grid-template-columns:42px 150px 64px minmax(0,1fr) 72px;gap:8px;align-items:center;min-height:32px;border-bottom:1px solid #e4eaf2;border-left:3px solid #5b6ee1;padding:3px 9px}
		.sbll-row:last-child{border-bottom:0}.sbll-row.warn{background:#fffdf2;border-left-color:#c87209}.sbll-row.error{background:#fff8fa;border-left-color:#f23655}.sbll-row.debug{border-left-color:#7a8ba3}
		.sbll-index{font-size:11px;color:#7a8ba3;text-align:right;font-weight:900}
		.sbll-time{font:11px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;color:#5f7088;background:#f5f7fb;border-radius:5px;padding:2px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.sbll-level{justify-self:start;min-width:44px;border-radius:5px;padding:2px 6px;text-align:center;font-size:10px;font-weight:900;background:#e9f2ff;color:#1d6bd8}
		.sbll-level.warn{background:#fff1c2;color:#a46500}.sbll-level.error{background:#ffe0e7;color:#c62844}.sbll-level.debug{background:#eef2f7;color:#5f728b}
		.sbll-msg{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#102038}
		.sbll-topic{text-align:right;color:#5f7088;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.sbll-raw{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-break:break-word;background:#0d1628;color:#dbeafe;border-radius:7px;padding:12px;min-height:320px;max-height:380px;overflow:auto;margin:0;font-size:12px;line-height:1.45}
		.sbll-maint{display:grid;gap:9px}
		.sbll-maint-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid #dbe3ef;border-radius:7px;background:#fbfcff;padding:10px}
		.sbll-maint-row b{display:block;color:#102038;margin-bottom:3px}.sbll-maint-row span{display:block;color:#5f7088}
		.sbll-footer{justify-content:flex-end;margin-top:2px}
		@media(max-width:1100px){.sbll-stats,.sbll-main{grid-template-columns:1fr}.sbll-hero{align-items:flex-start;flex-direction:column}.sbll-actions{justify-content:flex-start}.sbll-row{grid-template-columns:36px 120px 56px minmax(0,1fr)}.sbll-topic{display:none}}
	`);
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('singboxlite'),
			L.resolveDefault(callStatus(), {}),
			L.resolveDefault(callTailSourceLog('singbox', Number(uci.get('singboxlite', 'log', 'tail_lines') || 200)), {})
		]);
	},

		render: function(data) {
			var status = data[1] || {};
			var initial = data[2] || {};
			var tailLines = uci.get('singboxlite', 'log', 'tail_lines') || '200';
			var autoRefresh = uci.get('singboxlite', 'log', 'auto_refresh') === '1';
			var cleanupTime = uci.get('singboxlite', 'log', 'cleanup_time') || '03:10';
			var page;

			setAutoRefresh(false);
			lastStatus = status;

		page = E('div', { 'class': 'sbll-page', id: 'sbll-page' }, [
			css(),
			E('div', { 'class': 'sbll-panel sbll-hero' }, [
				E('div', { 'class': 'sbll-title' }, [
					E('h2', {}, '日志中心'),
					E('p', {}, '按来源、级别和关键词筛选日志，保留原始输出用于复制和排错。')
				]),
				E('div', { 'class': 'sbll-actions' }, [
					E('button', { 'class': 'sbll-btn primary', 'click': refreshLog }, '↻ 立即刷新'),
					E('button', { 'class': 'sbll-btn', 'click': function() {
						return saveLogSettings('已写入定时任务', true);
					} }, '◴ 写入定时任务'),
					E('button', { 'class': 'sbll-btn danger', 'click': cleanCurrentLog }, '× 清理当前日志')
				])
			]),
			pageTabs('logs'),
			E('div', { 'class': 'sbll-stats' }, [
					statCard('当前来源', 'Sing-box 日志', sourcePath('singbox'), '', 'sbll-source-value', 'sbll-source-meta'),
					statCard('日志大小', formatBytes(initial.size || 0), activeSource === 'singbox' ? '来自系统日志 logread' : '建议清理或启用轮转', (initial.size || 0) > 1024 * 1024 ? 'danger' : ''),
					statCard('匹配结果', '-', '错误 0 · 警告 0 · 信息 0', '', 'sbll-match-value', 'sbll-match-meta'),
					statCard('自动刷新', autoRefresh ? '开启' : '关闭', autoRefresh ? '每 5 秒刷新一次' : '手动刷新', autoRefresh ? 'ok' : '', 'sbll-auto-value', 'sbll-auto-meta')
				]),
			E('div', { 'class': 'sbll-panel sbll-toolbar' }, [
				E('div', { 'class': 'sbll-sources' }, [
					E('button', { 'class': 'sbll-source active', 'data-source': 'singbox', 'click': function() { return setSource('singbox'); } }, 'Sing-box'),
					E('button', { 'class': 'sbll-source', 'data-source': 'system', 'click': function() { return setSource('system'); } }, '系统'),
					E('button', { 'class': 'sbll-source', 'data-source': 'app', 'click': function() { return setSource('app'); } }, '软件')
				]),
				E('label', { 'class': 'sbll-switchline' }, [
					E('input', { id: 'sbll-auto-refresh', type: 'checkbox', checked: autoRefresh ? true : null, 'change': function(ev) {
						setAutoRefresh(ev.target.checked);
						return saveLogSettings('', false);
					} }),
					E('span', { 'class': 'sbll-switch' }),
					E('b', {}, '自动刷新')
				]),
				selectLines(tailLines),
				E('select', { 'class': 'sbll-input', id: 'sbll-level', 'change': function() { renderLog(lastRawLog); } }, [
					E('option', { value: 'all' }, '全部级别'),
					E('option', { value: 'error' }, '仅错误'),
					E('option', { value: 'warn' }, '仅警告'),
					E('option', { value: 'info' }, '仅信息'),
					E('option', { value: 'debug' }, '仅调试')
				]),
				E('input', { 'class': 'sbll-input sbll-search', id: 'sbll-search', placeholder: '搜索关键词，例如 DNS / route / failed', 'input': function() { renderLog(lastRawLog); } }),
				E('button', { 'class': 'sbll-btn', 'click': function() {
					document.getElementById('sbll-search').value = '';
					document.getElementById('sbll-level').value = 'all';
					renderLog(lastRawLog);
				} }, '清空筛选'),
				E('button', { 'class': 'sbll-btn danger', 'click': cleanCurrentLog }, '清理日志')
			]),
			E('div', { 'class': 'sbll-main' }, [
				E('div', { 'class': 'sbll-panel sbll-card' }, [
					E('div', { 'class': 'sbll-summary', id: 'sbll-summary' }),
					E('div', { 'class': 'sbll-list', id: 'sbll-list' })
				]),
				E('div', {}, [
					E('div', { 'class': 'sbll-panel sbll-card' }, [
						E('h3', {}, '原始日志'),
						E('pre', { 'class': 'sbll-raw', id: 'sbll-raw' }, '暂无日志')
					]),
					E('div', { 'class': 'sbll-panel sbll-card' }, [
						E('h3', {}, '维护动作'),
						E('div', { 'class': 'sbll-maint' }, [
							E('div', { 'class': 'sbll-maint-row' }, [
								E('div', {}, [ E('b', {}, 'Sing-box 日志'), E('span', {}, '来自系统日志 logread，显示 sing-box 相关记录') ]),
								E('button', { 'class': 'sbll-btn', 'click': function() {
									activeSource = 'singbox';
									return cleanCurrentLog();
								} }, '说明')
							]),
							E('div', { 'class': 'sbll-maint-row' }, [
								E('div', {}, [ E('b', {}, '规则集日志'), E('span', {}, '/tmp/singboxlite-ruleset.log') ]),
								E('button', { 'class': 'sbll-btn', 'click': function() {
									return callClearRulesetLog().then(function(res) {
										ui.addNotification(null, E('p', {}, res.output || '规则集日志已清理'), res.ok ? 'info' : 'error');
										return refreshLog();
									});
								} }, '清理')
							]),
							E('div', { 'class': 'sbll-maint-row' }, [
								E('div', {}, [ E('b', {}, '自动清理'), E('span', {}, '每天 ' + cleanupTime + ' truncate') ]),
								E('button', { 'class': 'sbll-btn', 'click': function() { return saveLogSettings('已写入自动清理定时任务', true); } }, '设置')
							])
						])
					])
				])
			]),
				E('div', { 'class': 'sbll-footer' }, [
					E('button', { 'class': 'sbll-btn primary', 'click': function() { return saveLogSettings('已保存显示行数与自动刷新设置', false); } }, '✓ 保存显示设置'),
					E('button', { 'class': 'sbll-btn', 'click': function() { return saveLogSettings('已写入自动清理定时任务', true); } }, '写入自动清理任务'),
					E('button', { 'class': 'sbll-btn danger', 'click': function() { location.reload(); } }, '重置')
				])
		]);

			window.setTimeout(function() {
				renderLog(initial.log || initial.output || '', initial.size);
				setAutoRefresh(autoRefresh);
			}, 0);

		return page;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
