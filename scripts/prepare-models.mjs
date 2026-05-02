#!/usr/bin/env node
/**
 * prepare-models — fetches bundled ONNX models into resources/models/.
 *
 * Run before electron-builder packages the app. The downloaded files are then
 * picked up by extraResources in electron-builder.config.ts and shipped inside
 * the installer, so end-users get embedded-AI features without any manual
 * install step or first-run network call.
 *
 * Layout mirrors transformers.js's `{localModelPath}/{modelId}/` convention:
 *   resources/models/Xenova/bert-base-multilingual-cased-ner-hrl/...
 *   resources/models/Xenova/multilingual-e5-small/...
 *
 * Bundled models (ship with the installer so offline first-run works):
 *   - NER:        Xenova/bert-base-multilingual-cased-ner-hrl          (~45 MB int8)
 *   - Embeddings: Xenova/multilingual-e5-small                         (~120 MB int8)
 *
 * Override individual models with env vars:
 *   NER_MODEL_ID=<huggingface-id>        npm run prepare:models
 *   EMBEDDING_MODEL_ID=<huggingface-id>  npm run prepare:models
 *
 * Skip a model with SKIP_NER=1 / SKIP_EMBEDDINGS=1.
 */

import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const HF_BASE = 'https://huggingface.co'

// Files required at runtime by transformers.js for a given pipeline task.
// `model_quantized.onnx` maps to `dtype: 'q8'` at the call site — see
// modelRegistry.ts for the v3 API translation.
const FILES_BY_TASK = {
  'token-classification': [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/model_quantized.onnx'
  ],
  'feature-extraction': [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/model_quantized.onnx'
  ]
}

// Every bundled model lives under a single `resources/models/` root so the
// transformers.js module-global `env.localModelPath` can resolve all of them
// through one claim. `modelId` is the HuggingFace id and is also the
// subdirectory name — transformers.js looks under `{localModelPath}/{modelId}/`.
const MODELS = [
  {
    name: 'NER',
    task: 'token-classification',
    modelId: process.env.NER_MODEL_ID ?? 'Xenova/bert-base-multilingual-cased-ner-hrl',
    revision: process.env.NER_MODEL_REVISION ?? 'main',
    skip: process.env.SKIP_NER === '1'
  },
  {
    name: 'Embeddings',
    task: 'feature-extraction',
    modelId: process.env.EMBEDDING_MODEL_ID ?? 'Xenova/multilingual-e5-small',
    revision: process.env.EMBEDDING_MODEL_REVISION ?? 'main',
    skip: process.env.SKIP_EMBEDDINGS === '1'
  }
]

async function alreadyDownloaded(filePath) {
  try {
    const st = await stat(filePath)
    return st.isFile() && st.size > 0
  } catch {
    return false
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

async function downloadOne({ modelId, revision, targetDir, relPath }) {
  const url = `${HF_BASE}/${modelId}/resolve/${revision}/${relPath}`
  const target = join(targetDir, relPath)

  if (await alreadyDownloaded(target)) {
    const st = await stat(target)
    console.log(`  ✓ ${relPath} (cached, ${formatBytes(st.size)})`)
    return st.size
  }

  await mkdir(dirname(target), { recursive: true })

  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(target, buf)
  console.log(`  ✓ ${relPath} (${formatBytes(buf.length)})`)
  return buf.length
}

async function prepareModel(model) {
  if (model.skip) {
    console.log(`→ ${model.name}: skipped via env`)
    return 0
  }

  const files = FILES_BY_TASK[model.task]
  if (!files) {
    throw new Error(`Unknown task "${model.task}" for model ${model.name}`)
  }

  const targetDir = join(REPO_ROOT, 'resources', 'models', model.modelId)
  console.log(`→ ${model.name}: ${model.modelId}@${model.revision}`)
  console.log(`  target: ${targetDir}`)

  let total = 0
  for (const file of files) {
    total += await downloadOne({
      modelId: model.modelId,
      revision: model.revision,
      targetDir,
      relPath: file
    })
  }
  console.log(`  total: ${formatBytes(total)}`)
  console.log('')
  return total
}

async function main() {
  console.log('Preparing embedded AI models')
  console.log('')

  let grandTotal = 0
  for (const model of MODELS) {
    grandTotal += await prepareModel(model)
  }

  console.log(`Done. Total bundled: ${formatBytes(grandTotal)}`)
}

main().catch((err) => {
  console.error('Model preparation failed:', err.message)
  process.exit(1)
})
