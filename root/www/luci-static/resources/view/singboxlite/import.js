'use strict';
'require form';
'require rpc';
'require uci';
'require ui';
'require view';

var LOCAL_TEMP = '/tmp/singboxlite/import-local.json';

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

function notify(title, res) {
	ui.addNotification(null, E('pre', { 'class': res.ok ? '' : 'errors' }, [
		title + '\n' + (res.output || res.backup || (res.ok ? '操作成功' : '操作失败'))
	]), res.ok ? 'info' : 'error');
}

return view.extend({
	load: function() {
		return uci.load('singboxlite');
	},

	render: function() {
		var m, s, o;

		m = new form.Map('singboxlite', 'SingBox Lite - 配置导入', '支持本地 JSON 和远程 URL JSON。所有配置都会先执行 sing-box check，通过后才能应用。');

		s = m.section(form.TypedSection, null, '本地 JSON 配置');
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.DummyValue, '_local_note', '说明');
		o.rawhtml = true;
		o.default = '上传 sing-box 原生 JSON 到 <code>%s</code>，然后检查并应用。'.format(LOCAL_TEMP);

		o = s.option(form.Button, '_upload_local', '上传并检查');
		o.inputstyle = 'action';
		o.inputtitle = '选择 config.json';
		o.onclick = function(ev) {
			return ui.uploadFile(LOCAL_TEMP, ev.target).then(function() {
				return callCheckImported('local').then(function(res) {
					notify('本地配置检查', res);
				});
			}).catch(function(e) {
				ui.addNotification(null, E('p', e.message), 'error');
			});
		};

		o = s.option(form.Button, '_apply_local', '应用本地配置');
		o.inputstyle = 'apply';
		o.onclick = function() {
			return callApplyImported('local').then(function(res) {
				notify('应用本地配置', res);
			});
		};

		s = m.section(form.NamedSection, 'remote', 'remote', '远程 URL 配置');

		var remoteUrlOption = s.option(form.Value, 'url', '远程 JSON URL');
		o = remoteUrlOption;
		o.placeholder = 'https://example.com/sing-box.json';
		o.rmempty = true;

		o = s.option(form.Flag, 'auto_update', '自动更新');
		o.default = o.disabled;
		o.rmempty = false;

		o = s.option(form.Value, 'auto_update_time', '更新时间');
		o.placeholder = '03:00';
		o.default = '03:00';
		o.depends('auto_update', '1');

		o = s.option(form.Flag, 'auto_apply', '检查通过后自动应用');
		o.default = o.disabled;
		o.depends('auto_update', '1');

		o = s.option(form.Button, '_fetch_remote', '拉取并检查');
		o.inputstyle = 'action';
		o.onclick = function(ev, section_id) {
			var url = remoteUrlOption.formvalue(section_id) || uci.get('singboxlite', 'remote', 'url') || '';
			return m.save().then(function() {
				return callFetchRemote(url).then(function(res) {
					notify('远程配置检查', res);
				});
			});
		};

		o = s.option(form.Button, '_apply_remote', '应用远程配置');
		o.inputstyle = 'apply';
		o.onclick = function() {
			return callApplyImported('remote').then(function(res) {
				notify('应用远程配置', res);
			});
		};

		return m.render();
	}
});
