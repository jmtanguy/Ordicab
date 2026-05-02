# ARCHITECTURE — Ordicab

> Technical constitution of the project. Every line of code written here —
> human or assisted (Claude Code, Copilot, Cursor…) — must conform to it.
> The rules are intentionally few: if a situation isn't covered, we decide
> it in code review.
>
> Stack: Electron 39 · electron-vite 5 · TypeScript 5.9 · React 19 ·
> Tailwind 4 · Zustand 5 + Immer · Zod 4 · Vitest 3.

---

## 1. Founding principles

1. **Four strictly separated Electron layers**
   - `src/main/` — Node.js process (filesystem, AI, IPC handlers).
   - `src/preload/` — secure `contextBridge` bridge, **no** business logic.
   - `src/renderer/` — React UI, **no** direct Node access.
   - `src/shared/` — shared types and constants, **zero** runtime
     dependency on Electron, React or Node.

2. **Three roles on the `main/` side**

   ```text
   IPC handler  →  service  →  shared/domain (DTO)
       │              │
       │              └─ orchestrates business logic AND persistence
       │                 (reading/writing JSON files)
       └─ validates input (Zod), calls the service, maps the error
   ```

   The filesystem is the database. **No separate "repository" layer**:
   extracting a repo that just does `readFile + JSON.parse` doesn't pay
   off. If one day a service becomes too heavy because of storage, we
   split that specific service, not as a matter of principle.

3. **One responsibility per file**
   - One file = one main export. File name = export name.
   - No barrel `index.ts` re-exporting 30 files, except
     `src/shared/types/` and `src/shared/contracts/` (typed facade by
     design).

4. **Dependency inversion via interface**
   - Every service consumed by another is typed by its **interface**,
     not by its factory. Pattern: `export interface XxxService { … }`
     then `export function createXxxService(opts): XxxService`.
   - Handlers receive the interface; tests inject a conforming mock.

5. **No business logic in IPC handlers or UI components**
   - A handler validates, delegates, maps the error. Nothing else.
   - A component renders JSX and calls store actions. It **never**
     invokes `window.ordicabAPI` directly.

---

## 2. File tree

```text
src/
├── main/                         # Node.js process
│   ├── index.ts                  # Electron bootstrap + composition root
│   ├── bootstrap.ts              # Startup orchestration (testable)
│   ├── window.ts, updater.ts
│   ├── handlers/                 # IPC: register*Handlers({ ipcMain, services })
│   ├── services/
│   │   ├── domain/               # Business services (factory + interface)
│   │   ├── aiEmbedded/           # Local AI (Ollama, transformers, OCR)
│   │   └── aiDelegated/
│   └── lib/                      # Cross-cutting technical modules
│       ├── ordicab/              # Path conventions, file watchers
│       ├── system/               # atomicWrite, credentialStore, state
│       ├── aiEmbedded/, aiDelegated/, i18n/
│
├── preload/
│   ├── index.ts                  # contextBridge.exposeInMainWorld('ordicabAPI', …)
│   └── api.ts                    # Typed construction of OrdicabAPI (no Electron imports)
│
├── renderer/
│   ├── components/{shell, ui}    # ui/ = wrapped Radix primitives
│   ├── features/                 # One feature = one self-contained folder
│   ├── stores/                   # Zustand + Immer
│   │   └── ipc.ts                # getOrdicabApi() + "no IPC in components" rule
│   ├── contexts/, i18n/, lib/, schemas/ (cf. §6)
│
└── shared/
    ├── contracts/                # IPC_CHANNELS, OrdicabAPI
    ├── types/                    # IpcResult, IpcErrorCode, technical types
    ├── domain/                   # Business types (flat interfaces = DTOs)
    └── validation/               # Zod schemas (target: all here, cf. §6)
```

### Canonical examples per layer

