# Dependencies

Rules for managing dependencies across the repo.

## Scope
All packages and apps in this monorepo.

## Rules
- [R1] Use Bun only: `bun add`, `bun remove`, `bun update`. Do not use `npm`, `pnpm`, or `yarn`.
- [R2] Commit `package.json` and `bun.lock` together any time deps are added/removed.
- [R3] Never hand‑edit `bun.lock`. ALWAYS run `bun install` to update it.
- [R4] For internal deps, use `"workspace:*"` and never hardcode versions.
- [R5] Install `@types/*` when a package lacks types. Do not add `.d.ts` files to silence errors.
- [R6] Put type‑only or build/test tools in `devDependencies`; runtime imports belong in `dependencies`.
