/* GROPT Watcher (BSC) — FINAL PRO (stable + fresh sniper + BUY/WATCH labels + Smart Money)
   - candidates: Dexscreener API (search + boosts + profiles) + Binance Meme Rush (optional) + Binance Smart Money (optional)
   - scan filter: MIN_SCORE
   - labels: BUY_SCORE / WATCH_SCORE => 🔥 BUY / 👀 WATCH / ✅ PASS
   - dedup cooldown per CA (sent)  [state persisted]
   - anti-rescan cooldown per CA (seen) [state persisted]
   - candidate pool cache + random sampling (prevents same-small-list lock)
   - FRESH SNIPER PREFILTER (before scan): age/liquidity/volume/mcap/progress/socials
   - Telegram output: English, trading-signal style
   - four.meme enrich: off-chain + on-chain (best-effort)
*/

const axios = require("axios");
const dotenv = require("dotenv");
const fs = require("fs");
const { Web3 } = require("web3");
const { scan } = require("./scan");

dotenv.config();

/* -----------------------------
   ENV + safety
----------------------------- */

function cleanEnv(v) {
  return String(v ?? "").trim();
}
function isPlaceholder(v) {
  const s = cleanEnv(v);
  return (
    !s ||
    s === "YOUR_TG_BOT_TOKEN" ||
    s === "YOUR_TG_CHAT_ID" ||
    s === "undefined" ||
    s === "null"
  );
}

const ENV = {
  TG_BOT_TOKEN: cleanEnv(process.env.TG_BOT_TOKEN),
  TG_CHAT_ID: cleanEnv(process.env.TG_CHAT_ID),

  CHAIN: cleanEnv(process.env.CHAIN || "bsc").toLowerCase(),
  WATCH_INTERVAL_MS: Number(process.env.WATCH_INTERVAL_MS || 15000),
  PER_TOKEN_DELAY_MS: Number(process.env.PER_TOKEN_DELAY_MS || 250),
  SCAN_TIMEOUT_MS: Number(process.env.SCAN_TIMEOUT_MS || 12000),

  MIN_SCORE: Number(process.env.MIN_SCORE || 5),
  BUY_SCORE: Number(process.env.BUY_SCORE || 8),
  WATCH_SCORE: Number(process.env.WATCH_SCORE || 6),

  COOLDOWN_MIN: Number(process.env.COOLDOWN_MIN || 30),
  SEEN_COOLDOWN_MS: Number(process.env.SEEN_COOLDOWN_MS || Math.max(15000 * 4, 60000)),

  DEBUG: cleanEnv(process.env.DEBUG || "") === "1",

  BSC_RPC_URL:
    cleanEnv(process.env.BSC_RPC_URL) ||
    cleanEnv(process.env.RPC_URL) ||
    "https://bsc-dataseed.binance.org/",

  // Dex freshness (minutes). 0 = off
  DEX_MAX_AGE_MIN: Number(process.env.DEX_MAX_AGE_MIN || 0),

  // watcher tuning
  MAX_CANDIDATES_PER_TICK: Number(process.env.MAX_CANDIDATES_PER_TICK || 60),
  ROTATE_STEP: Number(process.env.ROTATE_STEP || 10),

  // Candidate pool
  POOL_TTL_MIN: Number(process.env.POOL_TTL_MIN || 360), // 6h default
  POOL_MAX_SIZE: Number(process.env.POOL_MAX_SIZE || 3000),

  // ---- Fresh Sniper Mode / Prefilter ----
  MODE: cleanEnv(process.env.MODE || "fresh").toLowerCase(), // "fresh" | "wide"
  PREFILTER_ENABLED: cleanEnv(process.env.PREFILTER_ENABLED || "0") === "1",

  PREF_AGE_MIN_SEC: Number(process.env.PREF_AGE_MIN_SEC || 0),
  PREF_AGE_MAX_SEC: Number(process.env.PREF_AGE_MAX_SEC || 0),

  PREF_LIQ_MIN: Number(process.env.PREF_LIQ_MIN || 0),
  PREF_VOL_MIN: Number(process.env.PREF_VOL_MIN || 0),
  PREF_MCAP_MIN: Number(process.env.PREF_MCAP_MIN || 0),
  PREF_MCAP_MAX: Number(process.env.PREF_MCAP_MAX || 0),

  PREF_PROGRESS_MIN: Number(process.env.PREF_PROGRESS_MIN || 0),
  PREF_PROGRESS_MAX: Number(process.env.PREF_PROGRESS_MAX || 100),

  PREF_REQUIRE_SOCIALS: cleanEnv(process.env.PREF_REQUIRE_SOCIALS || "0") === "1",

  // ---- Binance Meme Rush ----
  BN_MEME_RUSH_ENABLED: cleanEnv(process.env.BN_MEME_RUSH_ENABLED || "0") === "1",

  // ---- Binance Smart Money ----
  BN_SMART_MONEY_ENABLED: cleanEnv(process.env.BN_SMART_MONEY_ENABLED || "0") === "1",
  BN_SMART_MONEY_PAGE_SIZE: Number(process.env.BN_SMART_MONEY_PAGE_SIZE || 100),
  BN_SMART_MONEY_PAGES: Number(process.env.BN_SMART_MONEY_PAGES || 2),
  BN_SMART_MONEY_TYPE: cleanEnv(process.env.BN_SMART_MONEY_TYPE || ""), // "" for all
  BN_SMART_MONEY_ONLY_BUY: cleanEnv(process.env.BN_SMART_MONEY_ONLY_BUY || "1") === "1",
  BN_SMART_MONEY_REQUIRE_ACTIVE: cleanEnv(process.env.BN_SMART_MONEY_REQUIRE_ACTIVE || "0") === "1",
  BN_SMART_MONEY_MIN_COUNT: Number(process.env.BN_SMART_MONEY_MIN_COUNT || 0),

  // If 1 => send Smart Money even if score < MIN_SCORE
  BN_SMART_MONEY_FORCE_SEND: cleanEnv(process.env.BN_SMART_MONEY_FORCE_SEND || "0") === "1",

  // state
  STATE_FILE: cleanEnv(process.env.STATE_FILE || "./state.json"),
  STATE_SAVE_EVERY_MS: Number(process.env.STATE_SAVE_EVERY_MS || 5000),

  // Four.meme enrich
  FOUR_MEME_API_BASE:
    cleanEnv(process.env.FOUR_MEME_API_BASE) || "https://four.meme/meme-api/v1",
  FOUR_MEME_TOKEN_MANAGER_2:
    cleanEnv(process.env.FOUR_MEME_TOKEN_MANAGER_2) ||
    "0x5c952063c7fc8610FFDB798152D69F0B9550762b",
};

