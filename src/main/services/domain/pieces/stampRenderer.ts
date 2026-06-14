/**
 * Lawyer stamp rendering for pièces cotées.
 *
 * Two halves:
 *  - renderGeneratedStampPng: when no stamp image was imported, draws a
 *    believable round cachet (double circle, firm name on the top arc,
 *    "Avocat au Barreau de X" on the bottom arc) once per generation run.
 *  - applyStampToFirstPage: overlays the stamp PNG on a pièce's first page
 *    with a white backing disc and the pièce number centered in the stamp
 *    (RIN art. 5.5: pièces communiquées must be numbered and bear the
 *    lawyer's cachet), plus a "Pièce n°X" caption.
 */
import type { PDFDocument as PdfLibDocument, PDFFont, PDFImage } from 'pdf-lib'

import type { EntityProfile, PieceStampPosition } from '@shared/types'

// Stamp footprint on the page, in PDF points (~30 mm).
const STAMP_SIZE_PT = 85
const STAMP_MARGIN_PT = 18
const CAPTION_GAP_PT = 4
const CAPTION_SIZE_PT = 9

/** Render size of the generated stamp PNG (rasterized once, reused per page). */
const GENERATED_STAMP_PX = 600

const STAMP_INK = '#1d3a8f'

type StampContext = import('@napi-rs/canvas').SKRSContext2D

function stampFont(size: number, weight: number): string {
  return `${weight} ${size}px "Helvetica Neue", Arial, sans-serif`
}

/** Total angle (radians) the text occupies at the given radius, tracking included. */
function measureArcSpan(ctx: StampContext, text: string, radius: number, tracking: number): number {
  const characters = [...text]
  const width = characters.reduce((sum, character) => sum + ctx.measureText(character).width, 0)
  return (width + tracking * Math.max(characters.length - 1, 0)) / radius
}

/**
 * Draws text along a circle, characters spaced by their real width (not spread
 * over a fixed span — that distorts short/long strings alike). `position`
 * selects upright-on-top vs hanging-under-bottom rendering; both read left to
 * right.
 */
function arcTextCentered(
  ctx: StampContext,
  text: string,
  centerX: number,
  centerY: number,
  radius: number,
  tracking: number,
  position: 'top' | 'bottom'
): void {
  const characters = [...text]
  if (characters.length === 0) return
  const totalSpan = measureArcSpan(ctx, text, radius, tracking)
  const anchorAngle = position === 'top' ? -Math.PI / 2 : Math.PI / 2
  const direction = position === 'top' ? 1 : -1

  let angle = anchorAngle - (direction * totalSpan) / 2
  for (const character of characters) {
    const charSpan = (ctx.measureText(character).width + tracking) / radius
    const charAngle = angle + (direction * charSpan) / 2
    ctx.save()
    ctx.translate(centerX + radius * Math.cos(charAngle), centerY + radius * Math.sin(charAngle))
    ctx.rotate(charAngle + (position === 'top' ? Math.PI / 2 : -Math.PI / 2))
    ctx.fillText(character, 0, 0)
    ctx.restore()
    angle += direction * charSpan
  }
}

/** Largest font size (>= 14) whose arc span stays within maxSpan radians. */
function fitArcFontSize(
  ctx: StampContext,
  text: string,
  weight: number,
  maxSize: number,
  radius: number,
  maxSpan: number
): number {
  for (let size = maxSize; size > 14; size -= 2) {
    ctx.font = stampFont(size, weight)
    if (measureArcSpan(ctx, text, radius, size * 0.12) <= maxSpan) {
      return size
    }
  }
  return 14
}

/** Identity lines used both by the generated stamp and the bordereau footer. */
export function stampOwnerLines(profile: EntityProfile | null): {
  name: string
  subtitle: string
} {
  const personal = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim()
  const name = (personal ? `Me ${personal}` : (profile?.firmName ?? '')).trim() || 'Avocat'
  const barreau = profile?.barreau?.trim()
  const toque = profile?.toque?.trim()
  const subtitle = [
    barreau ? `Avocat au Barreau de ${barreau}` : 'Avocat',
    toque ? `Toque ${toque}` : ''
  ]
    .filter(Boolean)
    .join(' — ')
  return { name, subtitle }
}

