'use strict';
'require rpc';
'require ui';
'require view';

var callTailLog = rpc.declare({
	object: 'luci.singboxlite',
	method: 'tail_log',
	params: [ 'lines', 'filter' ],
	expect: { '': {} }
});

var callCleanLog = rpc.declare({
	object: 'luci.singboxlite',
	method: 'clean_log',
	expect: { '': {} }
});

var callSetCron = rpc.declare({
	object: 'luci.singboxlite',
	method: 'set_cron',
	expect: { '': {} }
});

function renderLog(res) {
	var box = document.getElementById('singboxlite-log-box');
	var size = document.getElementById('singboxlite-log-size');
	if (box)
		box.textContent = res.log || res.output || '暂无日志';
	if (size)
		size.textContent = '日志大小：%1024.2mB'.format((res.size || 0) * 1024);
}

return view.extend({
	load: function() {
		return L.resolveDefault(callTailLog(200, ''), {});
	},

	render: function(data) {
		var res = data || {};

		return E('div', { 'class': 'singboxlite-logs' }, [
			E('style', {}, `
				.singboxlite-logs .toolbar{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
				.singboxlite-logs pre{font-family:monospace;white-space:pre-wrap;background:#0f172a;color:#dbeafe;border-radius:8px;padding:12px;min-height:520px;overflow:auto}
			`),
			E('h2', {}, 'SingBox Lite - 日志'),
			E('p', { id: 'singboxlite-log-size' }, '日志大小：%1024.2mB'.format((res.size || 0) * 1024)),
			E('div', { 'class': 'toolbar' }, [
				E('button', { 'class': 'btn cbi-button-action', 'click': function() { return callTailLog(200, '').then(renderLog); } }, '刷新日志'),
				E('button', { 'class': 'btn cbi-button-action', 'click': function() { return callTailLog(200, 'ERROR').then(renderLog); } }, '只看 ERROR'),
				E('button', { 'class': 'btn cbi-button-action', 'click': function() { return callTailLog(200, 'FATAL').then(renderLog); } }, '只看 FATAL'),
				E('button', { 'class': 'btn cbi-button-action', 'click': function() {
					return callSetCron().then(function(ret) {
						ui.addNotification(null, E('p', ret.changed ? '已写入定时任务' : '定时任务无需变更'), 'info');
					});
				} }, '写入定时任务'),
				E('button', { 'class': 'btn cbi-button-negative', 'click': function() {
					return ui.showModal('确认清理日志', [
						E('p', {}, '确定要清空 sing-box 日志吗？'),
						E('div', { 'class': 'right' }, [
							E('button', { 'class': 'btn', 'click': ui.hideModal }, '取消'),
							E('button', { 'class': 'btn cbi-button-negative', 'click': function() {
								ui.hideModal();
								return callCleanLog().then(function(ret) {
									ui.addNotification(null, E('p', ret.output || '日志已清理'), ret.ok ? 'info' : 'error');
									return callTailLog(200, '').then(renderLog);
								});
							} }, '清理')
						])
					]);
				} }, '清理日志')
			]),
			E('pre', { id: 'singboxlite-log-box' }, res.log || res.output || '暂无日志')
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
