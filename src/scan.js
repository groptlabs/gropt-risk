const axios = require("axios");

const META = {
  module: "gropt-risk",
  version: "0.1.0",
};

function nowISO() {
  return new Date().toISOString();
}

function toNum(x) {
  if (x === null || x === undefined) return 0;
  const n = Number(String(x).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function fmtUSD(x) {
  const n = toNum(x);
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + Math.round(n).toLocaleString();
}

function fmtPct(x) {
  const n = toNum(x);
  const sign = n > 0 ? "+" : "";
  return sign + n.toFixed(1) + "%";
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function safeLower(s) {
  return String(s || "").toLowerCase();
}

function pickBestPair(pairs, preferredChainId = "base") {
  const chainPairs = pairs.filter(
    (p) => safeLower(p.chainId) === safeLower(preferredChainId)
  );
  const pool = chainPairs.length ? chainPairs : pairs;

  return pool.sort((a, b) => {
    const lA = toNum(a?.liquidity?.usd);
    const lB = toNum(b?.liquidity?.usd);
    if (lB !== lA) return lB - lA;

    const vA = toNum(a?.volume?.h24);
    const vB = toNum(b?.volume?.h24);
    return vB - vA;
  })[0];
}

function score10({ liquidity, volume24h, fdv, txns24h, priceChange24h }) {
  let s = 0;

  if (liquidity >= 1_000_000) s += 4;
  else if (liquidity >= 250_000) s += 3;
  else if (liquidity >= 75_000) s += 2;
  else if (liquidity >= 15_000) s += 1;

  if (volume24h >= 1_000_000) s += 3;
  else if (volume24h >= 200_000) s += 2;
  else if (volume24h >= 10_000) s += 1;

  if (fdv > 0 && liquidity > 0) {
    const ratio = fdv / liquidity;
    if (ratio <= 25) s += 2;
    else if (ratio <= 80) s += 1;
  }

  const trades = toNum(txns24h);
  const ch = toNum(priceChange24h);

  if (trades >= 800) s += 1;
  else if (trades >= 250 && ch >= 0) s += 1;
  else if (trades >= 250) s += 0.5;
  else if (ch >= 15) s += 0.5;

  return clamp(Math.round(s), 1, 10);
}

function label(score) {
  if (score >= 8) return "STRONG";
  if (score >= 6) return "SOLID";
  if (score >= 4) return "MID";
  if (score >= 2) return "WEAK";
  return "TRASH";
}

function riskLevelFromScore(score) {
  if (score >= 8) return "LOW";
  if (score >= 6) return "MEDIUM";
  if (score >= 4) return "HIGH";
  return "CRITICAL";
}

function policyFromScore(score) {
  if (score >= 8) return "allow";
  if (score >= 6) return "caution";
  return "block";
}

function buildSignals({ liquidity, volume24h, ratio, trades, score, hasPairs }) {
  const signals = [];

  if (!hasPairs) {
    signals.push({
      id: "NO_PAIRS",
      level: "CRITICAL",
      title: "No Dexscreener pair",
      detail: "Token is not indexed or has no liquidity/pair.",
    });
    return signals;
  }

  if (liquidity < 15_000) {
    signals.push({
      id: "LIQ_THIN",
      level: "HIGH",
      title: "Thin liquidity",
      detail: "Liquidity below $15k. High slippage / wick risk.",
    });
  } else if (liquidity < 75_000) {
    signals.push({
      id: "LIQ_LIGHT",
      level: "MEDIUM",
      title: "Light liquidity",
      detail: "Liquidity below $75k. Size carefully.",
    });
  }

  if (volume24h < 10_000) {
    signals.push({
      id: "VOL_DEAD",
      level: "MEDIUM",
      title: "Low volume",
      detail: "24h volume is low. Price can be easily moved.",
    });
  }

  if (trades < 15) {
    signals.push({
      id: "TRADES_DEAD",
      level: "HIGH",
      title: "Dead tape",
      detail: "Very few trades in 24h. Expect random wicks.",
    });
  } else if (trades < 50) {
    signals.push({
      id: "TRADES_THIN",
      level: "MEDIUM",
      title: "Thin tape",
      detail: "Low trade count. Momentum can fade fast.",
    });
  }

  if (ratio > 120) {
    signals.push({
      id: "FDV_LIQ_EXTREME",
      level: "HIGH",
      title: "FDV/Liq extreme",
      detail: "FDV/Liq above 120x. Valuation stretched vs liquidity.",
    });
  } else if (ratio > 60) {
    signals.push({
      id: "FDV_LIQ_HIGH",
      level: "MEDIUM",
      title: "FDV/Liq elevated",
      detail: "FDV/Liq above 60x. Keep risk tight.",
    });
  }

  if (score <= 3) {
    signals.push({
      id: "SCORE_LOW",
      level: "HIGH",
      title: "Low overall score",
      detail: "Overall conditions are weak. Avoid or micro-size.",
    });
  }

  return signals;
}

function roastLine(level, policy) {
  if (policy === "allow") return "Looks clean. Still, trade numbers not feelings.";
  if (policy === "caution") return "Playable, but keep size tight. Momentum decides.";
  return level === "CRITICAL"
    ? "This is not a trade. It's a donation."
    : "High risk. Wicks will teach you.";
}

async function scan(ca, mode = "text") {
  const m = safeLower(mode);
  const generatedAt = nowISO();

  const input = { chain: "BASE", ca };

  const url = `https://api.dexscreener.com/latest/dex/tokens/${ca}`;
  const { data } = await axios.get(url, { timeout: 8_000 });

  const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
  const hasPairs = pairs.length > 0;

  // No pairs
  if (!hasPairs) {
    const score = 1;
    const level = riskLevelFromScore(score);
    const policy = policyFromScore(score);

    const out = {
      ok: false,
      meta: { ...META, generatedAt },
      input,
      reason: "No pairs found on Dexscreener (no liquidity / not indexed).",

      risk: { level, score },
      policy,
      label: label(score),

      signals: buildSignals({ hasPairs: false }),
      evidence: {},
      links: { dexscreenerTokenUrl: url },
    };

    if (m === "json") return out;

    const text =
      `No pairs found for ${ca}` +
      `\nRisk: ${level} | Policy: ${policy} | Score: ${score}/10 (${out.label})` +
      `\nSignal: NO_PAIRS`;

    return { ...out, textOutput: text };
  }

  // With pair
  const chosen = pickBestPair(pairs, "base");

  const symbol = chosen?.baseToken?.symbol || "?";
  const chainId = (chosen?.chainId || "base").toUpperCase();

  const liquidity = toNum(chosen?.liquidity?.usd);
  const fdv = toNum(chosen?.fdv);
  const volume24h = toNum(chosen?.volume?.h24);

  const trades =
    toNum(chosen?.txns?.h24?.buys) + toNum(chosen?.txns?.h24?.sells);

  const priceChange24h = toNum(chosen?.priceChange?.h24);
  const ratio = fdv > 0 && liquidity > 0 ? fdv / liquidity : 0;

  const baseScore = score10({
    liquidity,
    volume24h,
    fdv,
    txns24h: trades,
    priceChange24h,
  });

  let score = baseScore;

  if (trades < 15) score -= 2;
  else if (trades < 50) score -= 1;

  if (ratio > 120) score = Math.min(score, 6);
  else if (ratio > 60) score = Math.min(score, 7);

  score = clamp(score, 1, 10);

  const level = riskLevelFromScore(score);
  const policy = policyFromScore(score);

  const evidence = {
    token: symbol,
    chain: chainId,
    liquidity_usd: liquidity,
    volume24h_usd: volume24h,
    fdv_usd: fdv,
    trades24h: trades,
    priceChange24h_pct: priceChange24h,
    fdv_to_liq: ratio,
    baseScore,
  };

  const signals = buildSignals({
    liquidity,
    volume24h,
    ratio,
    trades,
    score,
    hasPairs: true,
  });

  const out = {
    ok: true,
    meta: { ...META, generatedAt },
    input: { chain: chainId, ca },
    risk: { level, score },
    policy,
    label: label(score),

    evidence,
    signals,

    links: {
      dexscreenerPairUrl: chosen?.url || "",
      dexscreenerTokenUrl: url,
    },
  };

  if (m === "json") return out;

  const line1 = `$${symbol} (${chainId}) - Liq ${fmtUSD(liquidity)} | Vol ${fmtUSD(volume24h)} | FDV ${fmtUSD(fdv)}`;
  const line2 = `Risk: ${level} | Policy: ${policy} | Score: ${score}/10 (${out.label}) | FDV/Liq: ${ratio ? ratio.toFixed(1) + "x" : "N/A"} | 24h: ${fmtPct(priceChange24h)} | Trades: ${trades}`;
  const line3 = m === "roast" ? roastLine(level, policy) : `Signals: ${signals.length ? signals.slice(0, 3).map(s => s.id).join(", ") : "none"}`;
  const line4 = out.links.dexscreenerPairUrl || out.links.dexscreenerTokenUrl;

  return { ...out, textOutput: `${line1}\n${line2}\n${line3}\n${line4}` };
}

module.exports = { scan, analyze: scan };


