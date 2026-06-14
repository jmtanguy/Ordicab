/** Mirror of PIECE_SUPPORTED_EXTENSIONS in the main process (pieceSourceToPdf). */
const SUPPORTED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'docx']

export function isPieceSourceSupported(filename: string): boolean {
  const extension = filename.split('.').pop()?.toLowerCase() ?? ''
  return SUPPORTED_EXTENSIONS.includes(extension)
}

export function isDocxFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith('.docx')
}

export function filenameWithoutExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.')
  return dotIndex > 0 ? filename.slice(0, dotIndex) : filename
}
