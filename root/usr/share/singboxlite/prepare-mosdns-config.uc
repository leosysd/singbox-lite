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

function remove_remote_dns_direct_cidrs(route) {
	let remote_dns = [
		'1.1.1.1/32',
		'1.0.0.1/32',
		'8.8.8.8/32',
		'8.8.4.4/32',
		'104.16.248.249/32',
		'104.16.249.249/32'
	];

	if (type(route) != 'object' || type(route.rules) != 'array')
		return;

	for (let i = 0; i < length(route.rules); i++) {
		let rule = route.rules[i];

		if (type(rule) != 'object' || rule.outbound != 'direct' || type(rule.ip_cidr) != 'array')
			continue;

		let cidrs = [];
		for (let j = 0; j < length(rule.ip_cidr); j++) {
			if (!array_has(remote_dns, rule.ip_cidr[j]))
				push(cidrs, rule.ip_cidr[j]);
		}
		rule.ip_cidr = cidrs;
	}
}

function server_is_domain(server) {
	return type(server) == 'string' && server != '' && !match(server, /^[0-9.]+$/) && !match(server, /^\[/);
}

function outbound_server_domains(config) {
	let domains = [];

	if (type(config.outbounds) != 'array')
		return domains;

	for (let i = 0; i < length(config.outbounds); i++) {
		let outbound = config.outbounds[i];
		let server = type(outbound) == 'object' ? outbound.server : null;

		if (server_is_domain(server) && !array_has(domains, server))
			push(domains, server);
	}

	return domains;
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
	},
	{
		type: 'udp',
		tag: 'direct-dns',
		server: '223.5.5.5',
		server_port: 53
	}
	],
	rules: [],
	final: 'mosdns',
	reverse_mapping: true
};

let outbound_domains = outbound_server_domains(config);
if (length(outbound_domains) > 0) {
	push(config.dns.rules, {
		action: 'route',
		domain: outbound_domains,
		server: 'direct-dns'
	});
}

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
	remove_remote_dns_direct_cidrs(config.route);
	ensure_direct_dns_upstreams(config.route);
}

writefile(target, sprintf('%.J\n', config));
