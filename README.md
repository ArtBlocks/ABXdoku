# ABXdoku

A fully on-chain **daily Sudoku**, built with [ABX](https://github.com/ArtBlocks/abx). Every token
plays a generated puzzle with **exactly one solution**, and the whole collection turns over to a new
puzzle every UTC day — with no transaction, no scheduler and no server.

This repository is an **example / reference implementation** of a small, complete ABX code project:
a JavaScript program, two tiny Solidity contracts, tests, audits, and a reproducible deployment. It
is not an official or endorsed release of anything.

| | |
|---|---|
| Network | Base (`8453`) — ABX support level **beta** |
| Collection | [`0x31024340295693CE680350D23Ead13c6c14e84f1`](https://basescan.org/address/0x31024340295693CE680350D23Ead13c6c14e84f1) (ERC-721, max 16) |
| OpenSea | [token #0 on OpenSea](https://opensea.io/item/base/0x31024340295693ce680350d23ead13c6c14e84f1/0) |
| Hosted view | <https://resolver.abx.io/t/8453/0x31024340295693ce680350d23ead13c6c14e84f1/0> |
| Testnet twin | Base Sepolia, see [`deployments/base-sepolia.json`](deployments/base-sepolia.json) |

> **Risk note.** ABX on Base is a prerelease **beta** without an independent third-party audit, and
> the contracts here are unaudited example code. The collection's script and hooks are deliberately
> **not locked**, so the owner can still change them. Use at your own risk.

## How it works

```
 program/sudoku.js ──(on-chain chunks)──▶ SeriesCode token ◀── DailyRotation (augment hook)
        ▲                                        │                   supplies `day`
        │ reads abx.tokenData {seed, day}        ├── DailySurfaces  (image + attributes)
        └──────── the live document ◀────────────┘
```

- **`program/sudoku.js`** — the artwork. The puzzle is a pure function of the token's mint-time
  `seed` and the current `day`. A full legal grid is filled, then cells are removed only while a
  solution counter still finds exactly one solution, so uniqueness holds by construction. Difficulty
  is read off the clue count actually reached. The program is stored on-chain in 2 chunks; the
  canonical ABX generator assembles the HTML document on-chain.
- **`contracts/src/DailyRotation.sol`** — an ABX *augment hook*. One `view` returns
  `day = block.timestamp / period` (`period = 86400`). The hook runs when token data is read, so the
  puzzle rolls over at 00:00 UTC by itself. It cannot touch `seed` (a reserved key); the program
  mixes `day` into its RNG.
- **`contracts/src/DailySurfaces.sol`** — the on-chain `image` (an SVG cover) and `attributes`. A
  rotating token can't honestly cache today's difficulty in metadata, so both state only what is true
  of *every* puzzle the token will ever show. They must stay in agreement with the `abx.traits(...)`
  call in `sudoku.js`.
- **Resolution** — `tokenURI`/`contractURI` resolve fully on-chain (`abx verify` reports
  *chain-complete*). The project is also registered with ABX Services for indexing and a hosted live
  view; marketplaces read the on-chain URI, not that service.

## Repository layout

```
program/      sudoku.js — the ABX program
contracts/    Foundry project: src/, test/, script/  (deps pinned by soldeer.lock)
tools/        audit32.js, audit-daily.js + fixtures (seeds.json, tokens.json)
deployments/  what is actually on-chain, per network (addresses, blocks, txs)
docs/         DEPLOYING.md — the exact, reproducible deployment recipe
```

## Develop

Requires Node ≥ 22.13 and [Foundry](https://getfoundry.sh).

```bash
npm install                       # pins @artblocks/abx-cli 0.2.0
cd contracts && forge soldeer install && cd ..

npm test                          # audits + contract tests
npm run preview                   # run the program locally, live (abx preview)
npm run inspect                   # abx inspect: static analysis of the program
```

- `tools/audit32.js` — for 32 seeds, checks the puzzle is valid, has exactly one solution (using an
  independent counter), and that the reported traits match the puzzle.
- `tools/audit-daily.js` — checks that with no `day` the program still produces the original puzzle
  (regression baseline in `tools/tokens.json`), that consecutive days give different puzzles, that each
  still has one solution, and that traits never vary by day.
- `forge test` — 18 tests, including never-revert fuzzing for the renderer (an ABX requirement: a
  reverting renderer bricks `tokenURI`) and the exact-midnight rollover of the hook.

`abx inspect` warns that the program reads a `day` param that is not in `--schema`. That is expected:
`day` comes from the augment hook, not a collector-set PostParam. Likewise its `p5` library hint is a
false positive — the program has no dependencies.

## Deploy

See [`docs/DEPLOYING.md`](docs/DEPLOYING.md). In short: prove the flow on Base Sepolia, then repeat
on Base with `ABX_CHAIN=base`, using the ABX creator wallet (`--sponsor`) so no private key is ever
on disk.
