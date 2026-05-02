import { labelToKey } from './templateContent'

export type { EntityProfession } from './professionDefaults'
export { getRolePresets } from './professionDefaults'

export function roleToTagKey(role: string): string {
  return labelToKey(role) || 'contact'
}
