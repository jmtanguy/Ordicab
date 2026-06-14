import { labelToKey } from './templateContent'

export function roleToTagKey(role: string): string {
  return labelToKey(role) || 'contact'
}
