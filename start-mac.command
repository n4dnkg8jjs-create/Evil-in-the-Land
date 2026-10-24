#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then echo "Node.js is not installed. Download the LTS version from https://nodejs.org"; read -n 1; exit 1; fi
(sleep 1; open http://localhost:7777) &
node server.js