if (isPlaceholder(ENV.TG_BOT_TOKEN))
  throw new Error("TG_BOT_TOKEN invalid/placeholder (fix .env)");
if (isPlaceholder(ENV.TG_CHAT_ID))
  throw new Error("TG_CHAT_ID invalid/placeholder (fix .env)");

const COOLDOWN_MS = ENV.COOLDOWN_MIN * 60 * 1000;

/* -----------------------------
   utils + state
----------------------------- */

const sentMap = new Map(); // ca -> lastSentMs
const seenMap = new Map(); // ca -> lastSeenMs (scanned)
let ROTATE_OFFSET = 0;

// pool: ca -> { ts, sources:Set<string>, meta:{...} }
const candidatePool = new Map();

function logDebug(...args) {
  if (ENV.DEBUG) console.log("[debug]", ...args);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withTimeout(promise, ms, label = "timeout") {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(label)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(t);
  }
}

function normAddr(x) {
  return String(x || "").trim().toLowerCase();
}
function isAddress(x) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(x || "").trim());
}
function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function shouldSend(ca) {
  const k = normAddr(ca);
  const last = sentMap.get(k) || 0;
  return Date.now() - last >= COOLDOWN_MS;
}
function markSent(ca) {
  sentMap.set(normAddr(ca), Date.now());
}
function shouldScan(ca) {
  const k = normAddr(ca);
  const last = seenMap.get(k) || 0;
  return Date.now() - last >= ENV.SEEN_COOLDOWN_MS;
}
function markSeen(ca, ms = Date.now()) {
  seenMap.set(normAddr(ca), ms);
}

// ---- state persistence ----
function loadState() {
  try {
    if (!fs.existsSync(ENV.STATE_FILE)) return;
    const raw = fs.readFileSync(ENV.STATE_FILE, "utf8");
    const j = JSON.parse(raw);
    if (j?.sent && typeof j.sent === "object") {
      for (const [k, v] of Object.entries(j.sent)) sentMap.set(k, Number(v) || 0);
    }
    if (j?.seen && typeof j.seen === "object") {
      for (const [k, v] of Object.entries(j.seen)) seenMap.set(k, Number(v) || 0);
    }
    logDebug("state loaded", { sent: sentMap.size, seen: seenMap.size });
  } catch (e) {
    logDebug("state load failed", e?.message || e);
  }
}

