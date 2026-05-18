#!/usr/bin/env ucode

'use strict';

import { readfile, writefile } from 'fs';

function fail(message) {
	warn(message + '\n');
	exit(1);
}

function array_has(items, needle) {
	if (type(items) != 'array')
		return false;

	for (let i = 0; i < length(items); i++) {
		if (items[i] == needle)
			return true;
	}

	return false;
}

function ensure_direct_dns_upstreams(route) {
	if (type(route) != 'object' || type(route.rules) != 'array')
		return;

	let cidrs = [
		'223.5.5.5/32',
		'119.29.29.29/32',
		'114.114.114.114/32',
		'114.114.115.115/32'
	];
	let target = null;

	for (let i = 0; i < length(route.rules); i++) {
		let rule = route.rules[i];

		if (type(rule) == 'object' && rule.outbound == 'direct' && type(rule.ip_cidr) == 'array') {
			target = rule;
			break;
		}
	}

	if (target == null) {
		target = {
			ip_cidr: [],
			outbound: 'direct'
		};

		let insert_at = length(route.rules);
		for (let i = 0; i < length(route.rules); i++) {
			let rule = route.rules[i];

			if (type(rule) == 'object' && rule.outbound != 'direct' && rule.network != null) {
				insert_at = i;
				break;
			}
		}

		splice(route.rules, insert_at, 0, target);
	}

	for (let i = 0; i < length(cidrs); i++) {
		if (!array_has(target.ip_cidr, cidrs[i]))
			push(target.ip_cidr, cidrs[i]);
	}
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

config.dns = {
	servers: [
	{
		type: 'udp',
		tag: 'mosdns',
		server: mosdns_addr,
		server_port: mosdns_port
	}
	],
	final: 'mosdns',
	reverse_mapping: true
};

if (type(config.inbounds) == 'array') {
	for (let i = 0; i < length(config.inbounds); i++) {
		let inbound = config.inbounds[i];

		if (type(inbound) == 'object' && inbound.type == 'tun') {
			inbound.auto_route = true;
			inbound.auto_redirect = true;
		}
	}
}

if (type(config.route) == 'object') {
	if (type(config.route.rules) == 'array') {
		let rules = [];

		for (let i = 0; i < length(config.route.rules); i++) {
			let rule = config.route.rules[i];

			if (type(rule) == 'object' && rule.action == 'hijack-dns')
				continue;

			push(rules, rule);
		}

		config.route.rules = rules;
	}

	config.route.default_domain_resolver = 'mosdns';
	ensure_direct_dns_upstreams(config.route);
}

writefile(target, sprintf('%.J\n', config));
