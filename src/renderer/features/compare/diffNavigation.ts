export function blockElementId(blockIndex: number): string {
  return `compare-block-${blockIndex}`
}

export function scrollToBlock(blockIndex: number): void {
  document
    .getElementById(blockElementId(blockIndex))
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
