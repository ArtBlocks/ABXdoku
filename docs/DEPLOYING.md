# Deploying ABXdoku

This is the recipe used for the deployments recorded in [`deployments/`](../deployments). Read
`abx help <command>` before each step — the CLI, not this file, is the source of truth for flags.

**Prerequisites:** `npm install`, `forge build --root contracts`, and an ABX Services login:

```bash
npx abx auth login          # browser approval; writes ABX_SERVICES_API_KEY to the gitignored .env
npx abx remote abx          # confirm the token is accepted
```

The first `--sponsor` command provisions your ABX *creator wallet* and asks you to approve an agent
grant at <https://services.abx.io/authorize>. Sponsorship is zero-value and needs no private key or
faucet. Select the network with `ABX_CHAIN` (there is deliberately no `--chain` flag).

**Always run the full flow on `base-sepolia` first**, then repeat with `ABX_CHAIN=base`. Base is an
ABX *beta* network — confirm the plan with `--dry-run --json` before each real send. Run one write at
a time: never start two write commands concurrently with the same signer.

## 1. Deploy the two helper contracts

`--sponsor` deploys through the keyless CREATE2 proxy, so neither contract may rely on
`msg.sender` — these have no owner. The CLI picks a fresh salt per run, so the address in a dry run
is **not** the address you will get; use the address the real run prints.

```bash
export ABX_CHAIN=base-sepolia      # then: base
npx abx deploy-contract --artifact contracts/out/DailySurfaces.sol/DailySurfaces.json \
  --label "ABXdoku surfaces" --sponsor

# period is constructor arg: 86400 for a real daily; use e.g. 120 on testnet to watch a rotation
cast abi-encode "f(uint256)" 86400 > /tmp/period.hex
npx abx deploy-contract --artifact contracts/out/DailyRotation.sol/DailyRotation.json \
  --constructor-args-file /tmp/period.hex --label "ABXdoku daily rotation" --sponsor
```

## 2. Deploy the collection

`--onchain-uri` with both renderer flags makes `tokenURI`/`contractURI`, the image and the traits
resolve fully on-chain (no resolver in the graph). Deploy-time choices below are permanent: ERC-721
family, non-burnable, plain (not 721C), `--max` only ever decreases, and the royalty cap only ever
decreases.

```bash
SURFACES=0x…   # from step 1
npx abx deploy-code --script program/sudoku.js --onchain-uri \
  --image-renderer $SURFACES --attributes-renderer $SURFACES \
  --name "ABXdoku" --symbol ABXDOKU --max 16 --mint-count 1 \
  --description "A fully on-chain daily Sudoku. One puzzle per UTC day, unique solution guaranteed. Reference implementation of a small ABX code project." \
  --creator "ABXdoku reference project" --sponsor --dry-run --json   # review, then drop --dry-run/--json
```

## 3. Wire the daily rotation, register, verify

```bash
npx abx set-param-hooks $COLLECTION --augment $ROTATION --sponsor
npx abx add $COLLECTION --remote abx --from-block <deploy block>     # index on ABX Services
npx abx verify $COLLECTION           # expect: canonical, chain-complete, tokenURI + animation_url on-chain
npx abx tokenuri $COLLECTION
```

Acceptance checklist (every promised surface, from its canonical path):

| Surface | Check |
|---|---|
| Token metadata / image / traits | `abx tokenuri` — name, `attributes` (Rotation/Solutions/Program) and a `data:image/svg+xml` image |
| Live document | decoded `animation_url` contains `"day":"<days since epoch>"` and changes at 00:00 UTC |
| Chain-completeness | `abx verify` reports chain-complete |
| Hosted view | `abx verify $COLLECTION --remote abx` |

`abx verify --remote` will report the token's *off-chain still* as stale. That does not apply here: the
image is the on-chain cover SVG, so there is nothing to render.

## Not done on purpose

`abx lock-script`, `lock-uri`/`lock-field` and `lock-param-hooks` are **not** applied. Verify first,
lock last, and only with the owner's explicit decision — locks are irreversible and each freezes only
what it names.
