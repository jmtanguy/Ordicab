export interface GenerateDocumentInput {
  dossierId: string
  templateId: string
  primaryContactId?: string
  contactRoleOverrides?: Record<string, string>
  tagOverrides?: Record<string, string>
  outputPath?: string
  filename?: string
  description?: string
  tags?: string[]
}

export interface GeneratePreviewInput extends GenerateDocumentInput {}

export interface SaveGeneratedDocumentInput {
  dossierId: string
  filename: string
  format: 'txt' | 'docx'
  html: string
  outputPath?: string
}

export interface SelectOutputPathInput {
  defaultFilename?: string
}
