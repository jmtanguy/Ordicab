/**
 * Generates the installer/DMG branding artwork from the Ordicab app icon.
 *
 *   node scripts/generate-brand-assets.mjs
 *
 * Outputs (committed under build/, consumed by electron-builder.config.ts):
 *   build/icon.png                  Runtime/package icon        512×512
 *   build/icon.ico                  Windows app/installer icon
 *   build/icon.icns                 macOS app icon
 *   build/installerSidebar.bmp      NSIS welcome/finish panel   164×314 (BMP3)
 *   build/uninstallerSidebar.bmp    NSIS uninstall welcome      164×314 (BMP3)
 *   build/installerHeader.bmp       NSIS inner-page header      150×57  (BMP3)
 *   build/background.png            DMG window background       540×460
 *   build/background@2x.png         DMG background (retina)     1080×920
 *   build/background.tiff           DMG background with retina representation
 *
 * NSIS requires flattened BMP3 (no alpha) — PNGs are rendered with canvas, then
 * converted with ImageMagick. The DMG accepts PNG with @2x for retina.
 *
 * Re-run whenever the app icon or brand colors change.
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  unlinkSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const APP_ICON = join(ROOT, 'resources', 'icon.png')
const NSIS_SUPERSAMPLE = 4
const PNG_SUPERSAMPLE = 2

// Brand palette sampled from the app icon.
const TEAL_TOP = '#1a93b4'
const TEAL_BOTTOM = '#0c5f78'
const RIM = '#6edeea'
const INK = '#0c4b5e'

// SF Pro Rounded mirrors the logo's soft, glossy geometry; Arial is the fallback.
const DISPLAY = 'Display'
for (const [path, family] of [
  ['/System/Library/Fonts/SFNSRounded.ttf', DISPLAY],
  ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', DISPLAY]
]) {
  if (existsSync(path)) {
    GlobalFonts.registerFromPath(path, family)
    break
  }
}

function verticalGradient(ctx, w, h, top, bottom) {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, top)
  g.addColorStop(1, bottom)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

function createArtwork(width, height, supersample) {
  const canvas = createCanvas(width * supersample, height * supersample)
  const ctx = canvas.getContext('2d')
  ctx.scale(supersample, supersample)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return { canvas, ctx }
}

/** Draws the app icon with a soft lift so it reads on installer backgrounds. */
function drawAppIcon(ctx, icon, cx, cy, size) {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.24)'
  ctx.shadowBlur = size * 0.08
  ctx.shadowOffsetY = size * 0.035
  ctx.drawImage(icon, cx - size / 2, cy - size / 2, size, size)
  ctx.restore()
}