function saveState() {
  try {
    const sent = Object.fromEntries(sentMap.entries());
    const seen = Object.fromEntries(seenMap.entries());
    fs.writeFileSync(ENV.STATE_FILE, JSON.stringify({ sent, seen }, null, 2));
  } catch (e) {
    logDebug("state save failed", e?.message || e);
  }
}

/* -----------------------------
   helpers for meta/prefilter
----------------------------- */

function clampNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function ageSecFromCreateTimeMs(ms) {
  const t = Number(ms || 0);
  if (!t) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

function fmtUsd(n) {
  const x = clampNum(n);
  if (!x) return "n/a";
  if (x >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `$${(x / 1e6).toFixed(2)}M`;
  if (x >= 1e3) return `$${(x / 1e3).toFixed(1)}K`;
  return `$${x.toFixed(0)}`;
}

function fmtAge(sec) {
  if (sec === null || sec === undefined) return "n/a";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

function hasAnySocial(socials) {
  const tw = socials?.twitter;
  const tg = socials?.telegram;
  const web = socials?.website;
  return Boolean(
    (tw && String(tw).trim()) ||
      (tg && String(tg).trim()) ||
      (web && String(web).trim())
  );
}

// ---- prefilter (before scan) ----
function prefilterMeta(meta = {}) {
  if (!ENV.PREFILTER_ENABLED) return true;

  const ageSec = meta.ageSec ?? null;
  const liq = clampNum(meta.liquidityUsd);
  const vol = clampNum(meta.volumeUsd);
  const mc = clampNum(meta.marketCapUsd);
  const prog =
    meta.progress === null || meta.progress === undefined
      ? null
      : Number(meta.progress);

  if (ENV.MODE === "fresh") {
    if (
      ENV.PREF_AGE_MIN_SEC > 0 &&
      ageSec !== null &&
      ageSec < ENV.PREF_AGE_MIN_SEC
    )
      return false;
    if (
      ENV.PREF_AGE_MAX_SEC > 0 &&
      ageSec !== null &&
      ageSec > ENV.PREF_AGE_MAX_SEC
    )
      return false;

    if (prog !== null && Number.isFinite(prog)) {
      if (prog < ENV.PREF_PROGRESS_MIN) return false;
      if (prog > ENV.PREF_PROGRESS_MAX) return false;
    }
  }

  if (ENV.PREF_LIQ_MIN > 0 && liq > 0 && liq < ENV.PREF_LIQ_MIN) return false;
  if (ENV.PREF_VOL_MIN > 0 && vol > 0 && vol < ENV.PREF_VOL_MIN) return false;
  if (ENV.PREF_MCAP_MIN > 0 && mc > 0 && mc < ENV.PREF_MCAP_MIN) return false;
  if (ENV.PREF_MCAP_MAX > 0 && mc > 0 && mc > ENV.PREF_MCAP_MAX) return false;

  if (ENV.PREF_REQUIRE_SOCIALS) {
    if (!hasAnySocial(meta.socials)) return false;
  }

  return true;
}

/* -----------------------------
   Candidate pool ops
----------------------------- */

function addToPool(addrsOrObjs, source) {
  const now = Date.now();

  for (const item of addrsOrObjs || []) {
    const ca = normAddr(typeof item === "string" ? item : item?.ca);
    if (!isAddress(ca)) continue;

    const incomingMeta = typeof item === "object" && item?.meta ? item.meta : {};
    const cur = candidatePool.get(ca);

    if (!cur) {
      candidatePool.set(ca, {
        ts: now,
        sources: new Set([source]),
        meta: incomingMeta || {},
      });
    } else {
      cur.ts = now;
      cur.sources.add(source);

      const prev = cur.meta || {};
      const next = { ...prev, ...(incomingMeta || {}) };

      if (prev.ageSec == null && incomingMeta?.ageSec != null)
        next.ageSec = incomingMeta.ageSec;

      if (clampNum(prev.liquidityUsd) <= 0 && clampNum(incomingMeta?.liquidityUsd) > 0)
        next.liquidityUsd = incomingMeta.liquidityUsd;
      if (clampNum(prev.volumeUsd) <= 0 && clampNum(incomingMeta?.volumeUsd) > 0)
        next.volumeUsd = incomingMeta.volumeUsd;
      if (clampNum(prev.marketCapUsd) <= 0 && clampNum(incomingMeta?.marketCapUsd) > 0)
        next.marketCapUsd = incomingMeta.marketCapUsd;

      if (prev.progress == null && incomingMeta?.progress != null)
        next.progress = incomingMeta.progress;
      if ((!prev.socials || !hasAnySocial(prev.socials)) && incomingMeta?.socials)
        next.socials = incomingMeta.socials;

      cur.meta = next;
    }
  }

  if (candidatePool.size > ENV.POOL_MAX_SIZE) {
    const items = [...candidatePool.entries()].sort((x, y) => x[1].ts - y[1].ts);
    const toDrop = candidatePool.size - ENV.POOL_MAX_SIZE;
    for (let i = 0; i < toDrop; i++) candidatePool.delete(items[i][0]);
  }
}

function prunePool() {
  const ttlMs = ENV.POOL_TTL_MIN * 60 * 1000;
  const now = Date.now();
  for (const [ca, meta] of candidatePool.entries()) {
    if (now - meta.ts > ttlMs) candidatePool.delete(ca);
  }
}

function sampleFromPool(n) {
  const arr = [...candidatePool.entries()].map(([ca, m]) => ({
    ca,
    meta: m?.meta || {},
    sources: m?.sources || new Set(),
    ts: m?.ts || 0,
  }));
  if (!arr.length) return [];

  // rotate so we don't always start with same
  ROTATE_OFFSET = (ROTATE_OFFSET + ENV.ROTATE_STEP) % arr.length;
  const rotated = arr.slice(ROTATE_OFFSET).concat(arr.slice(0, ROTATE_OFFSET));

  // prefilter + seen
  const filtered = rotated.filter((c) => {
    if (!shouldScan(c.ca)) return false;
    return prefilterMeta(c.meta);
  });

  // PRIORITY: Smart Money first
  // We don't hard-force; we bias sampling.
  filtered.sort((a, b) => {
    const aSm = a.sources?.has("sm") ? 1 : 0;
    const bSm = b.sources?.has("sm") ? 1 : 0;
    if (aSm !== bSm) return bSm - aSm;
    // then random
    return Math.random() - 0.5;
  });

  return filtered.slice(0, n);
}

/* -----------------------------
   Telegram
----------------------------- */

async function tgSend(text) {
  const url = `https://api.telegram.org/bot${ENV.TG_BOT_TOKEN}/sendMessage`;
  await axios.post(
    url,
    { chat_id: ENV.TG_CHAT_ID, text, disable_web_page_preview: false },
    { timeout: 8000 }
  );
}

/* -----------------------------
   Dexscreener candidates
----------------------------- */

function dexFreshEnough(pair) {
  const maxAgeMin = ENV.DEX_MAX_AGE_MIN;
  if (!maxAgeMin || maxAgeMin <= 0) return true;
  const createdAt = Number(pair?.pairCreatedAt || 0);
  if (!createdAt) return true;
  return Date.now() - createdAt <= maxAgeMin * 60 * 1000;
}

async function fetchDexscreenerCandidates(chainId = "bsc") {
  const out = [];

  const bank = [
    chainId,
    "pancakeswap",
    "bnb",
    "wbnb",
    "usdt",
    "usdc",
    "meme",
    "memecoin",
    "fairlaunch",
    "ai",
    "agent",
    "bot",
    "launch",
    "pump",
    "cat",
    "dog",
    "pepe",
  ];

  const picks = uniq([chainId, ...bank.sort(() => Math.random() - 0.5).slice(0, 6)]);

  for (const q of picks) {
    try {
      const { data } = await axios.get(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`,
        { timeout: 8000 }
      );

      const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
      for (const pair of pairs) {
        if (
          String(pair?.chainId || "").toLowerCase() === chainId &&
          isAddress(pair?.baseToken?.address) &&
          dexFreshEnough(pair)
        ) {
          const ca = normAddr(pair.baseToken.address);
          out.push({
            ca,
            meta: {
              symbol: pair?.baseToken?.symbol || null,
              name: pair?.baseToken?.name || null,
              ageSec: ageSecFromCreateTimeMs(pair?.pairCreatedAt),
              liquidityUsd: clampNum(pair?.liquidity?.usd),
              volumeUsd: clampNum(pair?.volume?.h24),
              marketCapUsd: clampNum(pair?.fdv),
              progress: null,
              socials: null,
            },
          });
        }
      }
    } catch (e) {
      logDebug("dex search err", q, e?.message || e);
    }
  }

  const endpoints = [
    "https://api.dexscreener.com/token-profiles/latest/v1",
    "https://api.dexscreener.com/token-boosts/latest/v1",
    "https://api.dexscreener.com/token-boosts/top/v1",
  ];

  for (const ep of endpoints) {
    try {
      const { data } = await axios.get(ep, { timeout: 8000 });
      if (!Array.isArray(data)) continue;

      for (const row of data) {
        if (
          String(row?.chainId || "").toLowerCase() === chainId &&
          isAddress(row?.tokenAddress)
        ) {
          out.push({ ca: normAddr(row.tokenAddress), meta: {} });
        }
      }
    } catch (e) {
      logDebug("dex endpoint err", ep, e?.message || e);
    }
  }

  const m = new Map();
  for (const r of out) {
    const ca = normAddr(r?.ca);
    if (!isAddress(ca)) continue;
    if (!m.has(ca)) m.set(ca, r);
    else {
      const prev = m.get(ca);
      const merged = { ...(prev?.meta || {}), ...(r?.meta || {}) };
      m.set(ca, { ca, meta: merged });
    }
  }
  return [...m.values()];
}

/* -----------------------------
   Binance Meme Rush candidates (optional)
----------------------------- */

function parseCsvInts(s, fallback) {
  if (!s) return fallback;
  const arr = String(s)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n));
  return arr.length ? arr : fallback;
}
function envStr(name, def) {
  const v = process.env[name];
  if (v === undefined || v === null || v === "") return def;
  return String(v);
}
function envNum(name, def) {
  const v = process.env[name];
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function numFilterOrUndef(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (s === "" || s === "0") return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return String(n);
}

async function fetchBinanceMemeRushCandidates() {
  const enabled = envStr("BN_MEME_RUSH_ENABLED", "0") === "1";
  if (!enabled) return [];
  if (ENV.CHAIN !== "bsc") return [];

  const url =
    "https://web3.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/pulse/rank/list";

  const limit = Math.min(Math.max(envNum("BN_MEME_RUSH_LIMIT", 120), 1), 200);
  const rankTypes = parseCsvInts(envStr("BN_MEME_RUSH_RANK_TYPES", "30,20,10"), [
    30, 20, 10,
  ]);
  const wantProtocols = parseCsvInts(envStr("BN_MEME_RUSH_PROTOCOLS", ""), []);

  const liqMin = numFilterOrUndef(process.env.BN_MEME_RUSH_LIQ_MIN);
  const volMin = numFilterOrUndef(process.env.BN_MEME_RUSH_VOL_MIN);
  const mcapMax = numFilterOrUndef(process.env.BN_MEME_RUSH_MCAP_MAX);

  const out = [];

  function extractTokens(respData) {
    if (Array.isArray(respData?.data)) return respData.data;
    return (
      (Array.isArray(respData?.data?.tokens) && respData.data.tokens) ||
      (Array.isArray(respData?.data?.tokenList) && respData.data.tokenList) ||
      (Array.isArray(respData?.data?.list) && respData.data.list) ||
      (Array.isArray(respData?.tokens) && respData.tokens) ||
      (Array.isArray(respData?.tokenList) && respData.tokenList) ||
      []
    );
  }

  for (const rankType of rankTypes) {
    try {
      const body = {
        chainId: "56",
        rankType,
        limit,
        protocol: wantProtocols.length ? wantProtocols : undefined,
        liquidityMin: liqMin,
        volumeMin: volMin,
        marketCapMax: mcapMax,
      };

      const resp = await axios.post(url, body, {
        timeout: 15000,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Encoding": "identity",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        },
      });

      const data = resp?.data;
      const tokens = extractTokens(data);

      if (ENV.DEBUG) {
        logDebug("bn resp", {
          rankType,
          code: data?.code,
          msg: data?.message || data?.msg || "",
          tokens: tokens.length,
          protocolFilter: wantProtocols.length ? wantProtocols : null,
          dataIsArray: Array.isArray(data?.data),
        });
      }

      for (const t of tokens) {
        const ca = t?.contractAddress || t?.tokenAddress;
        if (!isAddress(ca)) continue;

        out.push({
          ca: normAddr(ca),
          meta: {
            symbol: t?.symbol || null,
            name: t?.name || null,
            protocol: t?.protocol ?? null,
            progress:
              t?.progress === null || t?.progress === undefined
                ? null
                : Number(t.progress),
            ageSec: ageSecFromCreateTimeMs(t?.createTime),
            marketCapUsd: clampNum(t?.marketCap),
            liquidityUsd: clampNum(t?.liquidity),
            volumeUsd: clampNum(t?.volume),
            socials: t?.socials || null,
          },
        });
      }
    } catch (e) {
      logDebug("bn request failed", rankType, e?.message || e);
    }
  }

  const m = new Map();
  for (const r of out) {
    const ca = normAddr(r?.ca);
    if (!isAddress(ca)) continue;
    if (!m.has(ca)) m.set(ca, r);
    else {
      const prev = m.get(ca);
      const merged = { ...(prev?.meta || {}), ...(r?.meta || {}) };
      m.set(ca, { ca, meta: merged });
    }
  }

  return [...m.values()];
}

/* -----------------------------
   Binance Smart Money signals (optional)
----------------------------- */

async function fetchBinanceSmartMoneySignals() {
  if (!ENV.BN_SMART_MONEY_ENABLED) return [];
  if (ENV.CHAIN !== "bsc") return [];

  const url =
    "https://web3.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/web/signal/smart-money";

  const pageSize = Math.min(Math.max(ENV.BN_SMART_MONEY_PAGE_SIZE, 1), 100);
  const pages = Math.min(Math.max(ENV.BN_SMART_MONEY_PAGES, 1), 10);

  const out = [];
  for (let page = 1; page <= pages; page++) {
    try {
      const body = {
        smartSignalType: ENV.BN_SMART_MONEY_TYPE || "",
        page,
        pageSize,
        chainId: "56",
      };

      const resp = await axios.post(url, body, {
        timeout: 15000,
        headers: {
          "Content-Type": "application/json",
          "Accept-Encoding": "identity",
          Accept: "application/json",
        },
      });

      const data = resp?.data;
      const rows = Array.isArray(data?.data) ? data.data : [];

      if (ENV.DEBUG) {
        logDebug("smartMoney resp", {
          page,
          code: data?.code,
          count: rows.length,
        });
      }

      for (const r of rows) {
        const ca = r?.contractAddress;
        if (!isAddress(ca)) continue;

        const dir = String(r?.direction || "").toLowerCase();

        if (ENV.BN_SMART_MONEY_ONLY_BUY && dir && dir !== "buy") continue;
        if (ENV.BN_SMART_MONEY_REQUIRE_ACTIVE && r?.status && r.status !== "active") continue;

        const smCount = Number(r?.smartMoneyCount || 0);
        if (ENV.BN_SMART_MONEY_MIN_COUNT > 0 && smCount < ENV.BN_SMART_MONEY_MIN_COUNT) continue;

        out.push({
          ca: normAddr(ca),
          meta: {
            symbol: r?.ticker || null,
            name: r?.ticker || null,
            // smart money signal meta
            sm: {
              direction: dir || null,
              smartMoneyCount: smCount || 0,
              status: r?.status || null,
              signalTriggerTime: r?.signalTriggerTime || null,
              alertPrice: r?.alertPrice || null,
              currentPrice: r?.currentPrice || null,
              maxGain: r?.maxGain || null,
              exitRate: r?.exitRate ?? null,
              launchPlatform: r?.launchPlatform || null,
            },
            marketCapUsd: clampNum(r?.currentMarketCap || r?.alertMarketCap),
            // liquidity/volume might be missing
            liquidityUsd: 0,
            volumeUsd: 0,
            ageSec: null,
            progress: null,
            socials: null,
          },
        });
      }
    } catch (e) {
      logDebug("smartMoney request failed", page, e?.message || e);
    }
  }

  // dedup by ca
  const m = new Map();
  for (const r of out) {
    const ca = normAddr(r?.ca);
    if (!isAddress(ca)) continue;
    if (!m.has(ca)) m.set(ca, r);
    else {
      const prev = m.get(ca);
      const merged = { ...(prev?.meta || {}), ...(r?.meta || {}) };
      // merge nested sm if needed
      if (prev?.meta?.sm && r?.meta?.sm) merged.sm = { ...prev.meta.sm, ...r.meta.sm };
      m.set(ca, { ca, meta: merged });
    }
  }
  return [...m.values()];
}

/* -----------------------------
   Four.meme enrich (best-effort)
----------------------------- */

async function fourMemeGetToken(address) {
  const url = `${ENV.FOUR_MEME_API_BASE}/private/token/get?address=${address}`;
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    return { ok: true, data };
  } catch {
    return { ok: false, data: null };
  }
}

/* -----------------------------
   Four.meme on-chain flags
----------------------------- */

const web3 = new Web3(ENV.BSC_RPC_URL);

function selector(sig) {
  return web3.utils.sha3(sig).slice(0, 10);
}
function pad32(addr) {
  return addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}
function wordAt(hexData, index) {
  const clean = (hexData || "0x").replace(/^0x/, "");
  const start = index * 64;
  const chunk = clean.slice(start, start + 64);
  return chunk.length === 64 ? chunk : null;
}
function wordToAddress(word) {
  if (!word) return null;
  return "0x" + word.slice(24);
}
function wordToUint(word) {
  if (!word) return null;
  return BigInt("0x" + word);
}
async function ethCall(to, data) {
  return await web3.eth.call({ to, data });
}

async function fourMemeOnchainFlags(tokenAddress) {
  const TM2 = ENV.FOUR_MEME_TOKEN_MANAGER_2;

  let templateAddr = null;
  let creatorType = null;
  let feeSetting = null;

  try {
    const data = selector("_tokenInfos(address)") + pad32(tokenAddress);
    const ret = await ethCall(TM2, data);
    templateAddr = wordToAddress(wordAt(ret, 0));
    const w1 = wordAt(ret, 1);
    creatorType = w1 ? Number(wordToUint(w1)) : null;
  } catch {}

  try {
    const data = selector("_tokenInfoEx1s(address)") + pad32(tokenAddress);
    const ret = await ethCall(TM2, data);
    const w0 = wordAt(ret, 0);
    feeSetting = w0 ? wordToUint(w0) : null;
  } catch {}

  const isFour =
    templateAddr &&
    templateAddr !== "0x0000000000000000000000000000000000000000";
  const isTaxToken = creatorType === 5;
  const antiSniperOn = feeSetting !== null && feeSetting > 0n;

  return {
    fourMeme: isFour ? "YES" : "NO",
    taxToken: isTaxToken ? "YES" : "NO",
    antiSniper: antiSniperOn ? "ON" : "OFF",
  };
}

/* -----------------------------
   Label helpers (BUY/WATCH/PASS)
----------------------------- */

function signalLabel(score) {
  const s = Number(score || 0);
  const buy = Math.max(ENV.BUY_SCORE, ENV.WATCH_SCORE);
  const watch = Math.min(ENV.BUY_SCORE, ENV.WATCH_SCORE);

  if (s >= buy) return { emoji: "🔥", text: "BUY" };
  if (s >= watch) return { emoji: "👀", text: "WATCH" };
  return { emoji: "✅", text: "PASS" };
}

/* -----------------------------
   Scan + Filter + Send
----------------------------- */

function fmtSmartMoneyLine(sm) {
  if (!sm) return null;
  const parts = [];
  if (sm.direction) parts.push(`DIR=${sm.direction.toUpperCase()}`);
  if (Number(sm.smartMoneyCount || 0) > 0) parts.push(`COUNT=${sm.smartMoneyCount}`);
  if (sm.status) parts.push(`STATUS=${String(sm.status).toUpperCase()}`);
  if (sm.alertPrice) parts.push(`ALERT=$${Number(sm.alertPrice).toFixed(8)}`.replace(/0+$/,"").replace(/\.$/,""));
  if (sm.currentPrice) parts.push(`NOW=$${Number(sm.currentPrice).toFixed(8)}`.replace(/0+$/,"").replace(/\.$/,""));
  if (sm.maxGain) parts.push(`MAXGAIN=${sm.maxGain}%`);
  if (sm.exitRate !== null && sm.exitRate !== undefined) parts.push(`EXIT=${sm.exitRate}%`);
  if (sm.launchPlatform) parts.push(`LP=${sm.launchPlatform}`);
  return parts.length ? `🧠 SMART MONEY: ${parts.join(" | ")}` : "🧠 SMART MONEY: n/a";
}

async function scanAndMaybeSend(candidate) {
  const addr = normAddr(candidate?.ca);
  const meta = candidate?.meta || {};
  const sources = candidate?.sources || new Set();

  if (!isAddress(addr)) return;

  // seen guard
  if (!shouldScan(addr)) return;
  markSeen(addr);

  // dedup send guard
  if (!shouldSend(addr)) {
    logDebug("dedup cooldown skip", addr);
    return;
  }

  const isSM = sources.has("sm");
  const smLine = fmtSmartMoneyLine(meta?.sm || null);

  let json;
  try {
    json = await withTimeout(
      scan(addr, "json"),
      ENV.SCAN_TIMEOUT_MS,
      "scan(json) timeout"
    );
  } catch (e) {
    logDebug("scan(json) failed", addr, e.message);
    return;
  }

  const score = Number(json?.risk?.score ?? 0);
  const policy = String(json?.policy || "").toLowerCase();

  logDebug("scan ok", addr, "score=", score, "policy=", policy);

  // filter: smart money can optionally bypass MIN_SCORE
  if (score < ENV.MIN_SCORE && !(isSM && ENV.BN_SMART_MONEY_FORCE_SEND)) {
    logDebug("filtered: score", addr);
    return;
  }

  let tweetOut = "";
  try {
    const t = await withTimeout(
      scan(addr, "tweet"),
      ENV.SCAN_TIMEOUT_MS,
      "scan(tweet) timeout"
    );
    tweetOut = String(t?.textOutput || "").trim();
  } catch {
    tweetOut = `CA: ${addr}\nScore: ${score}/10\nPolicy: ${policy}`;
  }

  const [fmOff, onchain] = await Promise.all([
    fourMemeGetToken(addr),
    fourMemeOnchainFlags(addr),
  ]);

  const fmYesNo = fmOff.ok || onchain.fourMeme === "YES" ? "YES" : "NO";
  const extraLine = `Four.meme: ${fmYesNo} | TaxToken: ${onchain.taxToken} | AntiSniper: ${onchain.antiSniper}`;

  const age = fmtAge(meta.ageSec ?? null);
  const mc = fmtUsd(meta.marketCapUsd);
  const liq = fmtUsd(meta.liquidityUsd);
  const vol = fmtUsd(meta.volumeUsd);
  const prog =
    meta.progress === null || meta.progress === undefined
      ? "n/a"
      : `${Number(meta.progress).toFixed(2)}%`;

  const srcTag = sources.size ? [...sources].join("+").toUpperCase() : "UNK";
  const sym = meta.symbol ? String(meta.symbol) : "TOKEN";

  const sig = signalLabel(score);

  // English header (Smart Money badge if present)
  const smBadge = isSM ? "🧠 SMART MONEY | " : "";
  const header = `${smBadge}${sig.emoji} ${sig.text} SIGNAL | ${sym} | SRC=${srcTag}`;
  const market = `📊 MCAP: ${mc} | LIQ: ${liq} | VOL24H: ${vol} | AGE: ${age} | PROG: ${prog}`;

  const policyTag = policy === "block" ? "🚫 BLOCK" : "✅ PASS";
  const riskLine = `🧪 RISK: ${policyTag} | Score ${score}/10 | Policy=${policy}`;
  const caLine = `🧾 CA: ${addr}`;

  const smartMoneyBlock = smLine ? `\n${smLine}` : "";
  const finalMsg = `${header}\n${market}\n${riskLine}\n${caLine}${smartMoneyBlock}\n\n${tweetOut}\n\n${extraLine}`;

  try {
    await tgSend(finalMsg);
    markSent(addr);
    markSeen(addr, Date.now() + COOLDOWN_MS);
    logDebug("sent", addr);
  } catch (e) {
    logDebug("telegram failed", e?.response?.status || e?.message || e);
  }
}

/* -----------------------------
   Main tick
----------------------------- */

async function tick() {
  const chainId = ENV.CHAIN;

  const [dexList, bnList, smList] = await Promise.all([
    fetchDexscreenerCandidates(chainId),
    fetchBinanceMemeRushCandidates(),
    fetchBinanceSmartMoneySignals(),
  ]);

  addToPool(dexList, "dex");
  addToPool(bnList, "bn");
  addToPool(smList, "sm");
  prunePool();

  const candidates = sampleFromPool(ENV.MAX_CANDIDATES_PER_TICK);

  if (ENV.DEBUG) {
    console.log("[debug] dexList:", dexList.length);
    console.log("[debug] bnMemeRush:", bnList.length);
    console.log("[debug] smartMoney:", smList.length);
    console.log("[debug] poolSize:", candidatePool.size);
    console.log("[debug] afterPrefilter:", candidates.length);
    console.log("[debug] first10:", candidates.slice(0, 10).map((c) => c.ca));
  }

  for (const c of candidates) {
    await scanAndMaybeSend(c);
    await sleep(ENV.PER_TOKEN_DELAY_MS);
  }
}

/* -----------------------------
   Loop
----------------------------- */

async function main() {
  loadState();
  setInterval(saveState, ENV.STATE_SAVE_EVERY_MS).unref();

  console.log(
    `GROPT Watcher started | chain=${ENV.CHAIN} | interval=${ENV.WATCH_INTERVAL_MS}ms | minScore=${ENV.MIN_SCORE} | buyScore=${ENV.BUY_SCORE} | watchScore=${ENV.WATCH_SCORE} | cooldown=${ENV.COOLDOWN_MIN}m | mode=${ENV.MODE} | prefilter=${ENV.PREFILTER_ENABLED ? "ON" : "OFF"} | smartMoney=${ENV.BN_SMART_MONEY_ENABLED ? "ON" : "OFF"}`
  );

  while (true) {
    const start = Date.now();
    try {
      await tick();
    } catch (e) {
      logDebug("tick error", e?.message || e);
    }
    const took = Date.now() - start;
    const wait = Math.max(ENV.WATCH_INTERVAL_MS - took, 250);
    await sleep(wait);
  }
}

main().catch((e) => {
  console.error("Watcher fatal:", e?.message || e);
  process.exit(1);
});