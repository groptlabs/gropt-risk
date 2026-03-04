const express = require("express");
const dotenv = require("dotenv");
dotenv.config();

const { scan } = require("./scan.js");

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_, res) => res.json({ ok: true, marker: "wired-v3" }));

// POST /scan { "ca": "0x...", "mode": "text" }
app.post("/scan", async (req, res) => {
  try {
    const body = req.body || {};
    const ca = body.ca || body.address || body.token || body.pair;
    const mode = body.mode || "text";

    if (!ca) return res.status(400).json({ marker: "wired-v3", error: "ca (0x...) is required" });

    const data = await scan(ca, mode);
    res.json({ marker: "wired-v3", data });
  } catch (err) {
    res.status(500).json({ marker: "wired-v3", error: String(err && err.message ? err.message : err) });
  }
});

const port = process.env.GROPT_API_PORT || 8787;
app.listen(port, "127.0.0.1", () => {
  console.log("[gropt-api] wired-v3 listening on http://127.0.0.1:" + port);
});