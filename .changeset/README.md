# Changesets

This folder holds [Changesets](https://changesets.dev): small Markdown files that say which packages a PR changes, how big the change is (patch, minor or major), and a one-line summary for the changelog. When we release, Changesets reads them, bumps each package's version and writes its `CHANGELOG.md`.

The full workflow (when a PR needs a changeset, how to pick a bump while we're on `0.x`, and how releases work) is in [CONTRIBUTING.md → Changesets](../CONTRIBUTING.md#changesets).

## Quick reference

```bash
# Add a changeset for your PR (pick packages, bump type and write a summary)
corepack pnpm changeset

# See which packages would be released, and with which bump
corepack pnpm changeset:status

# Release step (maintainers): apply changesets to versions and changelogs
corepack pnpm version-packages
```

## Configuration

`config.json` in this folder:

- `baseBranch: "main"`: changes are compared against `main`.
- `changelog`: `@changesets/changelog-github` links each entry to its PR and author in `DevaanshMann/StackReel`.
- `privatePackages: { "version": true, "tag": false }`: our packages are `private: true` and aren't published to npm, but they still get version bumps and changelogs. No git tags are created for them.
- `access: "restricted"`: a safe default in case a package is ever published by mistake.
- `updateInternalDependencies: "patch"`: when a package is bumped, even by a patch, the workspace packages that depend on it get their dependency updated and a patch bump of their own.
- `ignore`: packages left out of versioning. Empty for now.