- **Service**: [src/main/services/domain/dossierRegistryService.ts](src/main/services/domain/dossierRegistryService.ts)
- **IPC handler**: [src/main/handlers/dossierHandler.ts](src/main/handlers/dossierHandler.ts)
- **Preload bridge**: [src/preload/api.ts](src/preload/api.ts)
- **Zustand store**: [src/renderer/stores/documentStore.ts](src/renderer/stores/documentStore.ts)
- **IPC contract**: [src/shared/contracts/channels.ts](src/shared/contracts/channels.ts) + [src/shared/types/ipc.ts](src/shared/types/ipc.ts)
- **Domain DTO**: [src/shared/domain/dossier.ts](src/shared/domain/dossier.ts)

---

## 3. Naming conventions

| Suffix        | Layer                | Example                     |
| ------------- | -------------------- | --------------------------- |
| `*Service.ts` | `main/services/*`    | `dossierRegistryService.ts` |
| `*Handler.ts` | `main/handlers/`     | `dossierHandler.ts`         |
| `*Store.ts`   | `renderer/stores/`   | `documentStore.ts`          |
| `*Error`      | service error class  | `DossierRegistryError`      |

- **PascalCase**: classes, interfaces, types, **React components**
  (`*.tsx`).
- **camelCase**: functions, variables, `.ts` files (main, preload,
  shared, renderer stores).
- **No `I` prefix** on interfaces (`UserRepository`, not
  `IUserRepository`).
- **IPC channels**: format `'<domain>:<action>'` (e.g.: `'dossier:get'`),
  centralized in
  [src/shared/contracts/channels.ts](src/shared/contracts/channels.ts).
  No hardcoded channel string anywhere else.

---

## 4. Import rules

| Layer                 | May import                                                            | May NOT import                                         |
| --------------------- | --------------------------------------------------------------------- | ------------------------------------------------------ |
| `shared/*`            | other `shared/` modules, pure external libs (`zod`)                   | `main/`, `preload/`, `renderer/`, `electron`           |
| `main/services/*`     | `shared/*`, `main/services/*` (by interface), `main/lib/*`            | `main/handlers/*`, `electron` (`safeStorage` excepted) |
| `main/handlers/*`     | `shared/*`, `main/services/*` (interfaces), `electron` (`ipcMain`)    | `main/lib/*` directly (go through a service)           |
| `main/index.ts`       | all of `main/*`, `electron`                                           | `renderer/*`                                           |
| `preload/api.ts`      | `shared/*`                                                            | `electron`, `main/*`, `renderer/*`                     |
| `preload/index.ts`    | `electron`, `preload/api.ts`                                          | `main/*`, `renderer/*`                                 |
| `renderer/stores/*`   | `shared/*`, `renderer/lib`                                            | `main/*`, `preload/*`, `electron`                      |
| `renderer/components` | `renderer/{stores, lib, contexts}`, `shared/types` (read-only)        | `main/*`, `preload/*`, `electron`, direct IPC          |
| `renderer/features/*` | `renderer/{components, stores, lib, contexts}`, `shared/*`            | `main/*`, `preload/*`                                  |

### Existing guardrails

- **No `@main/` alias** in the `tsconfig`s: the renderer cannot
  technically import from `src/main/`.
- **No IPC in components**: rule encoded by
  [STORE_IPC_RULE in src/renderer/stores/ipc.ts](src/renderer/stores/ipc.ts)
  and verified by a test (`src/renderer/__tests__/no-direct-ipc.test.ts`).

### Acknowledged debt

