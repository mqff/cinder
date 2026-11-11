# Releases

Public installers are built by `.github/workflows/release.yml`. Local build output is not uploaded to a release.

## Publish

1. Update the version in `package.json` and `package-lock.json`.
2. Add release notes at `docs/releases/v<version>.md`.
3. Run verification and push the changes to `master`.
4. Run **Release** from GitHub Actions, or push the matching `v<version>` tag.

The workflow checks that the version, tag and release notes agree. Windows builds the x64 EXE. Separate Apple silicon and Intel runners build their matching DMGs. Every build runs source, archive and native launch checks.

The macOS checks mount the DMG, copy its app, verify the signature and architecture, then launch that copy. The Windows check launches the unpacked executable. Both check a fixture scan, worker processes and navigation.

After both builds pass, a publish job downloads their artifacts, checks the filenames and creates `SHA256SUMS.txt`. It uploads everything to a draft, then publishes the release. The tag points to the exact source commit used by the workflow.

## Retry

Use **Re-run failed jobs** after a build or upload failure. A draft can be reused only when its tag points to the same source commit. Published releases are not overwritten.

If source changes are needed after a tag has been created, use a new version and tag.

## Signing

Windows installers are unsigned. macOS apps use electron-builder's ad-hoc signing with `mac.identity: "-"`. They have no Developer ID signature and are not notarized, so Gatekeeper can still block downloads. See the [macOS instructions](../README.md#download).

Manual install and upgrade checks should use the downloaded installers on their target systems.
