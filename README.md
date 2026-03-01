\# GROPT Risk Engine



> Every trade should pass GROPT.



GROPT Risk Engine is a pre-trade risk scoring module designed for claw-compatible trading bots.



It evaluates token risk before execution and returns a structured policy decision:



\- allow

\- caution

\- block





------------------------------------------------------------



WHAT IT DOES



GROPT analyzes live market data and applies trader-grade risk logic:



\- Pre-trade risk scoring (1–10)

\- Auto-block on dead pools

\- FDV / Liquidity distortion detection

\- Low activity penalty

\- Structured JSON output

\- Claw-compatible integration





------------------------------------------------------------



INSTALLATION



git clone https://github.com/groptlabs/gropt-risk.git

cd gropt-risk

npm install





------------------------------------------------------------



USAGE



node index.js <TOKEN\_CA> json



Example:



node index.js 0x1111111111111111111111111111111111111111 json





------------------------------------------------------------



OUTPUT EXAMPLE



{

&nbsp; "risk": {

&nbsp;   "level": "CRITICAL",

&nbsp;   "score": 1

&nbsp; },

&nbsp; "policy": "block",

&nbsp; "label": "TRASH",

&nbsp; "signals": \[

&nbsp;   {

&nbsp;     "id": "NO\_PAIRS",

&nbsp;     "level": "CRITICAL"

&nbsp;   }

&nbsp; ]

}





------------------------------------------------------------



POLICY MEANING



allow   → Safe to trade  

caution → Reduce size / verify  

block   → Do not trade  





------------------------------------------------------------



EXAMPLE PRE-TRADE HOOK (Node)



const { execFileSync } = require("node:child\_process");



function groptRisk(ca) {

&nbsp; const output = execFileSync("node", \["index.js", ca, "json"], {

&nbsp;   encoding: "utf8",

&nbsp; });



&nbsp; return JSON.parse(output);

}



const risk = groptRisk("0xTOKEN");



if (risk.policy === "block") {

&nbsp; throw new Error("GROPT BLOCKED TRADE");

}





------------------------------------------------------------



WHY GROPT?



Most bots trade blindly.



GROPT forces risk discipline before capital deployment.



Built for speed.

Designed for automation.

Made for serious traders.





------------------------------------------------------------



ROADMAP



\- HTTP API version

\- Rate limiting

\- Multi-chain support

\- On-chain signal expansion

\- Token-gated premium tier





------------------------------------------------------------



Status: v0.1

Module: gropt-risk

Maintained by: groptlabs



Every trade should pass GROPT.

