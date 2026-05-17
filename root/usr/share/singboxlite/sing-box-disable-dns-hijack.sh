#!/bin/sh

# Remove only sing-box auto_redirect DNS DNAT rules.
# Keep OpenWrt fw4 DNS redirect rules intact, so LAN DNS still goes to dnsmasq.

for _ in 1 2 3 4 5; do
	nft -a list table inet sing-box 2>/dev/null | awk '
		/^[[:space:]]*chain[[:space:]]+/ { chain=$2 }
		/th dport 53/ && /dnat/ {
			for (i = 1; i <= NF; i++) {
				if ($i == "handle") print chain, $(i + 1)
			}
		}
	' | while read -r chain handle; do
		[ -n "$chain" ] && [ -n "$handle" ] || continue
		nft delete rule inet sing-box "$chain" handle "$handle" 2>/dev/null
	done
	sleep 1
done
