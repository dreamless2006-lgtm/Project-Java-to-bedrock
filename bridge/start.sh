#!/usr/bin/env bash
# Real AI bridge: run this to install (first time) and start. Needs Node.js 20+ from nodejs.org.
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js is not installed. Get it from https://nodejs.org and run this again."; exit 1; }
[ -d node_modules ] || npm install || exit 1
exec node index.mjs
