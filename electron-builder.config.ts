import type { Configuration } from 'electron-builder'

const configuration: Configuration = {
  appId: 'com.ordicab.desktop',
  productName: 'Ordicab',
  directories: {
    output: 'out/make',
    buildResources: 'build'
  },
  files: [
    '!**/.vscode/*',
    '!src/*',
    '!electron.vite.config.{js,ts,mjs,cjs}',
    '!{.eslintcache,eslint.config.mjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}',
    '!{.env,.env.*,.npmrc,pnpm-lock.yaml}',
    '!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}'
  ],
  // Native binaries (.node, .dll, .dylib, .so) and model files cannot live
  // inside the asar archive — they must be on the real filesystem so the
  // OS loader and onnxruntime can mmap them.
  asarUnpack: [
    'resources/**',
    '**/node_modules/onnxruntime-node/**',
    '**/node_modules/@huggingface/transformers/**'
  ],
  extraResources: [
    { from: 'build/license_fr.txt', to: 'legal/license_fr.txt' },
    { from: 'build/license_en.txt', to: 'legal/license_en.txt' },
    { from: 'resources/tessdata/fra.traineddata', to: 'tessdata/fra.traineddata' },
    { from: 'resources/tessdata/eng.traineddata', to: 'tessdata/eng.traineddata' },
    // Embedded-AI model bundles — populated by `npm run prepare:models` before
    // packaging. Every model lives under a single `resources/models/` root so
    // transformers.js's module-global `env.localModelPath` can resolve all of
    // them through one claim (the runtime layout is `{localModelPath}/{modelId}/`).
    { from: 'resources/models', to: 'models' }
  ],
  mac: {
    icon: 'build/icon.icns',
    category: 'public.app-category.productivity',
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] }
    ],
    entitlementsInherit: 'build/entitlements.mac.plist',
    artifactName: '${productName}-mac-${arch}.${ext}',
    notarize: true
  },
  dmg: {
    artifactName: '${productName}-mac-${arch}.${ext}'
  },
  win: {
    icon: 'build/icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }]
  },
  nsis: {
    artifactName: '${productName}-win-${arch}-setup.${ext}',
    shortcutName: '${productName}',
    uninstallDisplayName: '${productName}',
    createDesktopShortcut: 'always',
    oneClick: false,
    allowToChangeInstallationDirectory: false,
    license: 'build/license_fr.txt'
  },
  npmRebuild: false,
  publish: [
    {
      provider: 'github',
      owner: 'jmtanguy',
      repo: 'Ordicab',
      releaseType: 'release'
    }
  ]
}

export default configuration
