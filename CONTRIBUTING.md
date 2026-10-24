# Contributing to StackReel

Thanks for your interest! StackReel is early. The roadmap in the [README](README.md) is the plan of record.

## Ground rules

1. **Open an issue before large changes.** Link it to the roadmap phase it belongs to.
2. **Keep the template format the contract.** Any change to `packages/template-schema` needs a schema version bump or migration, updated golden fixtures, and passing tests on every engine that exists.
3. **On-device by default.** Do not add code that uploads user media or sends analytics without explicit opt-in.
4. **Write tests.** Pure logic needs unit tests. Render changes need golden-frame tests.

## Branches & commits

- Branch from `main`: `feat/<area>-<short-desc>`, `fix/<area>-<short-desc>`, `docs/...`
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(schema): add caption track type`
- Squash-merge PRs into `main`. Keep `main` releasable.

## Pull requests

- Fill in the PR template.
- Add screenshots or a screen recording for any UI or render change.
- CI must pass (lint, typecheck, tests).

## Code of conduct

Be kind, assume good faith, and keep discussion technical. Harassment of any kind isn't tolerated.
