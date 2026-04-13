#!/bin/bash
set -e

if [ -f .env.local ]; then
  export $(cat .env.local | grep -v '^#' | xargs)
fi

npm run build
electron-builder --config electron-builder.config.ts --win nsis --x64 --publish always
