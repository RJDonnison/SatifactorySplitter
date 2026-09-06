# Commands

- `npm run dev` — Vite dev server
- `npm run build` — typecheck + production build (`tsc -b && vite build`)
- `npm run lint` — oxlint
- `npm test` — Vitest unit tests (solver, `src/**/*.test.ts`)
- `npm run e2e` — Playwright end-to-end tests (`e2e/`, builds + serves preview at
  `http://localhost:4173/SatifactorySplitter/`)
- `npm run format` — Prettier

# Conventions

- Conventional Commits (`feat:`, `fix:`, `test:`, `ci:`, `chore:`, `docs:`)
- Prettier with `singleQuote: true, semi: false`
- Solver code in `src/solver/` is pure TypeScript with no React imports; keep it
  unit-testable
- Deploy: GitHub Pages via `.github/workflows/deploy.yml` (base path
  `/SatifactorySplitter/`)
