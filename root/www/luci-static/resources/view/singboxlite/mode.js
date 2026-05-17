'use strict';
'require form';
'require uci';
'require view';

return view.extend({
	load: function() {
		return uci.load('singboxlite');
	},

	render: function() {
		var m, s, o;

		m = new form.Map('singboxlite', 'SingBox Lite - 运行模式', '选择 sing-box 与 DNS 组件的协作方式。');

		s = m.section(form.NamedSection, 'main', 'main', '基础模式');

		o = s.option(form.ListValue, 'mode', '运行模式');
		o.value('singbox_mosdns', 'sing-box + mosdns');
		o.value('singbox_dns', '仅 sing-box DNS');
		o.value('import_only', '仅导入配置');
		o.default = 'singbox_mosdns';
		o.rmempty = false;

		o = s.option(form.Value, 'config_path', 'sing-box 配置路径');
		o.default = '/etc/sing-box/config.json';
		o.rmempty = false;

		o = s.option(form.Value, 'log_path', 'sing-box 日志路径');
		o.default = '/etc/sing-box/sing-box.log';
		o.rmempty = false;

		s = m.section(form.NamedSection, 'dns', 'dns', 'MosDNS 联动');

		o = s.option(form.Value, 'mosdns_addr', 'MosDNS 地址');
		o.default = '127.0.0.1';
		o.depends({ mode: 'singbox_mosdns' });

		o = s.option(form.Value, 'mosdns_port', 'MosDNS 端口');
		o.datatype = 'port';
		o.default = '5335';

		o = s.option(form.Flag, 'disable_dns_hijack', '禁用 sing-box DNS 劫持');
		o.default = o.enabled;
		o.rmempty = false;

		o = s.option(form.Flag, 'restart_mosdns_after_apply', '应用配置后重启 MosDNS');
		o.default = o.enabled;
		o.rmempty = false;

		s = m.section(form.NamedSection, 'log', 'log', '日志清理');

		o = s.option(form.Flag, 'cleanup_enabled', '每天自动清理日志');
		o.default = o.enabled;
		o.rmempty = false;

		o = s.option(form.Value, 'cleanup_time', '清理时间');
		o.default = '03:10';
		o.depends('cleanup_enabled', '1');

		o = s.option(form.Value, 'tail_lines', '日志显示行数');
		o.datatype = 'uinteger';
		o.default = '200';

		return m.render();
	}
});
