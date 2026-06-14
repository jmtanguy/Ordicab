import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  { files: ['**/*.{ts,tsx}'], extends: [tseslint.configs.recommended] },
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    // Garde-fou anti-footgun « id vs uuid » sur le code de production (hors tests :
    // les fixtures de test construisent librement des entités complètes).
    files: ['**/*.{ts,tsx}'],
    ignores: ['**/__tests__/**', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // Cible les payloads de mutation du domaine : un objet qui porte `dossierId`
          // et une clé `id` MAIS PAS de clé `uuid` est presque toujours le footgun
          // « id au lieu de uuid » — la clé `id` est silencieusement strippée par le
          // schéma Zod d'upsert → `uuid` reste undefined → randomUUID() côté service →
          // doublon au lieu de mise à jour. Les entités/DTO complètes (qui portent à la
          // fois `id` et `uuid`) sont exclues : ce ne sont pas des payloads d'upsert.
          selector:
            "ObjectExpression:has(> Property[key.name='dossierId']):not(:has(> Property[key.name='uuid'])) > Property[key.name='id'][computed=false]",
          message:
            "Payload de mutation du domaine : utilisez la clé `uuid:` (et non `id:`). Une clé `id` est strippée par les schémas d'upsert et provoque des doublons au lieu d'une mise à jour."
        }
      ]
    }
  },
  eslintConfigPrettier
)
