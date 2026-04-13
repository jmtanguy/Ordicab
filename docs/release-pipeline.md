# Release Pipeline Notes

## Scope

Story 1.5 establishes a reproducible packaging and release pipeline for Electron artifacts used by updater work in Story 1.6.

## Packaging outputs

- macOS arm64: `dmg` and `zip` artifacts from `npm run package:mac`
- Windows x64: `nsis` installer artifacts from `npm run package:win`
- Shared output directory: `out/make`
- Deterministic icon/resource paths:
  - `build/icon.icns` for macOS
  - `build/icon.ico` for Windows

## Workflow behavior

- `.github/workflows/ci.yml` runs on pushes to `main` and executes:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
- `.github/workflows/release.yml` runs on `v*` tags:
  - builds macOS and Windows artifacts in CI
  - aggregates `out/make` artifacts
  - creates a GitHub Release and uploads installer/update files

## Updater prerequisites and caveats

- macOS app must be signed for production auto-update behavior to work reliably with `electron-updater`.
- unsigned artifacts are still useful for deterministic packaging and release pipeline validation in early phases.
- Notarization and production signing secrets can be added later without changing artifact naming or workflow structure.
- Story 1.6 updater behavior is intentionally silent: packaged builds check GitHub Releases on startup, download updates in the background, and stage install for the next launch instead of prompting in-session.
- Offline or failed update checks must remain background-only diagnostics. Core local features still load even when update infrastructure is unreachable.

## Local cross-platform packaging

- `npm run package:mac` — run on macOS; produces arm64 DMG and ZIP artifacts.
- `npm run package:win` — run on Windows (in CI); produces x64 NSIS installer.
- `npm run package` — runs both sequentially. On macOS, producing Windows NSIS artifacts requires [Wine](https://www.winehq.org/) (`brew install --cask wine-stable`). Without Wine this command will fail after completing the Mac artifacts. Use the per-platform scripts locally instead.
- `npm run package:dir` — unpacked output for quick local inspection without creating installer archives.

## GitHub Actions permissions and token

- The release workflow requires `permissions: contents: write` (set at workflow level) to create GitHub Releases.
- `softprops/action-gh-release` uses `GITHUB_TOKEN` automatically — no additional secret is needed for public repositories.
- For private repositories, ensure the repository Actions settings allow workflows to create releases.