export async function renderGeneratedStampPng(profile: EntityProfile | null): Promise<Uint8Array> {
  const { createCanvas } = await import('@napi-rs/canvas')
  const size = GENERATED_STAMP_PX
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  const center = size / 2

  // Double border with a wide text band between the two circles.
  const outerRadius = center - 8
  const innerRadius = outerRadius - 88
  const textRadius = (outerRadius + innerRadius) / 2

  ctx.strokeStyle = STAMP_INK
  ctx.fillStyle = STAMP_INK
  ctx.lineWidth = 10
  ctx.beginPath()
  ctx.arc(center, center, outerRadius, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(center, center, innerRadius, 0, Math.PI * 2)
  ctx.stroke()

  const { name, subtitle } = stampOwnerLines(profile)
  const topText = name.toUpperCase()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Name along the top arc, subtitle hanging along the bottom arc; both sized
  // so they never invade the opposite half of the ring.
  const topMaxSpan = Math.PI * 1.05
  const topSize = fitArcFontSize(ctx, topText, 600, 46, textRadius, topMaxSpan)
  ctx.font = stampFont(topSize, 600)
  arcTextCentered(ctx, topText, center, center, textRadius, topSize * 0.12, 'top')
  const topSpan = measureArcSpan(ctx, topText, textRadius, topSize * 0.12)

  const bottomMaxSpan = Math.PI * 1.05
  const bottomSize = fitArcFontSize(ctx, subtitle, 500, 34, textRadius, bottomMaxSpan)
  ctx.font = stampFont(bottomSize, 500)
  arcTextCentered(ctx, subtitle, center, center, textRadius, bottomSize * 0.12, 'bottom')
  const bottomSpan = measureArcSpan(ctx, subtitle, textRadius, bottomSize * 0.12)

  // Separator stars at 3 and 9 o'clock when both arcs leave the sides free.
  if (topSpan / 2 < Math.PI / 2 - 0.18 && bottomSpan / 2 < Math.PI / 2 - 0.18) {
    ctx.font = stampFont(26, 500)
    for (const angle of [Math.PI, 0]) {
      ctx.fillText(
        '★',
        center + textRadius * Math.cos(angle),
        center + textRadius * Math.sin(angle)
      )
    }
  }

  return canvas.encode('png')
}

/**
 * The number drawn in the stamp uses WinAnsi-encoded Helvetica; sanitize any
 * character that encoding cannot represent (the caption text itself is ASCII
 * plus "°", which WinAnsi covers).
 */
function sanitizeWinAnsi(text: string, font: PDFFont): string {
  return [...text]
    .map((character) => {
      try {
        font.widthOfTextAtSize(character, 10)
        return character
      } catch {
        return '?'
      }
    })
    .join('')
}

export interface ApplyStampOptions {
  pieceNumber: number
  position: PieceStampPosition
}

export interface StampAssets {
  image: PDFImage
  font: PDFFont
}

/** Embed the stamp PNG and bold font once per output document. */
export async function embedStampAssets(
  pdfDoc: PdfLibDocument,
  stampPng: Uint8Array
): Promise<StampAssets> {
  const { StandardFonts } = await import('pdf-lib')
  return {
    image: await pdfDoc.embedPng(stampPng),
    font: await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  }
}

export async function applyStampToFirstPage(
  pdfDoc: PdfLibDocument,
  assets: StampAssets,
  options: ApplyStampOptions
): Promise<void> {
  const { rgb } = await import('pdf-lib')
  const page = pdfDoc.getPage(0)
  const { width: pageWidth, height: pageHeight } = page.getSize()

  const size = STAMP_SIZE_PT
  const x = options.position.endsWith('left') ? STAMP_MARGIN_PT : pageWidth - STAMP_MARGIN_PT - size
  const y = options.position.startsWith('top')
    ? pageHeight - STAMP_MARGIN_PT - size
    : STAMP_MARGIN_PT + CAPTION_SIZE_PT + CAPTION_GAP_PT
  const centerX = x + size / 2
  const centerY = y + size / 2

  // White backing disc keeps the stamp legible on dark scans, semi-opaque so
  // the underlying document remains visible (no information is hidden).
  page.drawEllipse({
    x: centerX,
    y: centerY,
    xScale: size / 2,
    yScale: size / 2,
    color: rgb(1, 1, 1),
    opacity: 0.78
  })

  page.drawImage(assets.image, { x, y, width: size, height: size })

  // Pièce number centered in the stamp, over a small solid white disc so it
  // stays readable whatever the imported stamp looks like.
  const numberText = sanitizeWinAnsi(`${options.pieceNumber}`, assets.font)
  const numberSize = numberText.length > 3 ? 20 : 26
  const numberWidth = assets.font.widthOfTextAtSize(numberText, numberSize)
  page.drawEllipse({
    x: centerX,
    y: centerY,
    xScale: Math.max(numberWidth / 2 + 6, 16),
    yScale: numberSize / 2 + 5,
    color: rgb(1, 1, 1),
    opacity: 0.92
  })
  page.drawText(numberText, {
    x: centerX - numberWidth / 2,
    y: centerY - numberSize * 0.36,
    size: numberSize,
    font: assets.font,
    color: rgb(0.11, 0.23, 0.56)
  })

  // Caption under (or above) the stamp.
  const caption = sanitizeWinAnsi(`Pièce n°${options.pieceNumber}`, assets.font)
  const captionWidth = assets.font.widthOfTextAtSize(caption, CAPTION_SIZE_PT)
  const captionY = options.position.startsWith('top')
    ? y - CAPTION_GAP_PT - CAPTION_SIZE_PT
    : y + size + CAPTION_GAP_PT
  page.drawText(caption, {
    x: Math.min(Math.max(centerX - captionWidth / 2, 4), pageWidth - captionWidth - 4),
    y: captionY,
    size: CAPTION_SIZE_PT,
    font: assets.font,
    color: rgb(0.11, 0.23, 0.56)
  })
}
