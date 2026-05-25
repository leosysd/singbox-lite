'use strict';
'require rpc';
'require ui';
'require uci';
'require view';

var activeTab = 'overview';
var activeSource = 'singbox';
var refreshTimer = null;
var lastRawLog = '';
var lastStatus = {};
var lastLogSize = 0;

var callStatus = rpc.declare({ object: 'luci.singboxlite', method: 'status', expect: { '': {} } });
var callCheckCurrent = rpc.declare({ object: 'luci.singboxlite', method: 'check_current', expect: { '': {} } });
var callStartSingbox = rpc.declare({ object: 'luci.singboxlite', method: 'start_singbox', expect: { '': {} } });
var callStopSingbox = rpc.declare({ object: 'luci.singboxlite', method: 'stop_singbox', expect: { '': {} } });
var callRestartSingbox = rpc.declare({ object: 'luci.singboxlite', method: 'restart_singbox', expect: { '': {} } });
var callRestartMosdns = rpc.declare({ object: 'luci.singboxlite', method: 'restart_mosdns', expect: { '': {} } });
var callFetchRemote = rpc.declare({ object: 'luci.singboxlite', method: 'fetch_remote', params: [ 'url' ], expect: { '': {} } });
var callApplyCurrent = rpc.declare({ object: 'luci.singboxlite', method: 'apply_current', expect: { '': {} } });
var callSaveOverviewSettings = rpc.declare({ object: 'luci.singboxlite', method: 'save_overview_settings', params: [ 'settings' ], expect: { '': {} } });
var callUpdateRuleset = rpc.declare({ object: 'luci.singboxlite', method: 'update_ruleset', expect: { '': {} } });
var callRulesetStatus = rpc.declare({ object: 'luci.singboxlite', method: 'ruleset_status', expect: { '': {} } });
var callTailSourceLog = rpc.declare({ object: 'luci.singboxlite', method: 'tail_source_log', params: [ 'source', 'lines' ], expect: { '': {} } });
var callClearRulesetLog = rpc.declare({ object: 'luci.singboxlite', method: 'clear_ruleset_log', expect: { '': {} } });
var callCheckCoreUpdate = rpc.declare({ object: 'luci.singboxlite', method: 'check_core_update', params: [ 'include_prerelease' ], expect: { '': {} } });
var callUpdateCore = rpc.declare({ object: 'luci.singboxlite', method: 'update_core', params: [ 'include_prerelease' ], expect: { '': {} } });
var callCheckAppUpdate = rpc.declare({ object: 'luci.singboxlite', method: 'check_app_update', expect: { '': {} } });
var callUpdateApp = rpc.declare({ object: 'luci.singboxlite', method: 'update_app', expect: { '': {} } });
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

function notify(title, res) {
	ui.addNotification(null, E('pre', { 'class': res && res.ok ? '' : 'errors' }, [
		title + '\n' + ((res && (res.output || res.backup)) || (res && res.ok ? '操作成功' : '操作失败'))
	]), res && res.ok ? 'info' : 'error');
}

