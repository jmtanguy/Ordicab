interface ParsedAddress {
  addressLine: string
  addressLine2: string
  zipCode: string
  city: string
  addressFormatted: string
  addressInline: string
}

const EMPTY_PARSED_ADDRESS: ParsedAddress = {
  addressLine: '',
  addressLine2: '',
  zipCode: '',
  city: '',
  addressFormatted: '',
  addressInline: ''
}

function joinNonEmpty(parts: Array<string | undefined>, separator: string): string {
  return parts.filter(Boolean).join(separator)
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
    return { ...EMPTY_PARSED_ADDRESS }
  }

  const lines = splitAddress(raw)
  const zipCityLineIdx = lines.findIndex((line) => /\b\d{5}\b/.test(line))

  if (zipCityLineIdx === -1) {
    const normalizedInline = joinNonEmpty(lines, ', ')
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
  const addressLine2 = joinNonEmpty(addressLines.slice(1), ', ')
  const combinedAddressLine = joinNonEmpty([addressLine, addressLine2], ', ')
  const zipCity = joinNonEmpty([zipCode, city], ' ').trim()

  return {
    addressLine,
    addressLine2,
    zipCode,
    city,
    addressFormatted: joinNonEmpty([combinedAddressLine, zipCity], '\n'),
    addressInline: joinNonEmpty([combinedAddressLine, zipCity], ', ')
  }
}

export function buildAddressFields(contact: {
  addressLine?: string
  addressLine2?: string
  zipCode?: string
  city?: string
  country?: string
}): { addressFormatted: string; addressInline: string } {
  const combinedAddressLine = joinNonEmpty([contact.addressLine, contact.addressLine2], ', ')
  const zipCity = joinNonEmpty([contact.zipCode, contact.city, contact.country], ' ')
  return {
    addressFormatted: joinNonEmpty([combinedAddressLine, zipCity], '\n'),
    addressInline: joinNonEmpty([combinedAddressLine, zipCity], ', ')
  }
}
