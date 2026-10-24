#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js is not installed: https://nodejs.org"; exit 1; }
(sleep 1; xdg-open http://localhost:7777 >/dev/null 2>&1) &
node server.js
