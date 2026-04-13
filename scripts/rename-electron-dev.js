/**
 * Patches the Electron binary's Info.plist so the app name shown in the macOS
 * menu bar and Dock tooltip is "Ordicab" instead of "Electron" during dev.
 *
 * Run automatically via the `postinstall` npm hook.
 * Only modifies the file when running on macOS and when the plist exists.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { readFileSync, writeFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')

const APP_NAME = 'Ordicab'
const BUNDLE_ID = 'com.ordicab.app'
const PLIST_PATH = join(__dirname, '../node_modules/electron/dist/Electron.app/Contents/Info.plist')

if (process.platform !== 'darwin' || !existsSync(PLIST_PATH)) {
  process.exit(0)
}

let content = readFileSync(PLIST_PATH, 'utf8')
const original = content

content = content
  .replace(/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${APP_NAME}$2`)
  .replace(/(<key>CFBundleName<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${APP_NAME}$2`)
  .replace(/(<key>CFBundleIdentifier<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${BUNDLE_ID}$2`)

if (content !== original) {
  writeFileSync(PLIST_PATH, content, 'utf8')
  console.log(`[rename-electron-dev] Patched Electron.app Info.plist → "${APP_NAME}"`)
} else {
  console.log(`[rename-electron-dev] Info.plist already patched, nothing to do.`)
}
