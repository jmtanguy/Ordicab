/// <reference types="vite/client" />

import type { OrdicabAPI } from '../shared/types'

declare global {
  interface Window {
    ordicabAPI: OrdicabAPI
  }
}

export {}
