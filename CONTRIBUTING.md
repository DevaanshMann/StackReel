# Contributing to StackReel

Thanks for your interest! StackReel is early. The roadmap in the [README](README.md) is the plan of record.

## Ground rules

1. **Open an issue before large changes.** Link it to the roadmap phase it belongs to.
2. **Keep the template format the contract.** Any change to `packages/template-schema` needs a schema version bump or migration, updated golden fixtures, and passing tests on every engine that exists.
3. **On-device by default.** Do not add code that uploads user media or sends analytics without explicit opt-in.
4. **Write tests.** Pure logic needs unit tests. Render changes need golden-frame tests.
5. **Claim before you code.** Follow the status rule below.

## Status rule: claim work before starting

This rule keeps two people from building the same thing, and stops merge conflicts and overwritten work.

1. **Find or open an issue** for the work. Every feature, fix, or refactor needs one.
2. **Check its status first.** An issue labeled `status: in progress` with an assignee is taken. Don't start on it in parallel.
3. **Claim it** by commenting `/claim` on the issue. A bot assigns you and adds the `status: in progress` label.
   - If someone already holds it, the bot replies and tags them. Coordinate in the issue: split the work, pair up, or ask them to release it.
4. **Open a draft PR early**, within a day or two of claiming, with `Closes #<issue>` in the description. This shows everyone which files you're touching.
5. **Watch for overlap warnings.** Whenever a PR is opened or updated, a bot compares its files with every other open PR (drafts included). If two PRs change the same files, it posts a warning that tags both authors. Agree on who merges first, and have the other person rebase.
6. **Keep your claim alive** by commenting on the issue with progress updates.
   - After **14 days** with no comment from you, the bot posts a reminder.
   - After **21 days**, the claim is released automatically and anyone can `/claim` it.
7. **Release it** with `/unclaim` if you stop working on it.
8. **Closing the issue clears its status.** When the issue closes (for example, when your PR with `Closes #N` merges), the `status: in progress` label is removed automatically.

**Large or shared areas.** Some areas break easily when two people edit them at once: `packages/template-schema`, shared shaders, and the native bridge API. For these, post a short plan in the issue and wait for a maintainer's 👍 before you start.

## Branches & commits

- Branch from `main`: `feat/<area>-<short-desc>`, `fix/<area>-<short-desc>`, `docs/...`
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(schema): add caption track type`
- Squash-merge PRs into `main`. Keep `main` releasable.

## Changesets

We use [Changesets](https://changesets.dev) to version the packages in `packages/*` and write their changelogs. A changeset is a small Markdown file in `.changeset/` that names the packages a PR changes, the size of the bump, and a summary for the changelog.

**When a PR needs one.** Any change to a package's behavior or API: a new feature, a bug fix, a changed or removed export, a schema change, a dependency change that affects users of the package.

**When it doesn't.** Changes that don't touch what a package does: docs, CI and workflows, tests only, repo config (lint, format, editor settings), and refactors with no visible effect. Tick the "doesn't need one" box in the PR template.

**How to add one.** From the repo root:

```bash
corepack pnpm changeset
```

Pick the changed packages, choose the bump for each, and write a one-line summary in the past or present tense, written for someone using the package (for example, `Add caption track type to the template schema`). Commit the generated `.changeset/*.md` file with your PR. You can edit it by hand later, and a PR can have more than one. Run `corepack pnpm changeset:status` to see what would be released.

**Picking patch, minor or major while we're on `0.x`.** Every package starts at `0.0.0`, and before `1.0.0` the API isn't stable yet:

- **patch**: bug fixes and internal changes that don't change the API.
- **minor**: new features, and breaking changes. On `0.x`, a minor bump (`0.1.0` → `0.2.0`) is how we signal a break. Say what breaks and how to migrate in the summary.
- **major**: don't use it yet. Going to `1.0.0` is a deliberate release decision made by maintainers (see the roadmap).

**How versions and changelogs are produced.** Contributors only add changesets; they don't edit versions or `CHANGELOG.md` by hand. When a maintainer cuts a release, they run `corepack pnpm version-packages` on `main`. It consumes the pending changesets, bumps each package's `version` (plus a patch bump for workspace packages that depend on it), writes each package's `CHANGELOG.md` with links to the PR and author, and formats the result with Prettier. That goes in through a normal release PR. Our packages are `private: true`, so nothing is published to npm and no git tags are created yet.

## Pull requests

- Fill in the PR template.
- Add a changeset if your PR changes a package's behavior or API (see [Changesets](#changesets)).
- Add screenshots or a screen recording for any UI or render change.
- CI must pass (lint, typecheck, tests).

## Code of conduct

Be kind, assume good faith, and keep discussion technical. Harassment of any kind isn't tolerated.
