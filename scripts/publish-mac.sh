#!/bin/bash
set -e

if [ -f .env.local ]; then
  export $(cat .env.local | grep -v '^#' | xargs)
fi

npm run build
electron-builder --config electron-builder.config.ts --mac dmg zip --arm64 --publish always
