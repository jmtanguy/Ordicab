# Release Pipeline

## Overview

Ordicab uses electron-builder to produce platform-specific installers and auto-update artifacts. The release process is designed to be deterministic and reproducible across CI runs.

## macOS

The macOS app must be signed and notarized with an Apple Developer certificate before distribution. Unsigned artifacts will be rejected by Gatekeeper on end-user machines.

Signing requires the following secrets to be set in the CI environment:

- `APPLE_TEAM_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_ID`
- `CSC_LINK` (base64-encoded .p12 certificate)
- `CSC_KEY_PASSWORD`

When signing credentials are not available (e.g. on forks or draft builds), the pipeline produces unsigned artifacts for testing purposes only. These must not be distributed publicly.

## Deterministic builds

The build process is deterministic: given the same source tree and dependency lockfile, the output artifacts are reproducible. The `package-lock.json` is committed and `npm ci` is used in CI to guarantee identical dependency resolution across runs.

## Windows

Windows builds are signed via Azure Trusted Signing when the relevant secrets are present. Unsigned artifacts are produced otherwise, suitable for internal testing.
