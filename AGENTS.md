# AGENTS.md

Reference ABX project: a daily Sudoku. See `README.md` and `docs/DEPLOYING.md`.

- Use the project-local CLI (`npx abx …` / `npm run abx -- …`), pinned in `package.json`. Run `abx help <cmd>` before composing a command; dry-run (`--dry-run --json`) before any send.
- Never read or print `.env`, keys or signing-session URLs. Never commit secrets (`.env` is gitignored).
- Prove every flow on Base Sepolia before Base (beta, real funds). One write command at a time per signer.
- `sudoku.js` traits and `DailySurfaces` attributes must always agree; change both or neither.
- Do not apply locks (`lock-script`, `lock-param-hooks`, …) without an explicit owner decision.
- `npm test` must pass (audits + `forge test`).
