#!/bin/bash
set -e

# Load environment variables from .env.local if it exists
if [ -f .env.local ]; then
  export $(cat .env.local | grep -v '^#' | xargs)
fi

# Run the build and publish commands
npm run build
electron-builder --config electron-builder.config.ts --mac dmg zip --arm64 --win nsis --x64 --publish always
