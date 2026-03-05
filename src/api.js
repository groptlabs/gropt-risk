import express from "express";
import dotenv from "dotenv";

dotenv.config(); // 

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_, res) => res.json({ ok: true }));

app.post("/scan", async (req, res) => {
  res.json({ ok: true, note: "scan not wired yet" });
});

app.post("/smart-money", async (req, res) => {
  res.json({ ok: true, note: "smart-money not wired yet" });
});

app.post("/risk", async (req, res) => {
  res.json({ ok: true, note: "risk not wired yet" });
});

const port = Number(process.env.GROPT_API_PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1"; // public deploy: "0.0.0.0"

app.listen(port, host, () => {
  console.log(`[gropt-api] listening on http://${host}:${port}`);
});
