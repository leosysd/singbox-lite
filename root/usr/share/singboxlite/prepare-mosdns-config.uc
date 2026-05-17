#!/usr/bin/env ucode

'use strict';

import { readfile, writefile } from 'fs';

function fail(message) {
	warn(message + '\n');
	exit(1);
}

let source = ARGV[0] || '';
let target = ARGV[1] || '';
let mosdns_addr = ARGV[2] || '127.0.0.1';
let mosdns_port = int(ARGV[3] || '5335') || 5335;

if (source == '' || target == '')
	fail('usage: prepare-mosdns-config.uc <source> <target> [addr] [port]');

let content = readfile(source);
if (!content)
	fail('无法读取 sing-box JSON：' + source);

let config = null;
try {
	config = json(content);
} catch (e) {
	fail('JSON 格式错误：' + e);
}

if (type(config) != 'object')
	fail('JSON 顶层必须是对象');

if (type(config.dns) != 'object')
	config.dns = {};

config.dns.servers = [
	{
		type: 'udp',
		tag: 'mosdns',
		server: mosdns_addr,
		server_port: mosdns_port
	}
];
config.dns.rules = [
	{
		action: 'route',
		server: 'mosdns'
	}
];
config.dns.final = 'mosdns';
config.dns.reverse_mapping = true;

if (type(config.route) == 'object')
	config.route.default_domain_resolver = 'mosdns';

writefile(target, sprintf('%.J\n', config));