function refreshChanges() {
	if (ui.changes && ui.changes.init)
		return ui.changes.init();
	return Promise.resolve();
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

function stopIfFailed(title, res) {
	if (!res || !res.ok) {
		notify(title, res || { ok: false, output: '操作失败' });
		return Promise.reject(new Error((res && res.output) || '操作失败'));
	}

	notify(title, res);
	return res;
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

function weekdayName(value) {
	for (var i = 0; i < WEEKDAYS.length; i++) {
		if (WEEKDAYS[i][0] === value)
			return WEEKDAYS[i][1];
	}
	return '周二';
}

function field(label, node) {
	return E('label', { 'class': 'sbl-field' }, [ E('span', {}, label), node ]);
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

function saveSettings(message, applyCron) {
	return callSaveOverviewSettings({
		mode: val('sbl-mode') || 'singbox_mosdns',
		config_path: '/etc/sing-box/config.json',
		log_path: '/etc/sing-box/sing-box.log',
		remote_url: val('sbl-remote-url'),
		remote_auto: yes('sbl-remote-auto'),
		remote_time: val('sbl-remote-time') || uci.get('singboxlite', 'remote', 'auto_update_time') || '03:00',
		remote_apply: yes('sbl-remote-apply'),
		mosdns_addr: val('sbl-mosdns-addr') || '127.0.0.1',
		mosdns_port: val('sbl-mosdns-port') || '5335',
		disable_dns_hijack: yes('sbl-disable-dns-hijack'),
		restart_mosdns: yes('sbl-restart-mosdns'),
		clean_log: uci.get('singboxlite', 'log', 'cleanup_enabled') || '0',
		tail_lines: val('sbll-lines') || uci.get('singboxlite', 'log', 'tail_lines') || '200'
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
	return saveSettings('已保存设置，开始应用', true).then(function() {
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

function clashControllerPort(controller) {
	var match = String(controller || '').match(/:(\d+)$/);
	return match ? match[1] : '9090';
}

function openClashPanel(status) {
	var controller = status && status.clash_api_external_controller || '';
	var port = clashControllerPort(controller);
	var host = window.location.hostname || '10.0.0.1';
	var protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
	var secret = status && status.clash_api_secret || '';
	var params = [
		'hostname=' + encodeURIComponent(host),
		'port=' + encodeURIComponent(port),
		'secret=' + encodeURIComponent(secret),
		'http=1',
		'label=' + encodeURIComponent('SingBox Lite'),
		'disableUpgradeCore=1'
	].join('&');

	if (/^(127\.0\.0\.1|localhost|\[?::1\]?):/.test(controller))
		ui.addNotification(null, E('p', {}, 'Clash API 当前监听在 ' + controller + '，如果新窗口打不开，需要把 external_controller 改成 0.0.0.0:' + port + ' 或路由器 LAN IP。'), 'info');

	window.open(protocol + '//' + host + ':' + port + '/ui/#/setup?' + params, '_blank', 'noopener');
}

function logoIcon() {
	return E('span', { 'class': 'sbl-logo', 'aria-hidden': 'true' }, [
		E('span', { 'class': 'sbl-logo-ring' }),
		E('span', { 'class': 'sbl-logo-dot d1' }),
		E('span', { 'class': 'sbl-logo-dot d2' }),
		E('span', { 'class': 'sbl-logo-dot d3' })
	]);
}

function operationCard(title, body, nodes) {
	return E('div', { 'class': 'sbl-op-card' }, [
		E('h3', {}, title),
		body ? E('p', {}, body) : '',
		E('div', { 'class': 'sbl-op-actions' }, nodes || [])
	]);
}

function versionShort(value) {
	return (value || '-').replace(/^sing-box version /, '').replace(/^sing-box /, '');
}

function coreIncludeChecked(status) {
	if (status.core_include_prerelease === '1')
		return true;
	if (status.core_include_prerelease === '0')
		return false;
	return /alpha|beta|rc/i.test(status.singbox_version || '');
}

function updateCoreText(res) {
	if (!res)
		return;

	updateText('sbl-core-current', versionShort(res.current_version || ''));
	updateText('sbl-core-latest', res.latest_version || '-');
	updateText('sbl-core-check', res.last_check_time || '-');
	updateText('sbl-core-update', res.last_update_time || '-');
}

function checkCoreUpdate() {
	var include = yes('sbl-core-pre');

	return callCheckCoreUpdate(include).then(function(res) {
		notify('检查 sing-box 核心', res);
		updateCoreText(res);
		return res;
	});
}

function updateCore() {
	var include = yes('sbl-core-pre');

	ui.addNotification(null, E('p', {}, '开始更新 sing-box 核心。完成替换后会等待 10 秒并自动重启 sing-box。'), 'info');

	return callUpdateCore(include).then(function(res) {
		notify('更新 sing-box 核心', res);
		updateCoreText(res);
		window.setTimeout(function() { location.reload(); }, 1800);
		return res;
	}).catch(function(e) {
		if (isTimeoutError(e)) {
			ui.addNotification(null, E('p', {}, '核心更新可能仍在执行，页面将在 20 秒后刷新状态。'), 'info');
			window.setTimeout(function() { location.reload(); }, 20000);
			return;
		}
		if (e)
			L.error(e);
	});
}

function checkAppUpdate() {
	return callCheckAppUpdate().then(function(res) {
		notify('检查软件更新', res);
		return res;
	});
}

function updateApp() {
	ui.addNotification(null, E('p', {}, '开始更新 SingBox Lite。安装完成后 LuCI 会自动重启，页面稍后刷新。'), 'info');

	return callUpdateApp().then(function(res) {
		notify('更新 SingBox Lite', res);
		window.setTimeout(function() { location.reload(); }, 8000);
		return res;
	}).catch(function(e) {
		if (isTimeoutError(e)) {
			ui.addNotification(null, E('p', {}, '软件更新可能仍在执行，页面将在 20 秒后刷新。'), 'info');
			window.setTimeout(function() { location.reload(); }, 20000);
			return;
		}
		if (e)
			L.error(e);
	});
}

function coreUpdateCard(status) {
	var current = versionShort(status.singbox_version || '-');
	var latest = status.core_latest_version || '-';
	var include = coreIncludeChecked(status);

	return E('div', { 'class': 'sbl-op-card sbl-core-card' }, [
		E('h3', {}, 'Sing-box 核心'),
		E('div', { 'class': 'sbl-op-actions' }, [
			E('button', { 'class': 'sbl-btn', 'click': checkCoreUpdate }, '检查更新'),
			E('button', { 'class': 'sbl-btn', 'click': updateCore }, '更新核心')
		]),
		E('label', { 'class': 'sbl-toggle sbl-core-toggle' }, [
			E('input', { id: 'sbl-core-pre', type: 'checkbox', checked: include ? true : null }),
			E('span', { 'class': 'sbl-switch' }),
			E('b', {}, '包含 Alpha/Beta 版本')
		]),
		E('div', { 'class': 'sbl-core-meta' }, [
			E('div', {}, [ '当前版本：', E('span', { id: 'sbl-core-current' }, current) ]),
			E('div', {}, [ '最新版本：', E('span', { id: 'sbl-core-latest' }, latest) ])
		])
	]);
}

function overviewItem(label, value) {
	return E('div', { 'class': 'sbl-overview-item' }, [
		E('span', {}, label),
		E('b', {}, value || '-')
	]);
}

function singboxOverviewItem(status) {
	var running = !!status.singbox_running;
	var version = versionShort(status.singbox_version || '-');
	var meta = running ? '运行中' + (status.singbox_pid ? ' · PID ' + status.singbox_pid : '') : '未运行';

	return E('div', { 'class': 'sbl-overview-item sbl-service-card' }, [
		E('span', {}, 'sing-box 版本'),
		E('b', {}, version),
		E('em', { 'class': 'sbl-service-meta ' + (running ? 'ok' : 'danger') }, meta)
	]);
}

function tabButton(id, label) {
	return E('button', { 'class': 'sbl-tab ' + (activeTab === id ? 'active' : ''), 'data-tab': id, 'click': function() { switchTab(id); } }, label);
}

function pageTabs() {
	return E('div', { 'class': 'sbl-panel sbl-tabs' }, [
		tabButton('overview', '总览'),
		tabButton('ruleset', '规则集'),
		tabButton('logs', '日志')
	]);
}

function switchTab(tab) {
	var panels = document.querySelectorAll('.sbl-tab-panel');
	var buttons = document.querySelectorAll('.sbl-tab');

	activeTab = tab;
	for (var i = 0; i < panels.length; i++)
		panels[i].classList.toggle('active', panels[i].getAttribute('data-panel') === tab);
	for (var j = 0; j < buttons.length; j++)
		buttons[j].classList.toggle('active', buttons[j].getAttribute('data-tab') === tab);

	if (tab === 'logs')
		refreshLog();
	else
		setAutoRefresh(false);
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

function statCard(label, value, meta, tone, idValue, idMeta) {
	return E('div', { 'class': 'sbl-stat' }, [
		E('div', { 'class': 'sbl-stat-label' }, label),
		E('div', { 'class': 'sbl-stat-value ' + (tone || ''), id: idValue || null }, value || '-'),
		E('div', { 'class': 'sbl-stat-meta', id: idMeta || null }, meta || '-')
	]);
}

function ruleCard(file, state) {
	return E('div', { 'class': 'sbl-rule' }, [
		E('span', { 'class': 'sbl-dot ' + (state.exists ? 'ok' : 'warn') }),
		E('div', { 'class': 'sbl-rule-main' }, [
			E('b', {}, file[1]),
			E('span', {}, state.path + (state.exists ? ' · ' + formatBytes(state.size) : ''))
		]),
		E('span', { 'class': 'sbl-pill ' + (state.exists ? 'ok' : 'warn') }, state.exists ? '存在' : '缺失')
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

function levelOf(line) {
	if (/(fatal|error|failed|失败|错误)/i.test(line))
		return 'error';
	if (/(warn|warning|timeout|stale|警告)/i.test(line))
		return 'warn';
	if (/(debug|trace|调试)/i.test(line))
		return 'debug';
	return 'info';
}

function levelLabel(level) {
	if (level === 'error')
		return '错误';
	if (level === 'warn')
		return '警告';
	if (level === 'debug')
		return '调试';
	return '信息';
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
	return 'sing-box 日志';
}

function sourcePath(source) {
	if (source === 'system')
		return 'logread';
	if (source === 'app')
		return '/tmp/singboxlite-ruleset.log';
	return 'logread | grep sing-box';
}

function sourceButtonLabel(source) {
	return sourceLabel(source);
}

function topicOf(line) {
	var m = line.match(/\b(dns|route|inbound|outbound|service|cache|ruleset|rule_set)\b/i);
	if (!m)
		return sourceLabel(activeSource);

	var topic = m[1].replace('_', '-').toLowerCase();
	if (topic === 'route')
		return '路由';
	if (topic === 'inbound')
		return '入站';
	if (topic === 'outbound')
		return '出站';
	if (topic === 'service')
		return '服务';
	if (topic === 'cache')
		return '缓存';
	if (topic === 'ruleset' || topic === 'rule-set')
		return '规则集';
	return 'DNS';
}

function selectLines(current) {
	var values = [ '100', '200', '300', '500' ];
	return E('select', { 'class': 'sbl-input sbl-small-input', id: 'sbll-lines', 'change': function() {
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
		E('span', { 'class': 'sbl-chip' }, [ '来源 ', E('b', {}, sourceLabel(activeSource)) ]),
		E('span', { 'class': 'sbl-chip' }, [ '显示 ', E('b', {}, String(lines.length) + ' 行') ]),
		E('span', { 'class': 'sbl-chip error' }, [ '错误 ', E('b', {}, String(counts.error)) ]),
		E('span', { 'class': 'sbl-chip warn' }, [ '警告 ', E('b', {}, String(counts.warn)) ]),
		E('span', { 'class': 'sbl-chip' }, [ '关键词 ', E('b', {}, val('sbll-search') || '无') ])
	);
}

function renderLog(raw, size) {
	var list = document.getElementById('sbll-list');
	var lines;
	var counts = { error: 0, warn: 0, info: 0, debug: 0 };

	lastRawLog = raw || '';
	lastLogSize = size || lastStatus.log_size || lastRawLog.length || 0;
	lines = filteredLines(lastRawLog);
	lines.forEach(function(line) {
		counts[levelOf(line)]++;
	});

	updateText('sbll-source-value', sourceLabel(activeSource));
	updateText('sbll-source-meta', sourcePath(activeSource));
	updateText('sbll-size-value', formatBytes(lastLogSize));
	updateText('sbll-match-value', lines.length + ' 行');
	updateText('sbll-match-meta', '错误 ' + counts.error + ' · 警告 ' + counts.warn + ' · 信息 ' + counts.info);
	renderSummary(lines, counts);

	if (!list)
		return;

	list.innerHTML = '';
	if (!lines.length) {
		list.appendChild(E('div', { 'class': 'sbl-log-row ' + activeSource }, [
			E('div', { 'class': 'sbl-log-index' }, '-'),
			E('div', { 'class': 'sbl-log-time' }, '-'),
			E('div', { 'class': 'sbl-log-level info' }, '信息'),
			E('div', { 'class': 'sbl-log-msg' }, '暂无匹配日志'),
			E('div', { 'class': 'sbl-log-topic' }, sourceLabel(activeSource))
		]));
		return;
	}

	lines.forEach(function(line, idx) {
		var level = levelOf(line);
		list.appendChild(E('div', { 'class': 'sbl-log-row ' + level + ' ' + activeSource, title: line }, [
			E('div', { 'class': 'sbl-log-index' }, String(idx + 1)),
			E('div', { 'class': 'sbl-log-time' }, timeOf(line)),
			E('div', { 'class': 'sbl-log-level ' + level }, levelLabel(level)),
			E('div', { 'class': 'sbl-log-msg' }, line),
			E('div', { 'class': 'sbl-log-topic' }, topicOf(line))
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
	document.querySelectorAll('.sbl-source').forEach(function(btn) {
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
			if (!document.getElementById('sbl-page') || activeTab !== 'logs') {
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

function renderHero() {
	return E('div', { 'class': 'sbl-panel sbl-hero' }, [
		E('div', { 'class': 'sbl-hero-top' }, [
			E('div', { 'class': 'sbl-title' }, [
				E('div', { 'class': 'sbl-brand' }, [
					logoIcon(),
					E('span', {}, [ E('b', {}, 'SingBox Lite'), E('span', {}, 'LuCI 控制台') ])
				]),
				E('h2', {}, '更轻、更稳的 sing-box 控制台'),
				E('p', {}, '保存并应用会自动拉取远程 JSON，完成配置预检、临时回滚备份、MosDNS 联动和 DNS 探测。')
			]),
			E('div', { 'class': 'sbl-actions' }, [
				E('button', { 'class': 'sbl-btn soft', 'click': checkAppUpdate }, '检查软件'),
				E('button', { 'class': 'sbl-btn soft', 'click': updateApp }, '更新软件'),
				E('button', { 'class': 'sbl-btn soft', 'click': function() { return callCheckCurrent().then(function(res) { notify('检查配置', res); }); } }, '检查配置'),
				E('button', { 'class': 'sbl-btn soft', 'click': function() { switchTab('logs'); } }, '查看日志'),
				E('button', { 'class': 'sbl-btn primary', 'click': function() { return saveAndApplyAll(); } }, '保存并应用')
			])
		])
	]);
}

function renderOverviewPanel(status) {
	var mode = uci.get('singboxlite', 'main', 'mode') || 'singbox_mosdns';
	var remoteUrl = uci.get('singboxlite', 'remote', 'url') || '';
	var remoteAuto = uci.get('singboxlite', 'remote', 'auto_update') === '1';
	var remoteTime = uci.get('singboxlite', 'remote', 'auto_update_time') || '03:00';
	var remoteApply = uci.get('singboxlite', 'remote', 'auto_apply') === '1';
	var mosdnsAddr = uci.get('singboxlite', 'dns', 'mosdns_addr') || '127.0.0.1';
	var mosdnsPort = uci.get('singboxlite', 'dns', 'mosdns_port') || '5335';
	var disableDnsHijack = uci.get('singboxlite', 'dns', 'disable_dns_hijack') !== '0';
	var restartMosdns = uci.get('singboxlite', 'dns', 'restart_mosdns_after_apply') !== '0';
	var activeMode = status.mode || mode;
	var dnsMeta = activeMode === 'singbox_mosdns'
		? (status.dns_hijack_script_installed ? 'DNS DNAT 清理脚本已安装' : 'DNS DNAT 清理脚本未安装')
		: (status.dns_hijack_script_installed ? '清理脚本仍存在' : 'DNS 劫持由 sing-box 处理');

	return E('div', { 'class': 'sbl-tab-panel active', 'data-panel': 'overview' }, [
		E('div', { 'class': 'sbl-status-strip' }, [
			E('div', { 'class': 'sbl-crumb' }, '当前页面：总览 · 保存并应用会拉取远程配置并检查后写入'),
			E('span', { 'class': 'sbl-enabled' }, status.singbox_running ? '已启用' : '未运行')
		]),
		E('div', { 'class': 'sbl-overview-strip' }, [
			singboxOverviewItem(status),
			overviewItem('PID', status.singbox_pid || '-'),
			overviewItem('MosDNS', status.mosdns_running ? 'running' : 'not running'),
			overviewItem('日志大小', '%1024.2mB'.format(status.log_size || 0)),
			overviewItem('上次检查', status.last_check_result || '-'),
			overviewItem('上次应用', status.last_apply_time || '-')
		]),
		E('div', { 'class': 'sbl-main' }, [
			E('div', { 'class': 'sbl-op-grid' }, [
				operationCard('配置操作', '保存基础设置，或者拉取远程配置并完整应用。', [
					E('button', { 'class': 'sbl-btn', 'click': function() { return saveSettings('已保存设置，等待应用', false); } }, '仅保存'),
					E('button', { 'class': 'sbl-btn primary', 'click': function() { return saveAndApplyAll(); } }, '保存并应用')
				]),
				operationCard('服务操作', '临时启动、停止或重启 sing-box，不改配置内容。', [
					E('button', { 'class': 'sbl-btn primary', 'click': function() { return callStartSingbox().then(function(res) { notify('启动 sing-box', res); }); } }, '启动'),
					E('button', { 'class': 'sbl-btn danger', 'click': function() { return callStopSingbox().then(function(res) { notify('停止 sing-box', res); }); } }, '停止'),
					E('button', { 'class': 'sbl-btn', 'click': function() { return callRestartSingbox().then(function(res) { notify('重启 sing-box', res); }); } }, '重启')
				]),
				operationCard('MosDNS 联动', dnsMeta, [
					E('button', { 'class': 'sbl-btn primary', 'click': function() { return callRestartMosdns().then(function(res) { notify('重启 MosDNS', res); }); } }, '重启 MosDNS')
				]),
				coreUpdateCard(status),
				operationCard('Clash API', '打开 sing-box 的 Clash 控制面板，自动带入控制器地址和 Secret。', [
					E('button', { 'class': 'sbl-btn primary', 'click': function() { openClashPanel(status); } }, '打开面板')
				])
			]),
			E('div', { 'class': 'sbl-grid' }, [
				E('div', { 'class': 'sbl-panel sbl-card' }, [
					E('h3', {}, '运行与远程设置'),
					E('div', { 'class': 'sbl-settings' }, [
						E('div', { 'class': 'sbl-section' }, [
							E('h4', {}, '远程配置'),
							field('运行模式', modePicker(mode)),
							field('远程 URL', input('sbl-remote-url', remoteUrl, 'https://example.com/sing-box.json')),
							field('自动更新', toggle('sbl-remote-auto', remoteAuto, '每天 ' + remoteTime)),
							field('检查后应用', toggle('sbl-remote-apply', remoteApply, '启用'))
						]),
						E('div', { 'class': 'sbl-section' }, [
							E('h4', {}, 'MosDNS'),
							field('地址', input('sbl-mosdns-addr', mosdnsAddr)),
							field('端口', input('sbl-mosdns-port', mosdnsPort)),
							field('禁用劫持', toggle('sbl-disable-dns-hijack', disableDnsHijack, '启用')),
							field('重启 MosDNS', toggle('sbl-restart-mosdns', restartMosdns, restartMosdns ? '应用时重启' : '仅写入配置'))
						])
					])
				])
			]),
			E('div', { 'class': 'sbl-footer' }, [
				E('button', { 'class': 'sbl-btn primary', 'click': function() { return saveAndApplyAll(); } }, '保存并应用'),
				E('button', { 'class': 'sbl-btn', 'click': function() { return saveSettings('已保存设置，等待应用', false); } }, '保存'),
				E('button', { 'class': 'sbl-btn danger', 'click': function() { location.reload(); } }, '重置')
			])
		])
	]);
}

function renderRulesetPanel(status, rules) {
	var repo = uci.get('singboxlite', 'ruleset', 'repo_raw') || 'https://raw.githubusercontent.com/leosysd/ruleset/main/dist';
	var singboxDir = uci.get('singboxlite', 'ruleset', 'singbox_dir') || '/etc/sing-box/rule-set';
	var mosdnsDir = uci.get('singboxlite', 'ruleset', 'mosdns_dir') || '/etc/mosdns/rule';
	var autoUpdate = uci.get('singboxlite', 'ruleset', 'auto_update') === '1';
	var updateTime = uci.get('singboxlite', 'ruleset', 'update_time') || '07:45';
	var updateWeekday = uci.get('singboxlite', 'ruleset', 'update_weekday') || '2';
	var restartSingbox = uci.get('singboxlite', 'ruleset', 'restart_singbox') === '1';
	var restartMosdns = uci.get('singboxlite', 'ruleset', 'restart_mosdns') === '1';
	var parsed = parseRulesetOutput((rules || {}).output || '', singboxDir, mosdnsDir);

	return E('div', { 'class': 'sbl-tab-panel', 'data-panel': 'ruleset' }, [
		E('div', { 'class': 'sbl-panel sbl-section-head' }, [
			E('div', {}, [ E('h3', {}, '规则集'), E('p', {}, '从 leosysd/ruleset 拉取成品文件，分别写入 sing-box 与 MosDNS 规则目录。') ]),
			E('div', { 'class': 'sbl-actions' }, [
				E('button', { 'class': 'sbl-btn primary', 'click': function() {
					return saveRuleset('已保存规则集设置', false, true).then(function() {
						return callUpdateRuleset().then(function(res) { notify('更新规则集', res); });
					});
				} }, '立即更新'),
				E('button', { 'class': 'sbl-btn', 'click': function() { return callRulesetStatus().then(function(res) { notify('规则状态', res); }); } }, '查看状态'),
				E('button', { 'class': 'sbl-btn', 'click': function() { return saveRuleset('已保存并写入定时任务', true, true); } }, '写入定时任务'),
				E('button', { 'class': 'sbl-btn danger', 'click': function() { return callClearRulesetLog().then(function(res) { notify('清理规则日志', res); }); } }, '清理日志')
			])
		]),
		E('div', { 'class': 'sbl-stats' }, [
			statCard('更新状态', status.ruleset_last_update_result || '-', status.ruleset_last_update_time || '-', status.ruleset_last_update_result === 'pass' ? 'ok' : 'warn'),
			statCard('sing-box 目录', singboxDir, '输出 .srs / .json'),
			statCard('MosDNS 目录', mosdnsDir, '输出 .txt'),
			statCard('定时更新', autoUpdate ? weekdayName(updateWeekday) + ' ' + updateTime : '关闭', autoUpdate ? '仅运行中的服务会被重启' : '不会写入规则集定时任务')
		]),
		E('div', { 'class': 'sbl-rules-grid' }, [
			E('div', { 'class': 'sbl-panel sbl-card' }, [
				E('h3', {}, '规则集设置'),
				E('div', { 'class': 'sbl-section compact' }, [
					E('h4', {}, '源与目录'),
					field('dist 源地址', input('sblr-repo', repo)),
					field('sing-box 目录', input('sblr-sb-dir', singboxDir)),
					field('MosDNS 目录', input('sblr-md-dir', mosdnsDir))
				]),
				E('div', { 'class': 'sbl-two' }, [
					E('div', { 'class': 'sbl-section compact' }, [
						E('h4', {}, '自动更新'),
						field('启用', toggle('sblr-auto', autoUpdate, '每周执行')),
						field('星期', select('sblr-weekday', updateWeekday, WEEKDAYS)),
						field('时间', input('sblr-time', updateTime, '07:45'))
					]),
					E('div', { 'class': 'sbl-section compact' }, [
						E('h4', {}, '更新后动作'),
						field('重启 sing-box', toggle('sblr-restart-sb', restartSingbox, restartSingbox ? '开启' : '关闭')),
						field('重启 MosDNS', toggle('sblr-restart-md', restartMosdns, restartMosdns ? '开启' : '关闭')),
						field('失败处理', E('span', { 'class': 'sbl-flow-meta' }, '下载未全部成功时保留旧规则'))
					])
				]),
				E('div', { 'class': 'sbl-section compact' }, [
					E('h4', {}, '执行流程'),
					flowRow('1', '下载 6 个成品文件', 'srs / json / txt 分别用于 sing-box 和 MosDNS', '30 秒超时'),
					flowRow('2', '写入临时目录', '全部下载成功后再替换正式文件', '/etc/sing-box/singboxlite/ruleset'),
					flowRow('3', '备份并替换', '旧规则保留 .bak，避免半更新状态', '原子替换'),
					flowRow('4', '按运行状态重启 MosDNS', '只有 MosDNS 正在运行且开关开启才会重启', '等待 10 秒'),
					flowRow('5', '按运行状态重启 sing-box', '只有 sing-box 正在运行且开关开启才会重启', '按需执行')
				])
			]),
			E('div', { 'class': 'sbl-panel sbl-card' }, [
				E('h3', {}, '规则文件状态'),
				E('div', { 'class': 'sbl-rules' }, RULE_FILES.map(function(file) { return ruleCard(file, parsed[file[0]]); }))
			])
		]),
		E('div', { 'class': 'sbl-footer' }, [
			E('button', { 'class': 'sbl-btn primary', 'click': function() { return saveRuleset('已保存并写入规则集定时任务', true, true); } }, '保存并写入定时任务'),
			E('button', { 'class': 'sbl-btn', 'click': function() { return saveRuleset('已保存规则集设置，等待应用', false, false); } }, '保存'),
			E('button', { 'class': 'sbl-btn danger', 'click': function() { location.reload(); } }, '重置')
		])
	]);
}

function flowRow(step, title, body, meta) {
	return E('div', { 'class': 'sbl-flow-row' }, [
		E('span', { 'class': 'sbl-step' }, step),
		E('div', { 'class': 'sbl-flow-main' }, [ E('b', {}, title), E('span', {}, body) ]),
		E('span', { 'class': 'sbl-flow-meta' }, meta)
	]);
}

function renderLogsPanel(status, initial) {
	var tailLines = uci.get('singboxlite', 'log', 'tail_lines') || '200';
	var autoRefresh = uci.get('singboxlite', 'log', 'auto_refresh') === '1';

	lastStatus = status;
	lastLogSize = initial.size || 0;

	return E('div', { 'class': 'sbl-tab-panel', id: 'sbl-logs-panel', 'data-panel': 'logs' }, [
		E('div', { 'class': 'sbl-panel sbl-section-head' }, [
			E('div', {}, [ E('h3', {}, '日志中心'), E('p', {}, '按来源、级别和关键词筛选日志，只保留整理后的列表用于快速排错。') ]),
			E('div', { 'class': 'sbl-actions' }, [
				E('button', { 'class': 'sbl-btn primary', 'click': refreshLog }, '立即刷新'),
				E('button', { 'class': 'sbl-btn', 'click': function() { return saveLogSettings('已写入定时任务', true); } }, '写入定时任务'),
				E('button', { 'class': 'sbl-btn danger', 'click': cleanCurrentLog }, '清理当前日志')
			])
		]),
		E('div', { 'class': 'sbl-stats' }, [
			statCard('当前来源', sourceLabel('singbox'), sourcePath('singbox'), '', 'sbll-source-value', 'sbll-source-meta'),
			statCard('日志大小', formatBytes(initial.size || 0), activeSource === 'singbox' ? '来自系统日志 logread' : '建议清理或启用轮转', (initial.size || 0) > 1024 * 1024 ? 'danger' : '', 'sbll-size-value'),
			statCard('匹配结果', '-', '错误 0 · 警告 0 · 信息 0', '', 'sbll-match-value', 'sbll-match-meta'),
			statCard('自动刷新', autoRefresh ? '开启' : '关闭', autoRefresh ? '每 5 秒刷新一次' : '手动刷新', autoRefresh ? 'ok' : '', 'sbll-auto-value', 'sbll-auto-meta')
		]),
		E('div', { 'class': 'sbl-panel sbl-toolbar' }, [
			E('div', { 'class': 'sbl-sources' }, [
				E('button', { 'class': 'sbl-source active', 'data-source': 'singbox', 'click': function() { return setSource('singbox'); } }, sourceButtonLabel('singbox')),
				E('button', { 'class': 'sbl-source', 'data-source': 'system', 'click': function() { return setSource('system'); } }, sourceButtonLabel('system')),
				E('button', { 'class': 'sbl-source', 'data-source': 'app', 'click': function() { return setSource('app'); } }, sourceButtonLabel('app'))
			]),
			E('label', { 'class': 'sbl-switchline' }, [
				E('input', { id: 'sbll-auto-refresh', type: 'checkbox', checked: autoRefresh ? true : null, 'change': function(ev) {
					setAutoRefresh(ev.target.checked);
					return saveLogSettings('', false);
				} }),
				E('span', { 'class': 'sbl-switch' }),
				E('b', {}, '自动刷新')
			]),
			selectLines(tailLines),
			E('select', { 'class': 'sbl-input sbl-small-input', id: 'sbll-level', 'change': function() { renderLog(lastRawLog); } }, [
				E('option', { value: 'all' }, '全部级别'),
				E('option', { value: 'error' }, '仅错误'),
				E('option', { value: 'warn' }, '仅警告'),
				E('option', { value: 'info' }, '仅信息'),
				E('option', { value: 'debug' }, '仅调试')
			]),
			E('input', { 'class': 'sbl-input sbl-search', id: 'sbll-search', placeholder: '搜索关键词，例如 DNS / 路由 / 失败', 'input': function() { renderLog(lastRawLog); } }),
			E('button', { 'class': 'sbl-btn', 'click': function() {
				document.getElementById('sbll-search').value = '';
				document.getElementById('sbll-level').value = 'all';
				renderLog(lastRawLog);
			} }, '清空筛选'),
			E('button', { 'class': 'sbl-btn danger', 'click': cleanCurrentLog }, '清理日志')
		]),
		E('div', { 'class': 'sbl-panel sbl-card' }, [
			E('div', { 'class': 'sbl-summary', id: 'sbll-summary' }),
			E('div', { 'class': 'sbl-log-list', id: 'sbll-list' })
		]),
		E('div', { 'class': 'sbl-footer' }, [
			E('button', { 'class': 'sbl-btn primary', 'click': function() { return saveLogSettings('已保存显示行数与自动刷新设置', false); } }, '保存显示设置'),
			E('button', { 'class': 'sbl-btn', 'click': function() { return saveLogSettings('已写入自动清理定时任务', true); } }, '写入自动清理任务'),
			E('button', { 'class': 'sbl-btn danger', 'click': function() { location.reload(); } }, '重置')
		])
	]);
}

function css() {
	return E('style', {}, `
		.cbi-tabmenu,.tabs,#tabmenu,.tabmenu,.cbi-map > .cbi-section:first-child:empty{display:none!important}
		.sbl-page{color:#14223a;font-size:12px;margin:-12px;padding:0 18px 18px;background:linear-gradient(180deg,#5f70e8 0,#5f70e8 22px,#eaf2ff 22px,#f7fbff 100%);min-height:calc(100vh - 110px)}
		.sbl-shell{max-width:1440px;margin:0 auto;padding-top:4px}
		.sbl-panel{background:rgba(255,255,255,.97);border:1px solid #d8e4f5;border-radius:10px;box-shadow:0 14px 34px rgba(64,91,160,.10)}
		.sbl-hero{position:relative;overflow:hidden;background:linear-gradient(115deg,#204d76 0,#276be2 62%,#60a4ff 100%);border-color:rgba(255,255,255,.28);padding:12px 16px 10px;margin-bottom:8px;color:#fff;min-height:112px;box-sizing:border-box;display:flex;align-items:center}
		.sbl-hero:after{content:"";position:absolute;right:-42px;top:-32px;width:190px;height:190px;border-radius:999px;background:rgba(255,255,255,.12)}
		.sbl-hero-top{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:18px;width:100%}
		.sbl-brand{display:flex;align-items:center;gap:10px;margin-bottom:6px}
		.sbl-logo{position:relative;width:32px;height:32px;border-radius:10px;background:rgba(255,255,255,.18);display:inline-flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 1px rgba(255,255,255,.16)}
		.sbl-logo-ring{position:absolute;width:16px;height:16px;border:2px solid rgba(255,255,255,.92);border-radius:999px}
		.sbl-logo-dot{position:absolute;width:6px;height:6px;border-radius:999px;background:#fff;box-shadow:0 0 0 2px rgba(255,255,255,.18)}
		.sbl-logo-dot.d1{left:7px;top:7px}.sbl-logo-dot.d2{right:7px;top:9px}.sbl-logo-dot.d3{left:13px;bottom:6px}
		.sbl-brand b{display:block;font-size:13px}.sbl-brand span{display:block;font-size:11px;color:rgba(255,255,255,.72)}
		.sbl-title h2{margin:0 0 5px!important;padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important;font-size:17px;line-height:1.1;color:#fff!important;font-weight:800}
		.sbl-title p{margin:0;color:rgba(255,255,255,.82);font-size:12px;line-height:1.3;max-width:720px}
		.sbl-actions,.sbl-footer,.sbl-op-actions,.sbl-toolbar,.sbl-sources{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
		.sbl-actions{position:relative;z-index:1;justify-content:flex-end}
		.sbl-btn{min-height:30px;border-radius:10px;border:1px solid #cdddf5;background:#fff;color:#2662d9;padding:0 12px;font-size:12px;font-weight:800;cursor:pointer}
		.sbl-btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}.sbl-btn.danger{background:#f04f4f;border-color:#f04f4f;color:#fff}.sbl-btn.soft{background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.2);color:#fff}
		.sbl-tabs{height:40px;display:flex;align-items:center;gap:6px;padding:0 10px;margin:8px 0;border-radius:8px;box-shadow:0 12px 28px rgba(64,91,160,.08)}
		.sbl-tab{height:28px;display:inline-flex;align-items:center;padding:0 14px;border:0;border-radius:7px;background:transparent;color:#4b6382;font-size:12px;font-weight:900;cursor:pointer}.sbl-tab.active{color:#fff;background:#2563eb;box-shadow:0 6px 14px rgba(37,99,235,.22)}
		.sbl-tab-panel{display:none}.sbl-tab-panel.active{display:block}
		.sbl-status-strip{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:8px 0;background:rgba(255,255,255,.98);border:1px solid #d8e4f5;border-radius:10px;padding:9px 12px;box-shadow:0 12px 28px rgba(64,91,160,.08)}
		.sbl-crumb{color:#60728e;font-weight:800}.sbl-enabled{display:inline-flex;align-items:center;border-radius:999px;background:#e8fbf0;color:#07905f;border:1px solid #bceacf;padding:5px 11px;font-weight:900;white-space:nowrap}
		.sbl-overview-strip,.sbl-stats{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin-bottom:8px}.sbl-stats{grid-template-columns:repeat(4,minmax(0,1fr))}
		.sbl-overview-item,.sbl-stat{min-height:54px;background:#fff;border:1px solid #d8e4f5;border-radius:10px;padding:9px 11px;box-shadow:0 12px 28px rgba(64,91,160,.07);overflow:hidden;box-sizing:border-box}
		.sbl-overview-item span,.sbl-stat-label{display:block;color:#65758f;font-weight:800;margin-bottom:4px;font-size:11px}.sbl-overview-item b,.sbl-stat-value{display:block;color:#132845;font-size:13px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sbl-stat-value.ok{color:#008763}.sbl-stat-value.warn{color:#b76b05}.sbl-stat-value.danger{color:#dc2947}.sbl-stat-meta{font-size:11px;color:#7a8ba3;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.sbl-service-card{min-height:66px}.sbl-service-meta{display:block;margin-top:5px;font-style:normal;font-size:11px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sbl-service-meta.ok{color:#008763}.sbl-service-meta.danger{color:#dc2947}
		.sbl-main{display:grid;gap:10px}.sbl-op-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.sbl-op-card{min-height:112px;border:1px solid #d8e4f5;border-radius:10px;background:#fff;padding:13px;box-sizing:border-box}.sbl-op-card h3,.sbl-card>h3{margin:0 0 8px;font-size:14px;color:#263959}.sbl-op-card p{margin:0 0 14px;color:#70849f;line-height:1.45;min-height:32px}.sbl-core-card .sbl-op-actions{margin:10px 0 8px}.sbl-core-toggle{margin:2px 0 8px}.sbl-core-meta{color:#5f7088;font-size:12px;line-height:1.35}.sbl-core-meta span{color:#263959;font-weight:800}
		.sbl-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;align-items:start}.sbl-card{padding:12px;margin-bottom:8px}.sbl-settings{display:grid;grid-template-columns:1fr 1fr;gap:10px}.sbl-section{border:1px solid #dce7f6;border-radius:10px;padding:10px;background:#fbfdff}.sbl-section.compact{padding:8px 10px;margin-bottom:8px}.sbl-section h4{margin:0 0 6px;font-size:12px;color:#263959}
		.sbl-field{display:grid;grid-template-columns:108px minmax(0,1fr);align-items:center;gap:8px;margin:6px 0}.sbl-field>span{font-weight:800;color:#425672;text-align:right}.sbl-input{height:29px;border:1px solid #cbd8e8;border-radius:8px;background:#fff;color:#102038;box-sizing:border-box;padding:0 9px;width:100%;font-size:12px}.sbl-small-input{width:auto;min-width:118px}.sbl-search{flex:1 1 340px;min-width:240px}
		.sbl-mode-picker,.sbl-two{display:grid;grid-template-columns:1fr 1fr;gap:7px}.sbl-mode-btn{min-height:44px;border:1px solid #cbd8e8;border-radius:10px;background:#fff;color:#102038;padding:7px 10px;text-align:left;cursor:pointer}.sbl-mode-btn b{display:block;font-size:12px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sbl-mode-btn span{display:block;margin-top:3px;color:#7a8ba3;font-size:11px;line-height:1.2}.sbl-mode-btn.active{border-color:#8fb4ff;background:#eef5ff;color:#2563eb}.sbl-mode-btn.active span{color:#2563eb}
		.sbl-toggle,.sbl-switchline{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:#5f7088;font-weight:700}.sbl-toggle input,.sbl-switchline input{display:none}.sbl-switch{position:relative;width:34px;height:18px;border-radius:999px;background:#cbd5e1;display:inline-block}.sbl-switch:before{content:"";position:absolute;width:14px;height:14px;border-radius:999px;background:#fff;left:2px;top:2px;transition:.15s}.sbl-toggle input:checked+.sbl-switch,.sbl-switchline input:checked+.sbl-switch{background:#2563eb}.sbl-toggle input:checked+.sbl-switch:before,.sbl-switchline input:checked+.sbl-switch:before{transform:translateX(16px)}
		.sbl-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 12px;margin-bottom:8px;box-sizing:border-box}.sbl-section-head h3{margin:0 0 3px;color:#263959;font-size:14px}.sbl-section-head p{margin:0;color:#6d7f98;line-height:1.35}
		.sbl-rules-grid{display:grid;grid-template-columns:minmax(0,.96fr) minmax(0,1.04fr);gap:8px;align-items:start}.sbl-rules{display:grid;grid-template-columns:1fr 1fr;gap:8px}.sbl-rule{display:grid;grid-template-columns:12px minmax(0,1fr) auto;gap:8px;align-items:center;border:1px solid #dbe3ef;border-radius:7px;background:#fbfcff;padding:7px 9px;min-height:42px}.sbl-dot{width:8px;height:8px;border-radius:999px;display:inline-block}.sbl-dot.ok{background:#008763}.sbl-dot.warn{background:#c87209}.sbl-rule-main b{display:block;font-size:12px;color:#102038;margin-bottom:2px}.sbl-rule-main span{display:block;color:#5f7088;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sbl-pill{display:inline-flex;align-items:center;min-height:20px;border-radius:999px;padding:0 8px;font-size:11px;font-weight:900}.sbl-pill.ok{background:#eafaf2;color:#008763}.sbl-pill.warn{background:#fff4cf;color:#b76b05}
		.sbl-flow-row{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:7px;align-items:center;border-bottom:1px solid #e4eaf2;padding:6px 0}.sbl-flow-row:last-child{border-bottom:0}.sbl-step{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:999px;background:#eef2ff;color:#4f62df;font-weight:900}.sbl-flow-main b{display:block;color:#102038;margin-bottom:1px}.sbl-flow-main span,.sbl-flow-meta{color:#5f7088;font-size:11px}
		.sbl-toolbar{padding:8px 10px;margin-bottom:8px}.sbl-source{min-height:28px;border-radius:7px;border:1px solid #cbd6e6;background:#fff;color:#102038;padding:0 11px;font-size:12px;font-weight:900;cursor:pointer}.sbl-source.active{background:#2563eb;border-color:#2563eb;color:#fff;box-shadow:0 6px 14px rgba(37,99,235,.2)}.sbl-summary{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}.sbl-chip{display:inline-flex;align-items:center;min-height:21px;border-radius:999px;border:1px solid #dbe3ef;background:#fbfcff;color:#5f7088;padding:0 8px;font-size:11px}.sbl-chip b{color:#102038;margin-left:3px}.sbl-chip.error{background:#fff3f5;color:#dc2947}.sbl-chip.warn{background:#fff8df;color:#b76b05}
		.sbl-log-list{border:1px solid #dbe3ef;border-radius:7px;overflow:auto;max-height:calc(100vh - 405px);min-height:360px;background:#fff}.sbl-log-row{display:grid;grid-template-columns:38px 142px 58px minmax(0,1fr) 74px;gap:7px;align-items:center;min-height:28px;border-bottom:1px solid #e4eaf2;border-left:3px solid #5b6ee1;padding:2px 8px}.sbl-log-row:last-child{border-bottom:0}.sbl-log-row.warn{background:#fffdf2;border-left-color:#c87209}.sbl-log-row.error{background:#fff8fa;border-left-color:#f23655}.sbl-log-index{font-size:11px;color:#7a8ba3;text-align:right;font-weight:900}.sbl-log-time{font:11px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;color:#5f7088;background:#f5f7fb;border-radius:5px;padding:2px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sbl-log-level{justify-self:start;min-width:42px;border-radius:5px;padding:2px 6px;text-align:center;font-size:10px;font-weight:900;background:#e9f2ff;color:#1d6bd8}.sbl-log-level.warn{background:#fff1c2;color:#a46500}.sbl-log-level.error{background:#ffe0e7;color:#c62844}.sbl-log-level.debug{background:#eef2f7;color:#5f728b}.sbl-log-msg{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#102038}.sbl-log-topic{text-align:right;color:#5f7088;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.sbl-footer{justify-content:flex-end;margin-top:2px}
		@media(max-width:1280px){.sbl-op-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.sbl-overview-strip,.sbl-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.sbl-rules-grid{grid-template-columns:1fr}}
		@media(max-width:900px){.sbl-settings,.sbl-two,.sbl-rules,.sbl-op-grid,.sbl-overview-strip,.sbl-stats{grid-template-columns:1fr}.sbl-hero-top,.sbl-status-strip{align-items:flex-start;flex-direction:column}.sbl-actions{justify-content:flex-start}.sbl-field{grid-template-columns:104px minmax(0,1fr)}.sbl-log-row{grid-template-columns:36px 120px 56px minmax(0,1fr)}.sbl-log-topic{display:none}}
	`);
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('singboxlite'),
			L.resolveDefault(callStatus(), {}),
			L.resolveDefault(callRulesetStatus(), {}),
			L.resolveDefault(callTailSourceLog('singbox', Number(uci.get('singboxlite', 'log', 'tail_lines') || 200)), {})
		]);
	},

	render: function(data) {
		var status = data[1] || {};
		var rules = data[2] || {};
		var log = data[3] || {};

		setAutoRefresh(false);
		lastStatus = status;
		lastRawLog = log.log || log.output || '';

		var page = E('div', { 'class': 'sbl-page', id: 'sbl-page' }, [
			css(),
			E('div', { 'class': 'sbl-shell' }, [
				renderHero(),
				pageTabs(),
				renderOverviewPanel(status),
				renderRulesetPanel(status, rules),
				renderLogsPanel(status, log)
			])
		]);

		window.setTimeout(function() {
			renderLog(lastRawLog, log.size);
			setAutoRefresh(uci.get('singboxlite', 'log', 'auto_refresh') === '1' && activeTab === 'logs');
		}, 0);

		return page;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
