# GROPT Risk Engine

> Every trade should pass GROPT.

GROPT Risk Engine is a pre-trade risk scoring module designed for claw-compatible trading bots.

It evaluates token risk before execution and returns a structured policy decision:

- allow
- caution
- block

---

# WHAT IT DOES

GROPT analyzes live market data and applies trader-grade risk logic:

- Pre-trade risk scoring (1–10)
- Auto-block on dead pools
- FDV / Liquidity distortion detection
- Low activity penalty
- Structured JSON output
- Claw-compatible integration

---

# INSTALLATION

```bash
git clone https://github.com/groptlabs/gropt-risk.git
cd gropt-risk
npm install
```

---

# USAGE

Run GROPT risk analysis on a token contract:

```bash
node index.js <TOKEN_CA> json
```

Example:

```bash
node index.js 0x1111111111111111111111111111111111111111 json
```

---

# OUTPUT EXAMPLE

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

# POLICY MEANING

allow → Safe to trade  
caution → Reduce size / verify  
block → Do not trade  

---

# EXAMPLE PRE-TRADE HOOK (Node)

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
  throw new Error("GROPT BLOCKED TRADE");
}
```

---

# HTTP API (LOCAL)

Run the API server:

```bash
npm run api
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

Scan a contract:

```bash
curl -X POST http://127.0.0.1:8787/scan \
-H "Content-Type: application/json" \
-d '{"ca":"0x...","mode":"text"}'
```

---

# WHY GROPT?

Most bots trade blindly.

GROPT forces risk discipline before capital deployment.

Built for speed.  
Designed for automation.  
Made for serious traders.

---

# ROADMAP

- HTTP API version
- Rate limiting
- Multi-chain support
- On-chain signal expansion
- Token-gated premium tier

---

Status: v0.1  
Module: gropt-risk  
Maintained by: groptlabs  

Every trade should pass GROPT.