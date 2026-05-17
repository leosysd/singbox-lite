'use strict';
'require form';
'require rpc';
'require ui';
'require uci';
'require view';

var activeSource = 'singbox';
var refreshTimer = null;
var lastRawLog = '';

var callTailSourceLog = rpc.declare({
	object: 'luci.singboxlite',
	method: 'tail_source_log',
	params: [ 'source', 'lines' ],
	expect: { '': {} }
});

var callCleanLog = rpc.declare({
	object: 'luci.singboxlite',
	method: 'clean_log',
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

function css() {
	return E('style', {}, `
		.sbl-log-page{color:#344054}
		.sbl-log-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-end;margin:0 0 14px}
		.sbl-log-head h2{margin:0 0 6px;font-size:22px;color:#344054}
		.sbl-log-head p{margin:0;color:#667085}
		.sbl-log-actions,.sbl-log-sources{display:flex;gap:8px;flex-wrap:wrap}
		.sbl-log-card{background:#fff;border:1px solid #d8dee6;border-radius:8px;box-shadow:0 1px 2px rgba(16,24,40,.03);padding:16px;margin:0 0 14px}
		.sbl-log-source{min-height:34px;padding:0 12px;border-radius:8px;border:1px solid #d8dee6;background:#fff;font-size:12px;font-weight:800;cursor:pointer;color:#344054}
		.sbl-log-source.active{color:#fff;border-color:transparent;background:#5b6ee1}
		.sbl-log-source.system.active{background:#16a36d}
		.sbl-log-source.app.active{background:#df7b18}
		.sbl-log-toolbar{display:grid;grid-template-columns:130px 130px minmax(0,1fr) auto auto auto;gap:8px;margin:12px 0}
		.sbl-log-input,.sbl-log-select{height:34px;border:1px solid #d8dee6;border-radius:8px;background:#fff;color:#344054;padding:0 10px;box-sizing:border-box}
		.sbl-log-summary{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px}
		.sbl-log-pill{padding:5px 9px;border:1px solid #d8dee6;border-radius:999px;background:#f8fafc;color:#667085;font-size:12px}
		.sbl-log-pill strong{color:#344054}
		.sbl-log-list{border:1px solid #d8dee6;border-radius:8px;background:#fff;overflow:hidden}
		.sbl-log-item{display:grid;grid-template-columns:44px 150px 58px minmax(0,1fr);gap:8px;align-items:center;min-height:32px;border-bottom:1px solid #e4e7ec;border-left:3px solid transparent;padding:4px 8px;background:#fff}
		.sbl-log-item:last-child{border-bottom:0}
		.sbl-log-item.singbox{border-left-color:#5b6ee1}
		.sbl-log-item.system{border-left-color:#16a36d}
		.sbl-log-item.app{border-left-color:#df7b18}
		.sbl-log-item.warn{background:#fffdf2}
		.sbl-log-item.error{background:#fff7f7}
		.sbl-log-index{font-size:12px;color:#98a2b3;text-align:right;font-weight:800}
		.sbl-log-time{font:12px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;color:#667085;background:#f8fafc;border-radius:6px;padding:2px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.sbl-log-level{justify-self:start;min-width:42px;padding:2px 6px;border-radius:6px;font-size:11px;font-weight:800;text-align:center;background:#eef2f7;color:#667085}
		.sbl-log-level.info{background:#e6f7ff;color:#0874c9}
		.sbl-log-level.warn{background:#fff4cf;color:#a46500}
		.sbl-log-level.error{background:#ffe4e8;color:#c62844}
		.sbl-log-level.debug{background:#eef2f7;color:#5f728b}
		.sbl-log-text{font-size:12px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.sbl-log-raw{width:100%;min-height:180px;margin-top:10px;border-radius:8px;border:1px solid #d8dee6;background:#0f172a;color:#dbeafe;padding:12px;box-sizing:border-box;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
		@media(max-width:1100px){.sbl-log-head{align-items:flex-start;flex-direction:column}.sbl-log-toolbar{grid-template-columns:1fr 1fr}.sbl-log-item{grid-template-columns:36px 120px 54px minmax(0,1fr)}}
	`);
}

function levelOf(line) {
	if (/(fatal|error|失败|错误)/i.test(line))
		return 'error';
	if (/(warn|warning|警告)/i.test(line))
		return 'warn';
	if (/(debug|trace|调试)/i.test(line))
		return 'debug';
	if (/(info|信息)/i.test(line))
		return 'info';
	return 'info';
}

function timeOf(line) {
	var m = line.match(/(\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2})/);
	if (m)
		return m[1];
	m = line.match(/([A-Z]+\\[[0-9:.]+\\])/);
	return m ? m[1] : '-';
}

function sourceLabel(source) {
	if (source === 'system')
		return '系统日志';
	if (source === 'app')
		return '软件日志';
	return 'Sing-box 日志';
}

function filteredLines(raw) {
	var level = document.getElementById('sbl-log-level')?.value || 'all';
	var keyword = (document.getElementById('sbl-log-search')?.value || '').toLowerCase();
	var lines = (raw || '').split(/\n/).filter(function(line) { return line.trim() !== ''; }).reverse();

	return lines.filter(function(line) {
		var lv = levelOf(line);
		if (level !== 'all' && lv !== level)
			return false;
		if (keyword !== '' && line.toLowerCase().indexOf(keyword) < 0)
			return false;
		return true;
	});
}

function renderLog(raw) {
	lastRawLog = raw || '';
	var list = document.getElementById('sbl-log-list');
	var rawBox = document.getElementById('sbl-log-raw');
	var summary = document.getElementById('sbl-log-summary');
	var lines = filteredLines(lastRawLog);
	var counts = { error: 0, warn: 0, info: 0, debug: 0 };

	if (rawBox)
		rawBox.value = lastRawLog || '暂无日志';

	lines.forEach(function(line) {
		counts[levelOf(line)]++;
	});

	if (summary)
		summary.innerHTML = '';
	if (summary)
		summary.append(
			E('span', { 'class': 'sbl-log-pill' }, [ '来源 ', E('strong', {}, sourceLabel(activeSource)) ]),
			E('span', { 'class': 'sbl-log-pill' }, [ '显示 ', E('strong', {}, String(lines.length)), ' 行' ]),
			E('span', { 'class': 'sbl-log-pill' }, [ '错误 ', E('strong', {}, String(counts.error)) ]),
			E('span', { 'class': 'sbl-log-pill' }, [ '警告 ', E('strong', {}, String(counts.warn)) ])
		);

	if (!list)
		return;

	list.innerHTML = '';
	if (!lines.length) {
		list.appendChild(E('div', { 'class': 'sbl-log-item ' + activeSource }, [
			E('div', { 'class': 'sbl-log-index' }, '-'),
			E('div', { 'class': 'sbl-log-time' }, '-'),
			E('div', { 'class': 'sbl-log-level info' }, 'INFO'),
			E('div', { 'class': 'sbl-log-text' }, '暂无匹配日志')
		]));
		return;
	}

	lines.forEach(function(line, idx) {
		var lv = levelOf(line);
		list.appendChild(E('div', { 'class': 'sbl-log-item ' + activeSource + ' ' + lv, 'title': line }, [
			E('div', { 'class': 'sbl-log-index' }, String(idx + 1)),
			E('div', { 'class': 'sbl-log-time' }, timeOf(line)),
			E('div', { 'class': 'sbl-log-level ' + lv }, lv.toUpperCase()),
			E('div', { 'class': 'sbl-log-text' }, line)
		]));
	});
}

function refreshLog() {
	var lines = document.getElementById('sbl-log-lines')?.value || '200';
	return callTailSourceLog(activeSource, Number(lines)).then(function(res) {
		renderLog(res.log || res.output || '');
	});
}

function setSource(source) {
	activeSource = source;
	document.querySelectorAll('.sbl-log-source').forEach(function(btn) {
		btn.classList.toggle('active', btn.getAttribute('data-source') === source);
	});
	return refreshLog();
}

function setAutoRefresh(enabled) {
	if (refreshTimer) {
		window.clearInterval(refreshTimer);
		refreshTimer = null;
	}
	if (enabled)
		refreshTimer = window.setInterval(refreshLog, 5000);
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('singboxlite'),
			L.resolveDefault(callTailSourceLog('singbox', 200), {})
		]);
	},

	render: function(data) {
		var initial = data[1] || {};
		var page;

		page = E('div', { 'class': 'sbl-log-page' }, [
			css(),
			E('div', { 'class': 'sbl-log-head' }, [
				E('div', {}, [
					E('h2', {}, '日志中心'),
					E('p', {}, '参考 GFSingBox 的日志中心结构，支持来源、级别、关键词、自动刷新和原始日志查看。')
				]),
				E('div', { 'class': 'sbl-log-actions' }, [
					E('button', { 'class': 'btn cbi-button-action', 'click': refreshLog }, '立即刷新'),
					E('button', { 'class': 'btn cbi-button-action', 'click': function() {
						return callSetCron().then(function(ret) {
							ui.addNotification(null, E('p', ret.changed ? '已写入定时任务' : '定时任务无需变更'), 'info');
						});
					} }, '写入定时任务')
				])
			]),
			E('div', { 'class': 'sbl-log-card' }, [
				E('div', { 'class': 'sbl-log-sources' }, [
					E('button', { 'class': 'sbl-log-source singbox active', 'data-source': 'singbox', 'click': function() { return setSource('singbox'); } }, 'Sing-box 日志'),
					E('button', { 'class': 'sbl-log-source system', 'data-source': 'system', 'click': function() { return setSource('system'); } }, '系统日志'),
					E('button', { 'class': 'sbl-log-source app', 'data-source': 'app', 'click': function() { return setSource('app'); } }, '软件日志')
				]),
				E('div', { 'class': 'sbl-log-toolbar' }, [
					E('select', { 'class': 'sbl-log-select', id: 'sbl-log-lines', 'change': refreshLog }, [
						E('option', { value: '100' }, '最近 100 行'),
						E('option', { value: '200', selected: true }, '最近 200 行'),
						E('option', { value: '300' }, '最近 300 行'),
						E('option', { value: '500' }, '最近 500 行')
					]),
					E('select', { 'class': 'sbl-log-select', id: 'sbl-log-level', 'change': function() { renderLog(lastRawLog); } }, [
						E('option', { value: 'all' }, '全部级别'),
						E('option', { value: 'error' }, '仅错误'),
						E('option', { value: 'warn' }, '仅警告'),
						E('option', { value: 'info' }, '仅信息'),
						E('option', { value: 'debug' }, '仅调试')
					]),
					E('input', { 'class': 'sbl-log-input', id: 'sbl-log-search', placeholder: '搜索关键词，例如 DNS / route / failed', 'input': function() { renderLog(lastRawLog); } }),
					E('label', { 'class': 'btn cbi-button-action' }, [
						E('input', { type: 'checkbox', style: 'margin-right:8px', 'change': function(ev) { setAutoRefresh(ev.target.checked); } }),
						'自动刷新'
					]),
					E('button', { 'class': 'btn cbi-button-action', 'click': function() {
						document.getElementById('sbl-log-search').value = '';
						document.getElementById('sbl-log-level').value = 'all';
						renderLog(lastRawLog);
					} }, '清空筛选'),
					E('button', { 'class': 'btn cbi-button-negative', 'click': function() {
						if (activeSource === 'system') {
							ui.addNotification(null, E('p', '系统日志不在这里清理'), 'info');
							return;
						}
						return ui.showModal('确认清理日志', [
							E('p', {}, activeSource === 'app' ? '确定要清理软件日志吗？' : '确定要清空 sing-box 日志吗？'),
							E('div', { 'class': 'right' }, [
								E('button', { 'class': 'btn', 'click': ui.hideModal }, '取消'),
								E('button', { 'class': 'btn cbi-button-negative', 'click': function() {
									ui.hideModal();
									return (activeSource === 'app' ? callClearRulesetLog() : callCleanLog()).then(function(ret) {
										ui.addNotification(null, E('p', ret.output || '日志已清理'), ret.ok ? 'info' : 'error');
										return refreshLog();
									});
								} }, '清理')
							])
						]);
					} }, '清理当前日志')
				]),
				E('div', { 'class': 'sbl-log-summary', id: 'sbl-log-summary' }),
				E('div', { 'class': 'sbl-log-list', id: 'sbl-log-list' }),
				E('textarea', { 'class': 'sbl-log-raw', id: 'sbl-log-raw', readonly: true, placeholder: '这里显示当前抓到的原始日志' })
			])
		]);

		window.setTimeout(function() {
			renderLog(initial.log || initial.output || '');
		}, 0);

		return page;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
