export interface ParsedAddress {
  addressLine: string
  addressLine2: string
  zipCode: string
  city: string
  addressFormatted: string
  addressInline: string
}

function splitAddress(raw: string): string[] {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/,/g, '\n')
    .split('\n')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

export function parseAddress(raw: string | undefined): ParsedAddress {
  if (!raw) {
    return {
      addressLine: '',
      addressLine2: '',
      zipCode: '',
      city: '',
      addressFormatted: '',
      addressInline: ''
    }
  }

  const lines = splitAddress(raw)
  const zipCityLineIdx = lines.findIndex((line) => /\b\d{5}\b/.test(line))

  if (zipCityLineIdx === -1) {
    const normalizedInline = lines.join(', ')
    return {
      addressLine: raw,
      addressLine2: '',
      zipCode: '',
      city: '',
      addressFormatted: raw,
      addressInline: normalizedInline || raw
    }
  }

  const zipCityLine = lines[zipCityLineIdx] ?? ''
  const zipCode = zipCityLine.match(/\b(\d{5})\b/)?.[1] ?? ''
  const city = zipCityLine.replace(/\b\d{5}\b/, '').trim()
  const addressLines = lines.filter((_, index) => index !== zipCityLineIdx)
  const addressLine = addressLines[0] ?? ''
  const addressLine2 = addressLines.slice(1).join(', ')
  const combinedAddressLine = [addressLine, addressLine2].filter(Boolean).join(', ')
  const zipCity = [zipCode, city].filter(Boolean).join(' ').trim()

  return {
    addressLine,
    addressLine2,
    zipCode,
    city,
    addressFormatted: [combinedAddressLine, zipCity].filter(Boolean).join('\n'),
    addressInline: [combinedAddressLine, zipCity].filter(Boolean).join(', ')
  }
}

export function formatAddressForDisplay(
  raw: string | undefined,
  mode: 'inline' | 'multiline' = 'multiline'
): string {
  const parsed = parseAddress(raw)
  return mode === 'inline' ? parsed.addressInline : parsed.addressFormatted
}

export function buildAddressFields(contact: {
  addressLine?: string
  addressLine2?: string
  zipCode?: string
  city?: string
  country?: string
}): { addressFormatted: string; addressInline: string } {
  const combinedAddressLine = [contact.addressLine, contact.addressLine2].filter(Boolean).join(', ')
  const zipCity = [contact.zipCode, contact.city, contact.country].filter(Boolean).join(' ')
  const parts = [combinedAddressLine, zipCity].filter(Boolean)
  return {
    addressFormatted: parts.join('\n'),
    addressInline: parts.join(', ')
  }
}
