import { mkdtemp, readFile, rm, readdir, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  downloadModel,
  isModelPresent,
  modelDirFor,
  EMBEDDING_MODEL,
  NER_MODEL,
  type ManagedModel,
  type ModelDownloadProgress
} from '../modelDownloadService'

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'models-'))
  tempDirs.push(dir)
  return dir
}

// Minimal fetch double: returns a body for every requested file, encoding the
// requested URL path so we can assert what landed on disk. Optionally fails a
// specific file to exercise the cleanup path.
function fakeFetch(opts: { failOn?: string } = {}): typeof fetch {
  return (async (url: string | URL | Request) => {
    const href = typeof url === 'string' ? url : url.toString()
    if (opts.failOn && href.includes(opts.failOn)) {
      return { ok: false, status: 404, statusText: 'Not Found', body: null } as unknown as Response
    }
    const content = `content-of:${href.split('/resolve/main/')[1]}`
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(content))
        controller.close()
      }
    })
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-length': String(content.length) }),
      body: stream
    } as unknown as Response
  }) as typeof fetch
}

describe('modelDownloadService', () => {
  it('downloads every required file into {root}/{modelId}', async () => {
    const root = await makeRoot()
    await downloadModel(root, NER_MODEL, undefined, { fetch: fakeFetch() })

    const dir = modelDirFor(root, NER_MODEL.modelId)
    expect(await readFile(join(dir, 'config.json'), 'utf8')).toContain('content-of:config.json')
    expect(await readFile(join(dir, 'onnx/model_quantized.onnx'), 'utf8')).toContain(
      'content-of:onnx/model_quantized.onnx'
    )
    expect(await isModelPresent(root, NER_MODEL)).toBe(true)
  })

  it('is a no-op when the model is already present', async () => {
    const root = await makeRoot()
    await downloadModel(root, EMBEDDING_MODEL, undefined, { fetch: fakeFetch() })

    const spy = vi.fn(fakeFetch())
    await downloadModel(root, EMBEDDING_MODEL, undefined, { fetch: spy as unknown as typeof fetch })
    expect(spy).not.toHaveBeenCalled()
  })

  it('reports progress per file', async () => {
    const root = await makeRoot()
    const events: ModelDownloadProgress[] = []
    await downloadModel(root, NER_MODEL, (p) => events.push(p), { fetch: fakeFetch() })

    expect(events.length).toBeGreaterThan(0)
    expect(events[0]!.modelId).toBe(NER_MODEL.modelId)
    expect(events.at(-1)!.fileIndex).toBe(events.at(-1)!.fileCount - 1)
  })

  it('leaves no partial model and no temp dir when a file fails', async () => {
    const root = await makeRoot()
    await expect(
      downloadModel(root, NER_MODEL, undefined, { fetch: fakeFetch({ failOn: 'tokenizer.json' }) })
    ).rejects.toThrow()

    expect(await isModelPresent(root, NER_MODEL)).toBe(false)
    // No leftover ".downloading" temp directory.
    const entries = await readdir(root).catch(() => [])
    expect(entries.some((e) => e.includes('downloading'))).toBe(false)
  })

  it('isModelPresent returns false when a required file is empty', async () => {
    const root = await makeRoot()
    const model: ManagedModel = NER_MODEL
    const dir = modelDirFor(root, model.modelId)
    await mkdir(join(dir, 'onnx'), { recursive: true })
    await writeFile(join(dir, 'config.json'), 'x')
    await writeFile(join(dir, 'tokenizer.json'), 'x')
    await writeFile(join(dir, 'tokenizer_config.json'), 'x')
    await writeFile(join(dir, 'onnx/model_quantized.onnx'), '') // empty → not present
    expect(await isModelPresent(root, model)).toBe(false)
  })
})
