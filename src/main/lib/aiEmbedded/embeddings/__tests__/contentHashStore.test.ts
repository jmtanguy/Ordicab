import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  computeFileSha256,
  isContentHashFresh,
  readIndexedHashFromCache,
  writeIndexedHashToCache
} from '../contentHashStore'

async function makeTmpDir(prefix = 'content-hash-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

async function writeCache(dir: string, payload: Record<string, unknown>): Promise<string> {
  const path = join(dir, 'cache.json')
  await writeFile(path, JSON.stringify(payload, null, 2), 'utf8')
  return path
}

describe('computeFileSha256', () => {
  it('returns the same digest for identical bytes regardless of read mode', async () => {
    const dir = await makeTmpDir()
    const a = join(dir, 'a.txt')
    const b = join(dir, 'b.txt')
    await writeFile(a, 'hello world')
    await writeFile(b, 'hello world')

    const hashA = await computeFileSha256(a)
    const hashB = await computeFileSha256(b)

    expect(hashA).toMatch(/^sha256-[0-9a-f]{64}$/)
    expect(hashA).toBe(hashB)
  })

  it('produces a different digest for different content', async () => {
    const dir = await makeTmpDir()
    const a = join(dir, 'a.txt')
    const b = join(dir, 'b.txt')
    await writeFile(a, 'contract version 1')
    await writeFile(b, 'contract version 2')

    expect(await computeFileSha256(a)).not.toBe(await computeFileSha256(b))
  })
})

describe('readIndexedHashFromCache', () => {
  it('returns null when the cache file does not exist', async () => {
    const dir = await makeTmpDir()
    expect(await readIndexedHashFromCache(join(dir, 'missing.json'))).toBeNull()
  })

  it('returns null when the cache exists but has no hash fields (legacy v3)', async () => {
    const dir = await makeTmpDir()
    const path = await writeCache(dir, {
      version: 3,
      text: 'old extraction without hash',
      method: 'embedded',
      extractedAt: '2026-01-01T00:00:00Z'
    })
    expect(await readIndexedHashFromCache(path)).toBeNull()
  })

  it('returns the hash and byteLength when both fields are present', async () => {
    const dir = await makeTmpDir()
    const path = await writeCache(dir, {
      version: 3,
      text: 'extraction with hash',
      sourceContentHash: 'sha256-abcdef',
      sourceByteLength: 4242
    })
    expect(await readIndexedHashFromCache(path)).toEqual({
      sourceContentHash: 'sha256-abcdef',
      sourceByteLength: 4242
    })
  })

  it('returns null when the JSON is corrupt', async () => {
    const dir = await makeTmpDir()
    const path = join(dir, 'broken.json')
    await writeFile(path, '{not valid json')
    expect(await readIndexedHashFromCache(path)).toBeNull()
  })
})

describe('writeIndexedHashToCache', () => {
  it('merges sourceContentHash + sourceByteLength without disturbing other fields', async () => {
    const dir = await makeTmpDir()
    const path = await writeCache(dir, {
      version: 3,
      name: 'doc.pdf',
      method: 'embedded',
      extractedAt: '2026-01-01T00:00:00Z',
      text: 'preserved',
      isEmpty: false,
      embeddings: {
        model: 'Xenova/multilingual-e5-small',
        dim: 384,
        chunks: [],
        createdAt: '2026-01-01T00:00:00Z'
      }
    })

    const ok = await writeIndexedHashToCache(path, 'sha256-deadbeef', 1024)
    expect(ok).toBe(true)

    const after = JSON.parse(await readFile(path, 'utf8'))
    expect(after.sourceContentHash).toBe('sha256-deadbeef')
    expect(after.sourceByteLength).toBe(1024)
    expect(after.version).toBe(3)
    expect(after.text).toBe('preserved')
    expect(after.method).toBe('embedded')
    expect(after.embeddings).toBeTruthy()
    expect(after.embeddings.model).toBe('Xenova/multilingual-e5-small')
  })

  it('returns false when the cache file is missing', async () => {
    const dir = await makeTmpDir()
    const ok = await writeIndexedHashToCache(join(dir, 'missing.json'), 'sha256-x', 1)
    expect(ok).toBe(false)
  })

  it('overwrites a previously stored hash', async () => {
    const dir = await makeTmpDir()
    const path = await writeCache(dir, {
      version: 3,
      text: 'a',
      sourceContentHash: 'sha256-old',
      sourceByteLength: 10
    })
    await writeIndexedHashToCache(path, 'sha256-new', 99)
    expect(await readIndexedHashFromCache(path)).toEqual({
      sourceContentHash: 'sha256-new',
      sourceByteLength: 99
    })
  })
})

describe('isContentHashFresh', () => {
  it('returns false when the cache has no hash recorded', async () => {
    const dir = await makeTmpDir()
    const path = await writeCache(dir, { version: 3, text: 'no hash here' })
    expect(await isContentHashFresh(path, 'sha256-anything')).toBe(false)
  })

  it('returns true when the recorded hash matches', async () => {
    const dir = await makeTmpDir()
    const path = await writeCache(dir, {
      version: 3,
      text: 'x',
      sourceContentHash: 'sha256-aaa',
      sourceByteLength: 1
    })
    expect(await isContentHashFresh(path, 'sha256-aaa')).toBe(true)
  })

  it('returns false when the recorded hash differs', async () => {
    const dir = await makeTmpDir()
    const path = await writeCache(dir, {
      version: 3,
      text: 'x',
      sourceContentHash: 'sha256-aaa',
      sourceByteLength: 1
    })
    expect(await isContentHashFresh(path, 'sha256-bbb')).toBe(false)
  })
})

describe('integration: hash a file and use it as a freshness gate', () => {
  it('records, re-reads, and matches the hash of a freshly extracted file', async () => {
    const dir = await makeTmpDir()
    const source = join(dir, 'doc.txt')
    await writeFile(source, 'simulated extracted source content')

    const cachePath = await writeCache(dir, {
      version: 3,
      method: 'direct',
      text: 'simulated extracted source content'
    })

    const hash = await computeFileSha256(source)
    await writeIndexedHashToCache(cachePath, hash, 'simulated extracted source content'.length)

    expect(await isContentHashFresh(cachePath, hash)).toBe(true)

    // Simulate the source file being mutated.
    await writeFile(source, 'simulated extracted source content — edited')
    const newHash = await computeFileSha256(source)
    expect(await isContentHashFresh(cachePath, newHash)).toBe(false)

    await rm(dir, { recursive: true, force: true })
  })
})
