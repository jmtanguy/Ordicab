import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { IpcErrorCode } from '@shared/types'

import { CabinetBillingServiceError, createCabinetBillingService } from '../cabinetBillingService'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ordicab-cabinet-billing-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function createService(domainPath: string): ReturnType<typeof createCabinetBillingService> {
  return createCabinetBillingService({
    domainService: {
      getStatus: async () => ({
        registeredDomainPath: domainPath,
        isAvailable: true,
        dossierCount: 0
      })
    },
    now: () => new Date('2026-05-23T10:00:00.000Z')
  })
}

const basePreset = {
  name: 'Forfait standard',
  usage: 'feeAgreement' as const,
  billingType: 'flat' as const,
  vatRateBasisPoints: 2000
}

describe('cabinetBillingService', () => {
  describe('get()', () => {
    it('returns an empty catalog when no file exists', async () => {
      const domainPath = await createTempDir()
      const service = createService(domainPath)

      const catalog = await service.get()

      expect(catalog.services).toEqual([])
      expect(catalog.defaultServiceId).toBeUndefined()
    })

    it('throws NOT_FOUND when domain is unavailable', async () => {
      const service = createCabinetBillingService({
        domainService: {
          getStatus: async () => ({
            registeredDomainPath: '/some/path',
            isAvailable: false,
            dossierCount: 0
          })
        }
      })

      await expect(service.get()).rejects.toThrow(CabinetBillingServiceError)
    })

    it('throws NOT_FOUND when no domain path is configured', async () => {
      const service = createCabinetBillingService({
        domainService: {
          getStatus: async () => ({
            registeredDomainPath: null,
            isAvailable: true,
            dossierCount: 0
          })
        }
      })

      await expect(service.get()).rejects.toMatchObject({ code: IpcErrorCode.NOT_FOUND })
    })

    it('defaults legacy service usage to feeAgreement', async () => {
      const domainPath = await createTempDir()
      const service = createService(domainPath)
      const cabinetDir = join(domainPath, '.ordicab')
      await mkdir(cabinetDir, { recursive: true })
      await writeFile(
        join(cabinetDir, 'cabinet-billing.json'),
        JSON.stringify({
          services: [
            {
              id: 'legacy-service',
              name: 'Ancienne prestation',
              billingType: 'flat',
              vatRateBasisPoints: 2000,
              isActive: true,
              updatedAt: '2026-05-23T10:00:00.000Z'
            }
          ],
          updatedAt: '2026-05-23T10:00:00.000Z'
        })
      )

      const catalog = await service.get()

      expect(catalog.services[0]!.usage).toBe('feeAgreement')
    })
  })

  describe('upsertService()', () => {
    it('creates a new service with a generated UUID', async () => {
      const domainPath = await createTempDir()
      const service = createService(domainPath)

      const catalog = await service.upsertService(basePreset)

      expect(catalog.services).toHaveLength(1)
      expect(catalog.services[0]!.name).toBe('Forfait standard')
      expect(catalog.services[0]!.usage).toBe('feeAgreement')
      expect(catalog.services[0]!.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )
    })

    it('persists the catalog to disk', async () => {
      const domainPath = await createTempDir()
      const service = createService(domainPath)

      await service.upsertService(basePreset)

      const raw = await readFile(join(domainPath, '.ordicab', 'cabinet-billing.json'), 'utf8')
      const parsed = JSON.parse(raw) as { services: { name: string }[] }
      expect(parsed.services[0]!.name).toBe('Forfait standard')
    })

    it('updates an existing service by ID', async () => {
      const domainPath = await createTempDir()
      const service = createService(domainPath)

      const catalog = await service.upsertService(basePreset)
      const id = catalog.services[0]!.id

      const updated = await service.upsertService({ ...basePreset, id, name: 'Forfait modifié' })

      expect(updated.services).toHaveLength(1)
      expect(updated.services[0]!.name).toBe('Forfait modifié')
      expect(updated.services[0]!.id).toBe(id)
    })

    it('updates the usage of an existing service by ID', async () => {
      const domainPath = await createTempDir()
      const service = createService(domainPath)

      const catalog = await service.upsertService(basePreset)
      const id = catalog.services[0]!.id

      const updated = await service.upsertService({ ...basePreset, id, usage: 'billing' })

      expect(updated.services).toHaveLength(1)
      expect(updated.services[0]!.usage).toBe('billing')
    })

    it('throws NOT_FOUND when updating a service with an unknown ID', async () => {
      const domainPath = await createTempDir()
      const service = createService(domainPath)

      await expect(
        service.upsertService({ ...basePreset, id: 'non-existent-id' })
      ).rejects.toMatchObject({ code: IpcErrorCode.NOT_FOUND })
    })

    it('creates multiple services independently', async () => {
      const domainPath = await createTempDir()
      const service = createService(domainPath)

      await service.upsertService({ ...basePreset, name: 'Prestation A' })
      const catalog = await service.upsertService({
        ...basePreset,
        usage: 'billing',
        billingType: 'hourly',
        name: 'Prestation B'
      })

      expect(catalog.services).toHaveLength(2)
      expect(catalog.services[1]!.usage).toBe('billing')
    })
  })

  describe('deleteService()', () => {
    it('removes the service from the catalog', async () => {
      const domainPath = await createTempDir()
      const service = createService(domainPath)

      const catalog = await service.upsertService(basePreset)
      const id = catalog.services[0]!.id

      const updated = await service.deleteService({ id })

      expect(updated.services).toHaveLength(0)
    })

    it('clears defaultServiceId when the default service is deleted', async () => {
      const domainPath = await createTempDir()
      const service = createService(domainPath)

      const catalog = await service.upsertService(basePreset)
      const id = catalog.services[0]!.id
      await service.setDefaultService({ serviceId: id })

      const updated = await service.deleteService({ id })

      expect(updated.defaultServiceId).toBeUndefined()
    })

    it('preserves defaultServiceId when a different service is deleted', async () => {
      const domainPath = await createTempDir()
      const service = createService(domainPath)

      await service.upsertService({ ...basePreset, name: 'A' })
      const catalog = await service.upsertService({ ...basePreset, name: 'B' })
      const [idA, idB] = [catalog.services[0]!.id, catalog.services[1]!.id]
      await service.setDefaultService({ serviceId: idA })

      const updated = await service.deleteService({ id: idB! })

      expect(updated.defaultServiceId).toBe(idA)
    })

    it('throws NOT_FOUND when deleting a non-existent service', async () => {
      const domainPath = await createTempDir()
      const service = createService(domainPath)

      await expect(service.deleteService({ id: 'ghost-id' })).rejects.toMatchObject({
        code: IpcErrorCode.NOT_FOUND
      })
    })
  })

  describe('setDefaultService()', () => {
    it('sets the default service', async () => {
      const domainPath = await createTempDir()
      const service = createService(domainPath)

      const catalog = await service.upsertService(basePreset)
      const id = catalog.services[0]!.id

      const updated = await service.setDefaultService({ serviceId: id })

      expect(updated.defaultServiceId).toBe(id)
    })

    it('clears the default when called with undefined serviceId', async () => {
      const domainPath = await createTempDir()
      const service = createService(domainPath)

      const catalog = await service.upsertService(basePreset)
      const id = catalog.services[0]!.id
      await service.setDefaultService({ serviceId: id })

      const updated = await service.setDefaultService({ serviceId: undefined })

      expect(updated.defaultServiceId).toBeUndefined()
    })

    it('throws NOT_FOUND when the target service does not exist', async () => {
      const domainPath = await createTempDir()
      const service = createService(domainPath)

      await expect(service.setDefaultService({ serviceId: 'ghost-id' })).rejects.toMatchObject({
        code: IpcErrorCode.NOT_FOUND
      })
    })
  })
})
