import { labelToKey } from './templateContent'

export { getRolePresets } from './professionDefaults'

export function roleToTagKey(role: string): string {
  return labelToKey(role) || 'contact'
}
