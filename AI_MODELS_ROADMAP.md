# Embedded AI Models — Roadmap

In-process ML models running via `@huggingface/transformers` (ONNX runtime) inside the Electron main process. Goal: improve the legal-document UX without sending content to frontier APIs unless required.

All models are CPU-only, downloaded once to disk, cached, and shared across features through a single loader.

## Shared trigger: post-extraction hook

Workstreams **#2 (embeddings)** and **#3 (classification)** both consume the **extracted text** produced by [documentContentService.ts](src/main/lib/aiEmbedded/documentContentService.ts). Wire both off a single post-extraction step so the model passes happen exactly once per document, in a known order, after `ContentCacheEntry` is written.

Order of operations after a document is added:

1. Text extraction (existing) → writes `ContentCacheEntry { text, method, extractedAt }` to the per-document cache JSON.
2. **NEW** — embeddings pass: chunk + embed `text`, append `embeddings` field to the same per-document cache JSON.
3. **NEW** — classification pass: zero-shot over the first ~2000 chars of `text`, write resulting label(s) into the document's `tags` via the existing metadata path.
4. Notify renderer (existing change event) so UI updates.

Steps 2 and 3 run in the background and never block step 4 for the user-facing add. If either fails, the document is still usable; the missing data is recomputed on demand.

---

## Cross-cutting: local model registry

Lift the pattern already in [nerDetection.ts](src/main/lib/aiEmbedded/pii/nerDetection.ts) into a shared loader so each new model isn't a fresh copy of the same wiring.

**Scope**
- One module that owns: dynamic import of `@huggingface/transformers`, pipeline cache keyed by `(task, model)`, shared `userData/models/` directory, warmup, graceful failure.
- Unified `ModelConfig` shape: `{ task, model, modelPath?, quantized?, minScore? }`.
- Per-feature consumers stay small — they call `getPipeline(config)` and own only the post-processing.

**Bundling policy** (decide once, applies to all three workstreams)

- **Ship with installer**: NER + embeddings + zero-shot classifier — all three are bundled via `scripts/prepare-models.mjs` so first-run works offline.
- Use the `SKIP_NER=1` / `SKIP_EMBEDDINGS=1` / `SKIP_CLASSIFIER=1` env vars to produce slimmer installers for dev or constrained channels.

**Definition of done**
- `nerDetection.ts` migrated to the new loader without behavior change.
- `package` / `package:mac` / `package:win` scripts updated to bundle the chosen models.
- Offline first-run works for bundled models; lazy models surface a clear "downloading…" state.

---

## 1. Finish NER (in progress)

**Status**: wired end-to-end via [nerDetection.ts](src/main/lib/aiEmbedded/pii/nerDetection.ts) and merged into [piiPseudonymizer.ts](src/main/lib/aiEmbedded/pii/piiPseudonymizer.ts). Default model: `Xenova/bert-base-multilingual-cased-ner-hrl` (~45 MB int8).

**Remaining work**
- [ ] Decide French-only vs multilingual default. Convert CamemBERT-NER to ONNX if French-only wins on accuracy for legal corpus samples.
- [ ] Bundle the model via `scripts/download-ner-model.mjs` (already exists) — verify it's wired into all three packaging scripts.
- [ ] Warmup call from main-process startup ([src/main/index.ts](src/main/index.ts)) so first pseudonymization isn't blocked by cold load.
- [ ] Tune `minScore` against a labeled sample of real dossier text — current 0.85 is a guess.
- [ ] Confirm fallback path: if the bundled model is missing or load fails, regex-only detection still produces correct output.
- [ ] Migrate to the shared loader (see cross-cutting section).

**Risks**
- Model size on installer footprint — ~45 MB acceptable, larger CamemBERT variants (>110 MB) need a conscious call.
- False positives on legal jargon ("Tribunal", "Société") that look like ORG/LOC — measure before shipping.

**Definition of done**
- Pseudonymization recall on a held-out sample improves measurably vs. regex-only.
- Cold-start regression: first pseudonymize call after launch < 500 ms with warmup.
- Packaged app pseudonymizes correctly with no network access.

---

## 2. Add embeddings → semantic search + local RAG

