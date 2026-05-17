#!/usr/bin/env ucode

'use strict';

import { readfile, writefile } from 'fs';

function fail(message) {
	warn(message + '\n');
	exit(1);
}

let source = ARGV[0] || '';
let target = ARGV[1] || '';

if (source == '' || target == '')
	fail('usage: prepare-singbox-config.uc <source> <target>');

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

if (type(config.inbounds) == 'array') {
	for (let i = 0; i < length(config.inbounds); i++) {
		let inbound = config.inbounds[i];

		if (type(inbound) == 'object' && inbound.type == 'tun') {
			inbound.auto_route = true;
			inbound.auto_redirect = true;
		}
	}
}

writefile(target, sprintf('%.J\n', config));
