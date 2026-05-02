export interface TemplateRecord {
  id: string
  name: string
  description?: string
  content?: string
  tags?: string[]
  macros: string[]
  hasDocxSource: boolean
  updatedAt: string
}

export interface TemplateDraft {
  name: string
  content: string
  description?: string
  tags?: string[]
}

export interface TemplateUpdate extends TemplateDraft {
  id: string
}

export interface TemplateDeleteInput {
  id: string
}

export interface TemplateDocxInput {
  id: string
  pickToken?: string
}
