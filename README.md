# SatifactorySplitter

A web planner for [Satisfactory](https://satisfactory.wiki.gg) conveyor
networks: give it input and output belt rates and it synthesizes the most
building-efficient layout of splitters, mergers and belt tiers — including
saturation "taps" (limited belts) and minimum-tier belt assignment.

Built with React, Vite, Tailwind CSS, React Flow (elkjs layout) and a pure
TypeScript solver with an exact-rational core and steady-state verifier.

## Features

- **Exact ratios** where constructible: equal-split trees (½ / ⅓ parts) with
  subtree pruning and per-output merge trees.
- **Belt taps**: a lower-tier belt on a splitter output saturates at its own
  throughput — e.g. splitting 780/min with a Mk.1 and Mk.2 tap gives exact
  180/min and 600/min outputs from a single splitter + merger.
- **Minimum belt tiers**: every segment is labelled with the cheapest belt
  that carries it ("Mk.4+", or "any belt" for ≤ 60/min).
- **Approximate mode**: non-constructible ratios (like exactly 1/5) snap to
  the nearest achievable rate within an adjustable tolerance and are flagged
  as approximate.
- **Shareable links**: the whole problem is encoded in the URL.

## Development

```sh
npm install
npm run dev     # vite dev server
npm test        # vitest unit tests (solver)
npm run e2e     # playwright end-to-end tests (builds + serves preview)
npm run build   # typecheck + production build
npm run lint    # oxlint
```

## Deployment

GitHub Pages via `.github/workflows/deploy.yml` — on push to `main` it runs
the unit tests, builds, and publishes. Enable it once via
**Settings → Pages → Source: GitHub Actions**.

## AI disclosure

This application was designed and built with AI assistance (opencode / GLM),
under human direction. Game data (belt speeds, splitter/merger behaviour) is
taken from the community wiki; not affiliated with Coffee Stain Studios.
