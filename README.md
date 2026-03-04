# GROPT Risk Engine

GROPT Risk Engine is a pre-trade risk scoring module designed for automated trading systems.

It evaluates a token contract **before execution** and returns a structured decision:

- `allow`
- `caution`
- `block`

---

## What it does

GROPT runs a deterministic risk pipeline and outputs machine-readable JSON:

- Risk score (1–10)
- Policy decision (`allow | caution | block`)
- Rule-based signals (why the policy was chosen)
- Designed to be embedded in bots, routers, and pre-trade hooks

---

## Installation

```bash
git clone https://github.com/groptlabs/gropt-risk.git
cd gropt-risk
npm install
```

---

## Usage

### CLI

```bash
node index.js <TOKEN_CA> json
```

Example:

```bash
node index.js 0x1111111111111111111111111111111111111111 json
```

---

## Output (example)

```json
{
  "risk": {
    "level": "CRITICAL",
    "score": 1
  },
  "policy": "block",
  "label": "TRASH",
  "signals": [
    {
      "id": "NO_PAIRS",
      "level": "CRITICAL"
    }
  ]
}
```

---

## Policy meaning

- `allow` → acceptable risk for execution
- `caution` → reduce size / require manual verification
- `block` → do not execute

---

## Node integration (pre-trade hook)

```js
const { execFileSync } = require("node:child_process");

function groptRisk(ca) {
  const output = execFileSync("node", ["index.js", ca, "json"], {
    encoding: "utf8",
  });
  return JSON.parse(output);
}

const risk = groptRisk("0xTOKEN");

if (risk.policy === "block") {
  throw new Error("GROPT blocked execution");
}
```

---

## Notes

- This repository contains the **risk module**.  
- Runtime components (watchers, signal relays, bots) can consume this module via the CLI output.

---

## Roadmap

- Stable JSON schema (versioned)
- Optional HTTP wrapper (local API)
- Expanded rule set & chain adapters

---

## Security

Never commit `.env` files or API keys.