**Why this is the biggest leap**: today the user can only find documents by filename or full-text match. Embeddings let them ask "which documents discuss the rent dispute?" and get hits even when those exact words aren't in the doc. Same primitive enables RAG: pull the top-K chunks of a dossier and stuff them into the frontier-API prompt instead of sending entire documents.

**Model**: `Xenova/multilingual-e5-small` — ~120 MB, 384-dim, multilingual (FR/EN), strong on retrieval benchmarks. Alternative: `Xenova/paraphrase-multilingual-MiniLM-L12-v2` if size is tight.

**Workstream**
- [ ] **Embedding service** in `src/main/lib/aiEmbedded/embeddings/` — wraps `feature-extraction` pipeline, exposes `embed(text: string): Promise<Float32Array>` and `embedBatch(texts: string[])`.
- [ ] **Chunking strategy**: paragraph-level chunks with ~512-token windows + 50-token overlap. Preserve `(chunkIndex, charStart, charEnd)` for citation.
- [ ] **Indexing trigger**: hooked off the **post-extraction step** (see "Shared trigger" above). Runs after `ContentCacheEntry` is written; never blocks document add.
- [ ] **Persistence — extend the per-document cache JSON**: add an `embeddings` field to `ContentCacheEntry` in [documentContentService.ts:49-56](src/main/lib/aiEmbedded/documentContentService.ts#L49-L56) so vectors live alongside the extracted text they were derived from. Shape:

  ```ts
  embeddings: {
    model: string                   // e.g. "Xenova/multilingual-e5-small"
    dim: number                     // 384
    chunks: Array<{
      charStart: number
      charEnd: number
      vector: string                // base64-encoded Float32Array
    }>
    createdAt: string
  }
  ```

  Bump the cache `version` so old entries are recomputed cleanly.

- [ ] **In-memory query index**: on dossier open, load each per-document cache JSON, decode vectors, build a flat in-memory index for cosine search. Dossiers are bounded — no SQLite/sqlite-vec needed.
- [ ] **Query API**: new IPC channel `documents:semanticSearch` in [channels.ts](src/shared/contracts/channels.ts) — input: `{ dossierId, query, topK }`, output: ranked chunks with snippets.
- [ ] **UI**: search box in dossier view that calls the new channel; results show document name + matched snippet + jump-to-location.
- [ ] **RAG hook into AI service**: when the user asks the AI about a dossier, retrieve top-K chunks first, inject into the system prompt as context, then call frontier API. Replaces sending entire documents.
- [ ] **PII consideration**: embed the **pseudonymized** text, not raw. Embeddings of pseudonyms still cluster correctly because the surrounding context dominates.
- [ ] **Reindex trigger**: when extraction re-runs (text changed), the new `ContentCacheEntry` write drops the stale `embeddings` field, which re-triggers the embedding pass.

**Risks**
- Embedding cost on first index — a 100-page document ≈ ~300 chunks ≈ ~10–20 s on CPU. Needs a progress indicator and background processing.
- Storage: 384 floats × 4 bytes × 300 chunks ≈ 460 KB per document inside its cache JSON — fine. Base64 inflates ~33%; if cache JSONs grow past a few MB, switch the `vector` field to a sidecar `.bin` file referenced from the JSON.
- JSON parsing cost when loading many docs into memory — measure before optimising; can switch to a binary sidecar later without changing the API surface.
- Quality on legal French — validate on real samples before committing to the model choice.

**Definition of done**
- "Find documents about X" returns relevant docs even when X isn't in the filename or as exact text.
- AI panel answers a dossier-scoped question using only the top-K retrieved chunks (verified by inspecting the prompt sent to the frontier API).
- Indexing happens in the background without blocking the UI.

---

## 3. Add zero-shot classification → cheap auto-tagging

**Why**: tag every document as "contrat", "assignation", "jugement", "courrier", "facture", etc. without training a model or maintaining labeled data. The model decides via natural-language label descriptions; labels can be edited at any time without retraining.

**Model**: `Xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7` — ~340 MB int8, multilingual NLI fine-tuned on 2.7 M NLI pairs. Heaviest of the three but only invoked on document add, not on every interaction. (See [scripts/prepare-models.mjs](scripts/prepare-models.mjs) and [classificationService.ts](src/main/lib/aiEmbedded/classification/classificationService.ts) for the bundled variant.)

**Replaces existing regex-based tagging**. Today, [documentStructuredAnalysis.ts:179-209](src/main/lib/aiEmbedded/documentStructuredAnalysis.ts#L179-L209) produces `suggestedTags` via regex heuristics (year, presence of amounts/parties/clauses), and those tags are fed into the metadata at:

- [dossierTransferService.ts:555-558](src/main/services/domain/dossierTransferService.ts#L555-L558)
- [aiDelegatedActionExecutor.ts:610](src/main/lib/aiDelegated/aiDelegatedActionExecutor.ts#L610)

Those call sites switch to the zero-shot classifier for category tags (contrat/jugement/…). The rest of `extractStructuredDocumentAnalysis` (parties, dates, monetary amounts, clauses) stays — it serves a different purpose (LLM context enrichment, not tagging).

**Workstream**

- [ ] **Classification service** in `src/main/lib/aiEmbedded/classification/` — wraps `zero-shot-classification` pipeline, exposes `classify(text, candidateLabels): Promise<Array<{label, score}>>`.
- [ ] **Default label set** for legal docs (configurable in settings later): contrat, assignation, jugement, courrier, facture, attestation, expertise, conclusions, pièce justificative, autre.
- [ ] **Trigger**: hooked off the **post-extraction step** (see "Shared trigger" above). Classify the first ~2000 chars of extracted text — enough signal, fast. Runs after the embeddings pass, never blocks document add.
- [ ] **Remove the regex `suggestedTags` path**: update the two call sites above to consume the classifier's output instead of `analysis.suggestedTags`. Drop `suggestedTags` from `DocumentStructuredAnalysis` in [document.ts:47-53](src/shared/domain/document.ts#L47-L53) and its test coverage in [documentStructuredAnalysis.test.ts](src/main/lib/aiEmbedded/__tests__/documentStructuredAnalysis.test.ts) once the new path is live.
- [ ] **Persistence — reuse existing metadata**: write the predicted label into the document's existing `tags: string[]` via the same path as manual tagging (`saveMetadata` / `DocumentMetadataUpdate` from [document.ts:65-70](src/shared/domain/document.ts#L65-L70)). No new schema column. Two design points to settle:
  - **Distinguish auto from manual**: prefix auto-tags (e.g. `auto:contrat`) so reclassification can safely replace prior auto-tags without touching user-added tags. Strip the prefix for display.
  - **Confidence threshold**: only persist a tag when `score ≥ threshold` (start at 0.6). Below threshold → no tag rather than a wrong one.
- [ ] **UI**: render the auto-tag with the same badge component as manual tags in [DocumentList.tsx](src/renderer/features/documents/DocumentList.tsx), visually distinguished (subtler styling) so the user can tell which were predicted vs. authored. User can delete an auto-tag like any other tag.
- [ ] **Settings**: let the user edit the candidate label list per-workspace. No retraining needed when labels change — trigger a reclassification pass that replaces only `auto:*` tags.
- [x] **Bundled with installer**: shipped via `scripts/prepare-models.mjs` so first classification runs offline without a download step.

**Risks**
- Latency: ~1–2 s per document on CPU. Run async, never block document add.
- Label set quality matters more than model quality — bad labels = bad tags. Treat the default set as a v0 to be refined from user feedback.
- mDeBERTa size (~340 MB int8) is the largest single asset. If it's a problem, fall back to `Xenova/nli-deberta-v3-xsmall` (~70 MB) at some accuracy cost.
- Auto-tag prefix collision: pick a prefix that can't appear in user-typed tags (e.g. `auto:` is safe if validation rejects `:` in manual input — verify in [DocumentList.tsx](src/renderer/features/documents/DocumentList.tsx) and the metadata edit flow).

**Definition of done**
- New documents automatically get a tag visible in the UI within a few seconds of being added.
- User can filter a dossier's documents by auto-tag.
- Editing the label list reclassifies existing documents on demand.

---

## Sequencing

1. **Cross-cutting registry first** — small refactor, paves the way and de-risks the next two.
2. **Finish NER** — close out the in-progress work; smallest scope.
3. **Embeddings + semantic search + RAG** — biggest UX leap, largest workstream. Land in this order: service → indexing → search UI → RAG integration.
4. **Zero-shot classification** — additive, doesn't depend on the others, can ship behind a flag.

Each step is independently shippable.
