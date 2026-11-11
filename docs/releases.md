# Releases

Public installers are built by `.github/workflows/release.yml`. Local build output is not uploaded to a release.

## Publish

1. Update the version in `package.json` and `package-lock.json`.
2. Add release notes at `docs/releases/v<version>.md`.
3. Run verification and push the changes to `master`.
4. Run **Release** from GitHub Actions, or push the matching `v<version>` tag.

The workflow checks that the version, tag and release notes agree. Windows builds the x64 EXE. macOS builds arm64 and x64 DMGs. Both jobs run source and packaged smoke tests.

After both builds pass, a publish job downloads their artifacts, checks the filenames and creates `SHA256SUMS.txt`. It uploads everything to a draft, then publishes the release. The tag points to the exact source commit used by the workflow.

## Retry

Use **Re-run failed jobs** after a build or upload failure. A draft can be reused only when its tag points to the same source commit. Published releases are not overwritten.

If source changes are needed after a tag has been created, use a new version and tag.

## Signing

Windows signing and macOS signing/notarization are not configured. Releases state this explicitly. Manual install and upgrade checks should use the downloaded installers on their target systems.
