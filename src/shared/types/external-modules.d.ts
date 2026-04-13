declare module 'mammoth' {
  interface ConversionResult {
    value: string
    messages: unknown[]
  }
  interface ConvertOptions {
    buffer?: Buffer
    path?: string
  }
  export function convertToHtml(options: ConvertOptions): Promise<ConversionResult>
}

declare module 'word-extractor' {
  export interface ExtractedWordDocument {
    getBody(): string
  }

  export default class WordExtractor {
    extract(input: string | Buffer): Promise<ExtractedWordDocument>
  }
}

declare module 'mailparser' {
  export interface AddressObject {
    text?: string
  }

  export interface MailAttachment {
    filename?: string | null
  }

  export interface ParsedMail {
    subject?: string | null
    text?: string | null
    from?: AddressObject | null
    to?: AddressObject | null
    cc?: AddressObject | null
    date?: Date | null
    attachments?: MailAttachment[]
  }

  export function simpleParser(input: Buffer | string): Promise<ParsedMail>
}

declare module 'utif' {
  export interface TiffImageDirectory {
    width?: number
    height?: number
    data?: Uint8Array
  }

  export function decode(buffer: ArrayBuffer): TiffImageDirectory[]
  export function decodeImage(buffer: ArrayBuffer, ifd: TiffImageDirectory): void
  export function toRGBA8(ifd: TiffImageDirectory): Uint8Array
}