Several files in `src/main/` import Zod schemas from
`@renderer/schemas` (e.g.:
[src/main/handlers/dossierHandler.ts:15-28](src/main/handlers/dossierHandler.ts#L15-L28)).
**Target**: progressively move these schemas to
`src/shared/validation/` (cf. §6). Tolerated as long as the migration
is incomplete, but no new schema may be created in
`src/renderer/schemas/`.

---

## 5. Dependency injection

### Strategy

Manual composition root. **No framework container** (`tsyringe`,
`inversify`, etc.) — the project size doesn't warrant it.

### Current state and target

[src/main/index.ts](src/main/index.ts) (~1000 lines) currently includes
both the Electron bootstrap and the composition of every service.
**Target**: extract a `src/main/container.ts` that only creates the
services and wires the handlers.

```ts
// src/main/container.ts (target)
import { ipcMain, safeStorage, shell, dialog } from 'electron'

import { createDomainService, type DomainService } from './services/domain/domainService'
import { createDossierRegistryService, type DossierRegistryService } from './services/domain/dossierRegistryService'
import { createDocumentService, type DocumentService } from './services/domain/documentService'
import { createContactService, type ContactService } from './services/domain/contactService'
import { createTemplateService, type TemplateService } from './services/domain/templateService'
import { createGenerateService, type GenerateService } from './services/domain/generateService'

import { registerDossierHandlers } from './handlers/dossierHandler'
import { registerDocumentHandlers } from './handlers/documentHandler'
import { registerContactHandlers } from './handlers/contactHandler'
import { registerTemplateHandlers } from './handlers/templateHandler'
import { registerGenerateHandlers } from './handlers/generateHandler'

import { createCredentialStore } from './lib/system/credentialStore'

export interface AppContainer {
  domainService: DomainService
  dossierService: DossierRegistryService
  documentService: DocumentService
  contactService: ContactService
  templateService: TemplateService
  generateService: GenerateService
}

export interface BuildContainerOptions {
  stateFilePath: string
  tessDataPath: string
  modelsPath: string | null
}

export function buildContainer(opts: BuildContainerOptions): AppContainer {
  // Created in dependency order
  const domainService = createDomainService({
    stateFilePath: opts.stateFilePath,
    openDirectoryDialog: (o) => dialog.showOpenDialog(o)
  })

  const dossierService = createDossierRegistryService({
    stateFilePath: opts.stateFilePath,
    now: () => new Date()
  })

  const documentService = createDocumentService({
    stateFilePath: opts.stateFilePath,
    tessDataPath: opts.tessDataPath,
    embeddingConfig: opts.modelsPath ? { modelPath: opts.modelsPath } : undefined
  })

  const contactService = createContactService({ documentService })
  const templateService = createTemplateService({ domainService })
  const generateService = createGenerateService({ domainService, documentService })

  return {
    domainService, dossierService, documentService,
    contactService, templateService, generateService
  }
}

export function registerAllHandlers(container: AppContainer): void {
  registerDossierHandlers({ ipcMain, dossierService: container.dossierService })
  registerDocumentHandlers({
    ipcMain,
    documentService: container.documentService,
    openPath: (path) => shell.openPath(path)
  })
  registerContactHandlers({ ipcMain, documentService: container.documentService })
  registerTemplateHandlers({
    ipcMain,
    domainService: container.domainService,
    showOpenDialog: dialog.showOpenDialog,
    openPath: (path) => shell.openPath(path)
  })
  registerGenerateHandlers({ ipcMain, generateService: container.generateService })
}
```

### Rules

1. A service factory **does no I/O at call time**. It prepares the
   closures that will do the I/O when a method is invoked.
2. Every dependency goes through the `options` parameter. **No mutable
   module-level variables**, no hidden singletons.
3. `electron` is only imported in: `index.ts`, `container.ts`,
   `bootstrap.ts`, `window.ts`, `updater.ts`, the `*Handler.ts` files
   (for `ipcMain`), and `preload/index.ts`. Exception: `safeStorage` in
   `credentialStore`.

---

## 6. DTOs vs domain entities

### Convention

- **`src/shared/domain/*.ts`**: flat, serializable interfaces. These
  are business DTOs, traversable via IPC, JSON-stringifiable. No
  methods, no dynamic getters. See
  [src/shared/domain/dossier.ts](src/shared/domain/dossier.ts).
- **`src/shared/types/*.ts`**: technical DTOs (IPC, events, errors).

These types are consumed as-is by main, preload, renderer. This is the
single contract between processes.

### No domain classes, no mappers — unless necessary

- As long as a service only reads / writes JSON files whose shape
  matches the DTO, **no class** in `src/main/domain/` and no mapper.
- We will introduce a class the day a **business invariant** must be
  protected (e.g.: state transition with rules, non-trivial derived
  computation). Decision taken case by case, justified in the PR.
- When the entity ↔ DTO mapping becomes non-trivial, we create a
  `src/main/mappers/<entity>Mapper.ts`. Not before.

### Zod schemas: target `src/shared/validation/`

Today schemas live in `src/renderer/schemas/`. **Every new schema
goes in `src/shared/validation/`**; existing ones are migrated as
files are touched. main, renderer and tests consume them from the
same place, which guarantees the client never sends a payload the
server would reject.

---

## 7. Error handling

### Existing pattern — keep it

Each service exposes **its own error class** carrying an
`IpcErrorCode`:

```ts
// src/main/services/domain/dossierRegistryService.ts:68
export class DossierRegistryError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'DossierRegistryError'
  }
}
```

That's enough. **No abstract hierarchy** (`DomainError`,
`NotFoundError`, …) — overkill for 7 services.

### Error rules

1. **Forbidden**: bare `throw new Error('…')` in a service. Always a
   service error class (or similar), with an `IpcErrorCode`.
2. **Required**: every IPC handler has a
   `mapXxxError(error, fallback): IpcError` that catches
   `ZodError → VALIDATION_FAILED`, the service error → its code,
   and generic `Error` → `FILE_SYSTEM_ERROR` or another default code.
   Pattern:
   [src/main/handlers/dossierHandler.ts:42](src/main/handlers/dossierHandler.ts#L42).
3. **The IPC bridge never leaks an exception**: everything returns an
   `IpcResult<T>` ([src/shared/types/ipc.ts](src/shared/types/ipc.ts)) — a
   discriminated union `success: true|false`.

### Renderer side

```ts
const result = await api.document.list(query)
if (!result.success) {
  set((state) => { state.error = result.error })
  return
}
set((state) => { state.documents = result.data })
```

No `try/catch` around `result`: the discriminated union forces the
store to handle both branches.

---

## 8. Strict TypeScript configuration

To be materialized explicitly in
[tsconfig.json](tsconfig.json) and
[tsconfig.node.json](tsconfig.node.json) (currently inherited
implicitly from `@electron-toolkit/tsconfig`):

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

**Intentionally disabled**: `exactOptionalPropertyTypes` (massive
friction with optional React props, marginal gain).

### Additional rules

- `any` forbidden, except at the contact point of an untyped external
  lib. In that case: confined to an adapter function, commented
  `// reason: <lib> has no proper types for <api>`.
- `unknown` preferred for any incoming IPC payload
  (`async (_event, input: unknown) => …`), validated via Zod.
- No `as Foo` without a local type-guard
  (`function isFoo(x: unknown): x is Foo`).

---

## 9. Tests

### Tooling

- **Vitest 3** ([vitest.config.ts](vitest.config.ts)).
- Default environment: `node`. UI tests opt into `jsdom` locally via
  `// @vitest-environment jsdom`.
- `@testing-library/react` for components.
- Tests colocated in `__tests__/`. Naming: `<file>.test.ts(x)`.

### Minimum strategy per feature

No mandatory 6-category matrix. For a given feature, aim for at
minimum:

- **One service test** on the business logic (mocks via interface).
- **One handler test** on the `IpcResult` mapping (success + at least
  one typed error), via a hand-rolled ipcMain harness. Pattern:
  [src/main/handlers/\_\_tests\_\_/documentHandler.test.ts](src/main/handlers/__tests__/documentHandler.test.ts).
- **One store test** on state transitions (mock of
  `getOrdicabApi()`).

The rest (components, integration, e2e) on demand, depending on what
is fragile.

### Mocks

Prefer **injecting a mocked interface** (`{ method: vi.fn() } as
unknown as XxxService`) over `vi.mock()`. `vi.mock` stays OK for
external libs.

---

## 10. Code review checklist

Check before every PR. Reviewers (humans and Claude Code) are expected
to enforce these points.

- [ ] No forbidden cross-process import (table §4)
- [ ] No file in `renderer/` or `preload/` imports from `main/`
- [ ] No file in `shared/` imports from `main/`, `preload/` or `renderer/`
- [ ] No IPC call inside a React component (only inside a store action)
- [ ] Every external dependency of a service is passed via its `options`
- [ ] Every inter-service dependency is typed by **interface**, never by the factory
- [ ] No business logic in an IPC handler
- [ ] No bare `throw new Error('…')` in a service — use a service error class with an `IpcErrorCode`
- [ ] Every incoming IPC payload is validated via Zod before reaching the service
- [ ] No undocumented `any`; no `as Foo` without a type-guard
- [ ] No `utils.ts` / `helpers.ts` / `misc.ts` file created
- [ ] New IPC channel added? It is in `IPC_CHANNELS` and exposed in `OrdicabAPI`
- [ ] Every new Zod schema goes in `src/shared/validation/` (not `renderer/schemas/`)
- [ ] Tests in place for the relevant layer (service, handler, store)
- [ ] `npm run validate` passes (lint + typecheck + tests)

---

## 11. Canonical examples

### 11.1 — Shared DTO

[src/shared/domain/dossier.ts](src/shared/domain/dossier.ts) (existing
excerpt):

```ts
export const DOSSIER_STATUS_VALUES = ['active', 'pending', 'completed', 'archived'] as const
export type DossierStatus = (typeof DOSSIER_STATUS_VALUES)[number]

export interface KeyDate {
  id: string
  dossierId: string
  label: string
  date: string
  note?: string
}
```

Flat, serializable interface, no method.

### 11.2 — Service

```ts
// Canonical shape
import type { DossierDetail, DossierScopedQuery } from '@shared/types'
import { IpcErrorCode } from '@shared/types'

export interface DossierRegistryService {
  getDossier(input: DossierScopedQuery): Promise<DossierDetail>
}

export interface DossierRegistryServiceOptions {
  stateFilePath: string
  now?: () => Date
}

export class DossierRegistryError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'DossierRegistryError'
  }
}

export function createDossierRegistryService(
  options: DossierRegistryServiceOptions
): DossierRegistryService {
  const now = options.now ?? (() => new Date())

  return {
    async getDossier({ dossierId }) {
      // … reads / writes the JSON file, encapsulates the I/O
      // throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, '…') if needed
    }
  }
}
```

Reference in place:
[src/main/services/domain/dossierRegistryService.ts](src/main/services/domain/dossierRegistryService.ts).

### 11.3 — IPC handler

```ts
import { ZodError } from 'zod'
import {
  IPC_CHANNELS,
  IpcErrorCode,
  type DossierDetail,
  type IpcError,
  type IpcResult
} from '@shared/types'
import { dossierScopedQuerySchema } from '@shared/validation/dossier'
import {
  DossierRegistryError,
  type DossierRegistryService
} from '../services/domain/dossierRegistryService'

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (_event: unknown, input?: unknown) => Promise<unknown>
  ) => void
}

function mapDossierError(error: unknown, fallback: string): IpcError {
  if (error instanceof ZodError) {
    return { success: false, error: 'Invalid dossier input.', code: IpcErrorCode.VALIDATION_FAILED }
  }
  if (error instanceof DossierRegistryError) {
    return { success: false, error: error.message, code: error.code }
  }
  return {
    success: false,
    error: error instanceof Error ? error.message : fallback,
    code: IpcErrorCode.FILE_SYSTEM_ERROR
  }
}

export function registerDossierHandlers(options: {
  ipcMain: IpcMainLike
  dossierService: DossierRegistryService
}): void {
  options.ipcMain.handle(
    IPC_CHANNELS.dossier.get,
    async (_event, input): Promise<IpcResult<DossierDetail>> => {
      try {
        const parsed = dossierScopedQuerySchema.parse(input)
        return { success: true, data: await options.dossierService.getDossier(parsed) }
      } catch (error) {
        return mapDossierError(error, 'Unable to load dossier details.')
      }
    }
  )
}
```

Reference in place:
[src/main/handlers/dossierHandler.ts](src/main/handlers/dossierHandler.ts).

### 11.4 — Renderer store

```ts
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { DossierDetail, DossierScopedQuery } from '@shared/types'
import { getOrdicabApi, IPC_NOT_AVAILABLE_ERROR } from './ipc'

interface DossierStoreState {
  detail: DossierDetail | null
  isLoading: boolean
  error: string | null
}
interface DossierStoreActions {
  load: (query: DossierScopedQuery) => Promise<void>
}

export const useDossierStore = create<DossierStoreState & DossierStoreActions>()(
  immer((set) => ({
    detail: null,
    isLoading: false,
    error: null,
    load: async (query) => {
      const api = getOrdicabApi()
      if (!api) {
        set((s) => { s.error = IPC_NOT_AVAILABLE_ERROR })
        return
      }
      set((s) => { s.isLoading = true; s.error = null })
      const result = await api.dossier.get(query)
      set((s) => {
        s.isLoading = false
        if (result.success) s.detail = result.data
        else s.error = result.error
      })
    }
  }))
)
```

Reference in place:
[src/renderer/stores/documentStore.ts](src/renderer/stores/documentStore.ts).

---

## 12. Anti-patterns to avoid

1. **Catch-all files**: `utils.ts`, `helpers.ts`, `misc.ts`,
   `common.ts`, `tools.ts`. One exception: `src/renderer/lib/utils.ts`
   which contains only `cn()`. Every new function goes in a dedicated
   file.

2. **Business logic in an IPC handler**:

   ```ts
   // ❌
   ipcMain.handle('dossier:archive', async (_e, { id }) => {
     const raw = await readFile(getDossierMetadataPath(id))
     const parsed = JSON.parse(raw)
     parsed.status = 'archived'
     await writeFile(/* … */)
     return { success: true }
   })
   ```

   ```ts
   // ✅
   ipcMain.handle(IPC_CHANNELS.dossier.archive, async (_e, input) => {
     try {
       const parsed = dossierArchiveSchema.parse(input)
       return { success: true, data: await dossierService.archive(parsed) }
     } catch (error) {
       return mapDossierError(error, 'Unable to archive dossier.')
     }
   })
   ```

3. **IPC call from a component**:

   ```tsx
   // ❌
   useEffect(() => {
     window.ordicabAPI.dossier.get({ dossierId: id }).then(setData)
   }, [id])
   ```

   ```tsx
   // ✅
   const detail = useDossierStore((s) => s.detail)
   const load = useDossierStore((s) => s.load)
   useEffect(() => { void load({ dossierId: id }) }, [id, load])
   ```

4. **Unconfined `any`**: every `any` must be local to an adapter
   function in contact with an untyped external lib, and commented.

5. **`throw new Error('string')` in a service**: always a service
   error class carrying an `IpcErrorCode`.

6. **Mutable module-level singleton**: `let cachedFoo: Foo | null = null`
   at the top level of a module is forbidden. Memoization lives in the
   instance created by the factory.

7. **`electron` imports outside the allowed zone**: see §5.

8. **`I` prefix on interfaces**: `IUserService` → `UserService`.

9. **Hardcoded IPC channel**: any `'dossier:get'` string is forbidden
   outside of
   [src/shared/contracts/channels.ts](src/shared/contracts/channels.ts).

10. **Zod schema added in `src/renderer/schemas/`**: every new schema
    goes in `src/shared/validation/` (cf. §6).

### Note on file size

No hard line-count threshold. But if a file mixes several
responsibilities, is painful to navigate, or systematically requires
full-text searches to find your way around, then it should be split.
Known cases to split when the opportunity arises:

- [src/main/index.ts](src/main/index.ts) → extract `container.ts` (cf. §5).
- [src/main/services/aiEmbedded/aiService.ts](src/main/services/aiEmbedded/aiService.ts)
  → separate dispatch / PII / runtime.
- [src/renderer/features/templates/GenerateDocumentPanel.tsx](src/renderer/features/templates/GenerateDocumentPanel.tsx)
  → decompose by step (Setup / Tags / Review). First extracts done in
  `src/renderer/features/templates/generateDocument/` (`ComboField`,
  `tagValueHelpers`).

[src/main/lib/aiEmbedded/pii/fakegen.ts](src/main/lib/aiEmbedded/pii/fakegen.ts)
is long (1700+ lines) but it's a data table: OK as-is.
