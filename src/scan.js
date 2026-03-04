// src/scan.js
const axios = require("axios");
const Web3 = require("web3");

const META = {
  module: "gropt-risk",
  version: "0.2.0",
};

// --- FOUR.MEME integration (BSC) ---
const FOUR = {
  apiBase: "https://four.meme",
  tokenGet: (ca) => `https://four.meme/meme-api/v1/private/token/get?address=${ca}`,
  tokenGetById: (id) => `https://four.meme/meme-api/v1/private/token/getById?id=${id}`,

  // TokenManager2 (V2) on BSC (from docs)
  tokenManager2: "0x5c952063c7fc8610FFDB798152D69F0B9550762b",
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

function isHexAddress(a) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(a || ""));
}

function pickBestPair(pairs, preferredChainId = "bsc") {
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

  // Liquidity (max 4)
  if (liquidity >= 1_000_000) s += 4;
  else if (liquidity >= 250_000) s += 3;
  else if (liquidity >= 75_000) s += 2;
  else if (liquidity >= 15_000) s += 1;

  // Volume (max 3)
  if (volume24h >= 1_000_000) s += 3;
  else if (volume24h >= 200_000) s += 2;
  else if (volume24h >= 10_000) s += 1;

  // FDV/Liq ratio (max 2)
  if (fdv > 0 && liquidity > 0) {
    const ratio = fdv / liquidity;
    if (ratio <= 25) s += 2;
    else if (ratio <= 80) s += 1;
  }

  // Activity/Momentum (max 1)
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

function getBscRpc() {
  return process.env.BSC_RPC || "https://bsc-dataseed.binance.org/";
}

async function fetchFourTokenInfo(ca) {
  try {
    const { data } = await axios.get(FOUR.tokenGet(ca), { timeout: 8000 });
    return data?.data || null;
  } catch {
    return null;
  }
}

function fourSignalsFromTokenInfo(fourInfo) {
  if (!fourInfo) return [];
  const out = [];

  // version=V8 => X Mode exclusive (docs)
  if (String(fourInfo?.version || "").toUpperCase() === "V8") {
    out.push({
      id: "FOUR_X_MODE",
      level: "MEDIUM",
      title: "Four.meme X Mode token",
      detail: "Token marked as X Mode (version=V8) by Four.meme.",
    });
  }

  // feePlan true => AntiSniperFeeMode (docs)
  if (fourInfo?.feePlan === true) {
    out.push({
      id: "FOUR_ANTI_SNIPER",
      level: "MEDIUM",
      title: "AntiSniper fee plan enabled",
      detail: "Four.meme indicates dynamic fee plan (feePlan=true).",
    });
  }

  // taxInfo exists => TaxToken (docs)
  if (fourInfo?.taxInfo) {
    out.push({
      id: "FOUR_TAX_TOKEN",
      level: "MEDIUM",
      title: "TaxToken detected",
      detail: "Four.meme returns taxInfo object for this token.",
    });
  }

  return out;
}

function tokenManager2AbiLite() {
  return [
    {
      inputs: [{ internalType: "address", name: "", type: "address" }],
      name: "_tokenInfos",
      outputs: [{ internalType: "uint256", name: "template", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
    {
      inputs: [{ internalType: "address", name: "", type: "address" }],
      name: "_tokenInfoEx1s",
      outputs: [
        { internalType: "uint256", name: "launchFee", type: "uint256" },
        { internalType: "uint256", name: "pcFee", type: "uint256" },
        { internalType: "uint256", name: "feeSetting", type: "uint256" },
        { internalType: "uint256", name: "blockNumber", type: "uint256" },
        { internalType: "uint256", name: "extraFee", type: "uint256" },
      ],
      stateMutability: "view",
      type: "function",
    },
  ];
}

async function fetchFourOnchainFlags(ca) {
  try {
    const web3 = new Web3(getBscRpc());
    const tm = new web3.eth.Contract(tokenManager2AbiLite(), FOUR.tokenManager2);

    const tokenInfo = await tm.methods._tokenInfos(ca).call();
    const template = BigInt(tokenInfo?.template || 0);

    const creatorType = Number((template >> 10n) & 0x3Fn);
    const isTaxToken = creatorType === 5;

    const ex1 = await tm.methods._tokenInfoEx1s(ca).call();
    const antiSniper = BigInt(ex1?.feeSetting || 0) > 0n;

    const isXModeExclusive = (template & 0x10000n) > 0n;

    return { ok: true, creatorType, isTaxToken, antiSniper, isXModeExclusive };
  } catch {
    return { ok: false };
  }
}

// Optional: holders via BscScan (needs API key)
async function fetchHoldersBscscan(ca) {
  const key = process.env.BSCSCAN_API_KEY;
  if (!key) return null;

  try {
    // Not all tokens expose holders count easily; we do "tokenholdercount" endpoint if available.
    // If it fails, just return null (no crash).
    const url =
      `https://api.bscscan.com/api?module=token&action=tokenholdercount&contractaddress=${ca}&apikey=${key}`;
    const { data } = await axios.get(url, { timeout: 8000 });
    const v = data?.result;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function scan(ca, mode = "text") {
  const m = safeLower(mode);
  const generatedAt = nowISO();

  if (!isHexAddress(ca)) {
    throw new Error("Input is not a valid 0x address.");
  }

  const input = { chain: "BSC", ca };

  const url = `https://api.dexscreener.com/latest/dex/tokens/${ca}`;
  const { data } = await axios.get(url, { timeout: 8_000 });

  const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
  const hasPairs = pairs.length > 0;

  // Enrichment (works with/without Dex pairs)
  const [fourInfo, fourChain, holders] = await Promise.all([
    fetchFourTokenInfo(ca),
    fetchFourOnchainFlags(ca),
    fetchHoldersBscscan(ca),
  ]);

  // No pairs
  if (!hasPairs) {
    const score = 1;
    const level = riskLevelFromScore(score);
    const policy = policyFromScore(score);

    const fourExtraSignals = fourSignalsFromTokenInfo(fourInfo);
    if (fourChain?.ok && fourChain.isTaxToken) {
      fourExtraSignals.push({
        id: "ONCHAIN_TAX_TOKEN",
        level: "MEDIUM",
        title: "TaxToken (on-chain)",
        detail: "TokenManager2 template indicates creatorType=5 (TaxToken).",
      });
    }
    if (fourChain?.ok && fourChain.antiSniper) {
      fourExtraSignals.push({
        id: "ONCHAIN_ANTI_SNIPER",
        level: "MEDIUM",
        title: "AntiSniperFeeMode (on-chain)",
        detail: "TokenManager2 _tokenInfoEx1s.feeSetting > 0.",
      });
    }
    if (fourChain?.ok && fourChain.isXModeExclusive) {
      fourExtraSignals.push({
        id: "ONCHAIN_X_MODE",
        level: "MEDIUM",
        title: "X Mode exclusive (on-chain)",
        detail: "TokenManager2 template bit 0x10000 indicates exclusive token.",
      });
    }

    const out = {
      ok: false,
      meta: { ...META, generatedAt },
      input,
      reason: "No pairs found on Dexscreener (no liquidity / not indexed).",
      risk: { level, score },
      policy,
      label: label(score),
      signals: [
        ...buildSignals({ hasPairs: false }),
        ...fourExtraSignals,
      ],
      evidence: {
        holders: holders ?? null,
        fourmeme: fourInfo
          ? {
              version: fourInfo?.version,
              feePlan: fourInfo?.feePlan,
              hasTaxInfo: !!fourInfo?.taxInfo,
            }
          : null,
        fourmemeOnchain: fourChain?.ok ? fourChain : null,
      },
      links: {
        dexscreenerTokenUrl: url,
        fourTokenApi: FOUR.tokenGet(ca),
      },
    };

    if (m === "json") return out;

    const linkLine = out.links.dexscreenerTokenUrl ? `\n${out.links.dexscreenerTokenUrl}` : "";
    const baseText =
      `No pairs found for ${ca}` +
      `\nRisk: ${level} | Policy: ${policy} | Score: ${score}/10 (${out.label})` +
      `\nSignal: NO_PAIRS`;

    return { ...out, textOutput: `${baseText}${linkLine}` };
  }

  // With pair
  const chosen = pickBestPair(pairs, "bsc");

  const symbol = chosen?.baseToken?.symbol || "?";
  const chainId = (chosen?.chainId || "bsc").toUpperCase();

  const liquidity = toNum(chosen?.liquidity?.usd);
  const fdv = toNum(chosen?.fdv); // we treat FDV as "mcap proxy" in outputs
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

  // Dead tape penalty
  if (trades < 15) score -= 2;
  else if (trades < 50) score -= 1;

  // Overvalued cap (FDV/Liq)
  if (ratio > 120) score = Math.min(score, 6);
  else if (ratio > 60) score = Math.min(score, 7);

  score = clamp(score, 1, 10);

  const level = riskLevelFromScore(score);
  const policy = policyFromScore(score);

  const signals = buildSignals({
    liquidity,
    volume24h,
    ratio,
    trades,
    score,
    hasPairs: true,
  });

  const fourExtraSignals = fourSignalsFromTokenInfo(fourInfo);
  if (fourChain?.ok && fourChain.isTaxToken) {
    fourExtraSignals.push({
      id: "ONCHAIN_TAX_TOKEN",
      level: "MEDIUM",
      title: "TaxToken (on-chain)",
      detail: "TokenManager2 template indicates creatorType=5 (TaxToken).",
    });
  }
  if (fourChain?.ok && fourChain.antiSniper) {
    fourExtraSignals.push({
      id: "ONCHAIN_ANTI_SNIPER",
      level: "MEDIUM",
      title: "AntiSniperFeeMode (on-chain)",
      detail: "TokenManager2 _tokenInfoEx1s.feeSetting > 0.",
    });
  }
  if (fourChain?.ok && fourChain.isXModeExclusive) {
    fourExtraSignals.push({
      id: "ONCHAIN_X_MODE",
      level: "MEDIUM",
      title: "X Mode exclusive (on-chain)",
      detail: "TokenManager2 template bit 0x10000 indicates exclusive token.",
    });
  }

  // merge (dedupe by id)
  const mergedSignals = [...signals, ...fourExtraSignals].reduce((acc, s) => {
    if (!acc.some((x) => x.id === s.id)) acc.push(s);
    return acc;
  }, []);

  const evidence = {
    token: symbol,
    chain: chainId,
    liquidity_usd: liquidity,
    volume24h_usd: volume24h,
    fdv_usd: fdv, // FDV = marketcap proxy in most memecoins
    mcap_proxy_usd: fdv,
    trades24h: trades,
    priceChange24h_pct: priceChange24h,
    fdv_to_liq: ratio,
    baseScore,
    holders: holders ?? null,

    fourmeme: fourInfo
      ? {
          version: fourInfo?.version,
          feePlan: fourInfo?.feePlan,
          hasTaxInfo: !!fourInfo?.taxInfo,
        }
      : null,
    fourmemeOnchain: fourChain?.ok ? fourChain : null,
  };

  const out = {
    ok: true,
    meta: { ...META, generatedAt },
    input: { chain: chainId, ca },
    risk: { level, score },
    policy,
    label: label(score),
    evidence,
    signals: mergedSignals,
    links: {
      dexscreenerPairUrl: chosen?.url || "",
      dexscreenerTokenUrl: url,
      fourTokenApi: FOUR.tokenGet(ca),
    },
  };

  if (m === "json") return out;

  // tweet mode (bot-ready)
  if (m === "tweet") {
    const linkLine = out.links.dexscreenerPairUrl
      ? `\n${out.links.dexscreenerPairUrl}`
      : out.links.dexscreenerTokenUrl
        ? `\n${out.links.dexscreenerTokenUrl}`
        : "";

    const holdersLine =
      typeof holders === "number" ? ` | Holders: ${holders.toLocaleString()}` : "";

    const flags = [];
    if (fourInfo?.feePlan === true || (fourChain?.ok && fourChain.antiSniper)) flags.push("AntiSniper");
    if (fourInfo?.taxInfo || (fourChain?.ok && fourChain.isTaxToken)) flags.push("TaxToken");
    if (String(fourInfo?.version || "").toUpperCase() === "V8" || (fourChain?.ok && fourChain.isXModeExclusive))
      flags.push("X-Mode");

    const flagsLine = flags.length ? `\nFlags: ${flags.join(" • ")}` : "";

    const tweetText = `$${symbol} (${chainId}) — GROPT Risk Engine

CA: ${ca}

MCap: ${fmtUSD(fdv)} | Liq: ${fmtUSD(liquidity)} | Vol(24h): ${fmtUSD(volume24h)}${holdersLine}
FDV/Liq: ${ratio ? ratio.toFixed(1) + "x" : "N/A"} | Trades(24h): ${trades} | 24h: ${fmtPct(priceChange24h)}

Score: ${score}/10 (${label(score)}) | Policy: ${policy.toUpperCase()}${flagsLine}

Every trade should pass GROPT.${linkLine}`;

    return { ...out, textOutput: tweetText };
  }

  // default text / roast
  const line1 = `$${symbol} (${chainId}) - MCap ${fmtUSD(fdv)} | Liq ${fmtUSD(liquidity)} | Vol ${fmtUSD(volume24h)}${
    typeof holders === "number" ? ` | Holders ${holders.toLocaleString()}` : ""
  }`;

  const line2 = `Risk: ${level} | Policy: ${policy} | Score: ${score}/10 (${out.label}) | FDV/Liq: ${
    ratio ? ratio.toFixed(1) + "x" : "N/A"
  } | 24h: ${fmtPct(priceChange24h)} | Trades: ${trades}`;

  const line3 =
    m === "roast"
      ? roastLine(level, policy)
      : `Signals: ${mergedSignals.length ? mergedSignals.slice(0, 4).map((s) => s.id).join(", ") : "none"}`;

  const line4 = out.links.dexscreenerPairUrl || out.links.dexscreenerTokenUrl;

  return { ...out, textOutput: `${line1}\n${line2}\n${line3}\n${line4}` };
}

module.exports = { scan, analyze: scan };