async function buildSidebar(icon, { uninstall }) {
  const w = 164
  const h = 314
  const { canvas, ctx } = createArtwork(w, h, NSIS_SUPERSAMPLE)

  verticalGradient(ctx, w, h, uninstall ? '#155d72' : TEAL_TOP, uninstall ? '#093b4a' : TEAL_BOTTOM)

  // Faint rim highlight echoing the logo's glossy edge.
  ctx.strokeStyle = 'rgba(110,222,234,0.35)'
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, w - 2, h - 2)

  drawAppIcon(ctx, icon, w / 2, 92, 116)

  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 30px ${DISPLAY}`
  ctx.fillText('Ordicab', w / 2, 188)

  ctx.fillStyle = RIM
  ctx.font = `500 12px ${DISPLAY}`
  ctx.fillText(uninstall ? 'Désinstallation' : 'Installation', w / 2, 210)

  return canvas
}

async function buildHeader(icon) {
  // Inner-page header: white band, app icon left, wordmark after it.
  const w = 150
  const h = 57
  const { canvas, ctx } = createArtwork(w, h, NSIS_SUPERSAMPLE)

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)

  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = INK
  ctx.font = `600 20px ${DISPLAY}`
  ctx.fillText('Ordicab', 58, h / 2 + 1)

  drawAppIcon(ctx, icon, 30, h / 2, 40)
  return canvas
}

async function buildDmgBackground(scale) {
  const w = 540 * scale
  const h = 460 * scale
  const { canvas, ctx } = createArtwork(w, h, PNG_SUPERSAMPLE)

  // Soft teal-tinted backdrop so the dropped app icon stays legible.
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#eef9fb')
  g.addColorStop(1, '#d4eef3')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  ctx.textAlign = 'center'
  ctx.fillStyle = INK
  ctx.font = `600 ${26 * scale}px ${DISPLAY}`
  ctx.fillText('Installer Ordicab', w / 2, 144 * scale)

  ctx.fillStyle = '#3a7a8c'
  ctx.font = `500 ${13 * scale}px ${DISPLAY}`
  ctx.fillText("Glissez l'icône Ordicab sur le dossier Applications", w / 2, 172 * scale)

  // Arrow from the app icon (left) to the Applications drop target (right).
  // Icon centers sit at y≈310 to match dmg.contents in electron-builder config.
  const y = 298 * scale
  ctx.strokeStyle = RIM
  ctx.fillStyle = RIM
  ctx.lineWidth = 6 * scale
  ctx.lineCap = 'round'
  const x1 = 232 * scale
  const x2 = 308 * scale
  ctx.beginPath()
  ctx.moveTo(x1, y)
  ctx.lineTo(x2, y)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x2, y)
  ctx.lineTo(x2 - 14 * scale, y - 10 * scale)
  ctx.lineTo(x2 - 14 * scale, y + 10 * scale)
  ctx.closePath()
  ctx.fill()

  return canvas
}

function writeDmgTiff(oneXPath, twoXPath, outPath) {
  execFileSync('tiffutil', ['-cathidpicheck', oneXPath, twoXPath, '-out', outPath])
}

function resizePng(inPath, outPath, width, height) {
  execFileSync('magick', [
    inPath,
    '-filter',
    'Lanczos',
    '-resize',
    `${width}x${height}!`,
    '-strip',
    `PNG32:${outPath}`
  ])
}

function writePng(canvas, outPath, width, height) {
  const highResPath = `${outPath}.hires.png`
  writeFileSync(highResPath, canvas.toBuffer('image/png'))
  resizePng(highResPath, outPath, width, height)
  unlinkSync(highResPath)
}

function writeBuildPngIcon(sourcePath, outPath) {
  resizePng(sourcePath, outPath, 512, 512)
}

function writeIco(sourcePath, outPath) {
  execFileSync('magick', [
    sourcePath,
    '-filter',
    'Lanczos',
    '-define',
    'icon:auto-resize=256,128,64,48,32,16',
    outPath
  ])
}

function writeIcns(sourcePath, outPath) {
  const iconsetParent = mkdtempSync(join(tmpdir(), 'ordicab-iconset-'))
  const iconset = join(iconsetParent, 'Ordicab.iconset')
  mkdirSync(iconset)
  try {
    for (const [name, size] of [
      ['icon_16x16.png', 16],
      ['icon_16x16@2x.png', 32],
      ['icon_32x32.png', 32],
      ['icon_32x32@2x.png', 64],
      ['icon_128x128.png', 128],
      ['icon_128x128@2x.png', 256],
      ['icon_256x256.png', 256],
      ['icon_256x256@2x.png', 512],
      ['icon_512x512.png', 512],
      ['icon_512x512@2x.png', 1024]
    ]) {
      resizePng(sourcePath, join(iconset, name), size, size)
    }
    const chunks = [
      ['ic04', 'icon_16x16.png'],
      ['ic05', 'icon_32x32.png'],
      ['ic11', 'icon_16x16@2x.png'],
      ['ic12', 'icon_32x32@2x.png'],
      ['ic07', 'icon_128x128.png'],
      ['ic13', 'icon_128x128@2x.png'],
      ['ic08', 'icon_256x256.png'],
      ['ic14', 'icon_256x256@2x.png'],
      ['ic09', 'icon_512x512.png'],
      ['ic10', 'icon_512x512@2x.png']
    ].map(([type, file]) => {
      const data = readFileSync(join(iconset, file))
      const header = Buffer.alloc(8)
      header.write(type, 0, 'ascii')
      header.writeUInt32BE(data.length + 8, 4)
      return Buffer.concat([header, data])
    })
    const totalSize = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const header = Buffer.alloc(8)
    header.write('icns', 0, 'ascii')
    header.writeUInt32BE(totalSize, 4)
    writeFileSync(outPath, Buffer.concat([header, ...chunks], totalSize))
  } finally {
    rmSync(iconsetParent, { recursive: true, force: true })
  }
}

function pngToBmp3(pngPath, bmpPath, bg) {
  // NSIS needs a flattened 24-bit BMP (BMP3, no alpha channel).
  execFileSync('magick', [
    pngPath,
    '-background',
    bg,
    '-flatten',
    '-alpha',
    'off',
    `BMP3:${bmpPath}`
  ])
}

async function main() {
  const icon = await loadImage(APP_ICON)
  const buildDir = join(ROOT, 'build')
  const tmp = (name) => join(buildDir, name)

  writeBuildPngIcon(APP_ICON, tmp('icon.png'))
  console.log('✓', 'build/icon.png')
  writeIco(APP_ICON, tmp('icon.ico'))
  console.log('✓', 'build/icon.ico')
  writeIcns(APP_ICON, tmp('icon.icns'))
  console.log('✓', 'build/icon.icns')

  // Sidebars + header → PNG then BMP3.
  const jobs = [
    {
      canvas: await buildSidebar(icon, { uninstall: false }),
      png: tmp('installerSidebar.png'),
      bmp: tmp('installerSidebar.bmp'),
      width: 164,
      height: 314,
      bg: TEAL_BOTTOM
    },
    {
      canvas: await buildSidebar(icon, { uninstall: true }),
      png: tmp('uninstallerSidebar.png'),
      bmp: tmp('uninstallerSidebar.bmp'),
      width: 164,
      height: 314,
      bg: '#093b4a'
    },
    {
      canvas: await buildHeader(icon),
      png: tmp('installerHeader.png'),
      bmp: tmp('installerHeader.bmp'),
      width: 150,
      height: 57,
      bg: '#ffffff'
    }
  ]
  for (const job of jobs) {
    writePng(job.canvas, job.png, job.width, job.height)
    pngToBmp3(job.png, job.bmp, job.bg)
    unlinkSync(job.png) // keep only the BMP electron-builder consumes
    console.log('✓', job.bmp.replace(ROOT + '/', ''))
  }

  // DMG background → PNG @1x and @2x.
  for (const scale of [1, 2]) {
    const canvas = await buildDmgBackground(scale)
    const out = tmp(scale === 1 ? 'background.png' : 'background@2x.png')
    writePng(canvas, out, 540 * scale, 460 * scale)
    console.log('✓', out.replace(ROOT + '/', ''))
  }
  writeDmgTiff(tmp('background.png'), tmp('background@2x.png'), tmp('background.tiff'))
  console.log('✓', 'build/background.tiff')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
