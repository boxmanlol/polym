import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const POLL_MS = 4000;

const SAMPLE = `Model output: KT vs T1 (Map 1)

KT: Win probability 18.6% (Min odds for +EV: 5.38 / +438)

T1: Win probability 81.4% (Min odds for +EV: 1.23 / -435)`;

// ---------- parse the pasted model block ----------
function parse(text) {
  const lines = text.split("\n");
  let map = "";
  const outcomes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const head = line.match(/Model output:\s*(.+)/i);
    if (head) {
      const mm = head[1].match(/\(([^)]+)\)/);
      if (mm) map = mm[1];
      continue;
    }
    if (/win probability/i.test(line)) {
      const pm = line.match(/([\d.]+)\s*%/);
      if (!pm) continue;
      let color = "neutral";
      if (line.includes("🔵")) color = "blue";
      else if (line.includes("🔴")) color = "red";
      let name = line.split(":")[0].replace(/[🔵🔴🟢🟡🟠🟣⚪●▪️•]/g, "").trim();
      outcomes.push({ name, prob: parseFloat(pm[1]), color });
    }
  }
  outcomes.forEach((o, i) => { if (o.color === "neutral") o.color = i === 0 ? "blue" : i === 1 ? "red" : "neutral"; });
  return { map, outcomes };
}

// ---------- small helpers ----------
function toNum(str) {
  const n = parseFloat(String(str).replace(/[^\d.]/g, ""));
  return isFinite(n) ? n : NaN;
}
function money(x) {
  if (!isFinite(x)) return "—";
  return "$" + Math.round(x).toLocaleString("en-US");
}
function ints(x) {
  if (!isFinite(x)) return "—";
  return Math.round(x).toLocaleString("en-US");
}
function cents(p) {
  const r = Math.round(p * 10) / 10;
  return (Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)) + "¢";
}
// strip accents so "é"->"e", "ü"->"u" etc. before comparing
function deaccent(str) {
  return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function norm(str) {
  return deaccent(str).toLowerCase().replace(/[^a-z0-9]/g, "");
}
function tokens(str) {
  return deaccent(str).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
// tokens plus digit-stripped variants, so a slug like "bro2" also matches "bro"
function matchToks(str) {
  const base = tokens(str);
  const out = base.slice();
  for (let i = 0; i < base.length; i++) {
    const bare = base[i].replace(/[0-9]+/g, "");
    if (bare && out.indexOf(bare) === -1) out.push(bare);
  }
  return out;
}

// ---- team aliases -------------------------------------------------------
// Every way a team might be written maps to one canonical key. Add teams
// here freely — the first item in each list is just the label; every string
// is treated as an alias. Sponsor prefixes change often, so list them all.
// Names/sponsors drift each split, so edit as rosters change.
const ALIASES = [
  // ===== LCK (Korea) =====
  { key: "T1", a: ["t1", "skt", "sktelecom", "sktt1"] },
  { key: "GENG", a: ["geng", "gen", "gengesports"] },
  { key: "HLE", a: ["hle", "hanwha", "hanwhalife", "hanwhalifeesports"] },
  { key: "DK", a: ["dk", "dplus", "dpluskia", "dwg", "dwgkia", "damwon", "damwongaming"] },
  { key: "KT", a: ["kt", "ktrolster"] },
  { key: "KDF", a: ["kdf", "kwangdong", "freecs", "kwangdongfreecs", "afreeca", "afreecafreecs", "dnf", "dnfreecs", "dnsoopers", "soopers"] },
  { key: "NS", a: ["ns", "nongshim", "redforce", "nongshimredforce", "nsrf"] },
  { key: "DRX", a: ["drx", "kiwoom", "kiwoomdrx", "krx", "dragonx"] },
  { key: "FEARX", a: ["fearx", "fox", "bnkfearx", "bnk", "liivsandbox", "sandbox", "lsb"] },
  { key: "BRION", a: ["brion", "bro", "bro2", "hanjin", "hanjinbrion", "fredit", "freditbrion", "okbrion", "oksavingsbank"] },

  // ===== LPL (China) =====
  { key: "JDG", a: ["jdg", "jdgaming", "jingdong"] },
  { key: "BLG", a: ["blg", "bilibili", "bilibiligaming"] },
  { key: "TES", a: ["tes", "topesports"] },
  { key: "WBG", a: ["wbg", "weibo", "weibogaming"] },
  { key: "LNG", a: ["lng", "lngesports"] },
  { key: "AL", a: ["al", "anyoneslegend", "anyone"] },
  { key: "IG", a: ["ig", "invictus", "invictusgaming"] },
  { key: "WE", a: ["teamwe", "we", "xianteamwe", "xian"] },
  { key: "OMG", a: ["omg", "ohmygod"] },
  { key: "FPX", a: ["fpx", "funplus", "funplusphoenix"] },
  { key: "RNG", a: ["rng", "royal", "royalnevergiveup"] },
  { key: "EDG", a: ["edg", "edward", "edwardgaming"] },
  { key: "NIP", a: ["nip", "ninjasinpyjamas"] },
  { key: "TTG", a: ["ttg", "tt", "thundertalk", "thundertalkgaming"] },
  { key: "UP", a: ["ultraprime"] },
  { key: "LGD", a: ["lgd", "lgdgaming"] },
  { key: "RA", a: ["rareatom"] },

  // ===== LEC (Europe) 2026 =====
  { key: "G2", a: ["g2", "g2esports"] },
  { key: "FNC", a: ["fnc", "fnatic"] },
  { key: "GX", a: ["gx", "giantx", "giants"] },
  { key: "KC", a: ["kc", "karmine", "karminecorp"] },
  { key: "VIT", a: ["vit", "vitality", "teamvitality"] },
  { key: "TH", a: ["th", "heretics", "teamheretics"] },
  { key: "SHIFTERS", a: ["shifters", "bds", "teambds"] },        // Shifters = ex-Team BDS
  { key: "MKOI", a: ["mkoi", "movistarkoi", "koi", "madlions", "mdk"] },
  { key: "SK", a: ["sk", "skgaming"] },
  { key: "NAVI", a: ["navi", "natusvincere"] },

  // ===== LCS (North America) 2026 =====
  { key: "TL", a: ["tl", "liquid", "teamliquid"] },
  { key: "C9", a: ["c9", "cloud9"] },
  { key: "FLY", a: ["fly", "flyquest"] },
  { key: "DIG", a: ["dig", "dignitas"] },
  { key: "SR", a: ["shopify", "shopifyrebellion"] },
  { key: "NRG", a: ["nrg", "nrgesports"] },
  { key: "DSG", a: ["dsg", "disguised"] },
  { key: "LYON", a: ["lyon"] },

  // ===== CBLOL / LTA South (Brazil & LatAm) =====
  { key: "LOUD", a: ["loud"] },
  { key: "FUR", a: ["furia"] },
  { key: "PAIN", a: ["pain", "paingaming"] },
  { key: "ISG", a: ["isurus"] },
  { key: "KEYD", a: ["keyd", "vivokeyd", "vivokeydstars", "vks"] },
  { key: "FLUXO", a: ["fluxo"] },
  { key: "RED", a: ["redcanids"] },
  { key: "R7", a: ["r7", "rainbow7", "movistarr7"] },

  // ===== LCP (Asia-Pacific) 2026 =====
  { key: "CFO", a: ["cfo", "ctbc", "flyingoyster", "ctbcflyingoyster"] },
  { key: "GAM", a: ["gam", "gamesports"] },
  { key: "HAWKS", a: ["hawks", "softbank", "fukuoka", "fukuokasoftbankhawks", "shg"] },
  { key: "WHALES", a: ["secretwhales", "whales"] },
  { key: "DFM", a: ["dfm", "detonation", "detonationfocusme"] },
  { key: "MVK", a: ["mvk", "mvkesports", "vikings", "vikingsesports"] },
  { key: "DCG", a: ["dcg", "deepcross", "deepcrossgaming"] },
  { key: "GZ", a: ["gzg", "groundzero", "groundzerogaming"] },
  { key: "PSG", a: ["psg", "psgtalon", "talon"] },

  // ===== LCK CL (Challengers) — academies share the parent org's aliases, so
  // the entries above already match "T1 EA", "Gen.G Global Academy",
  // "Kiwoom DRX Challengers", etc. Add independents here if needed. =====
];

// alias appears as a whole token, or (if long enough) as a substring
function aliasHit(joined, toks, alias) {
  if (toks.indexOf(alias) !== -1) return true;
  if (alias.length >= 5 && joined.indexOf(alias) !== -1) return true;
  return false;
}
// find the alias group for a name; if none, the name is its own group
function groupFor(name) {
  const joined = norm(name);
  const toks = matchToks(name);
  for (let i = 0; i < ALIASES.length; i++) {
    const g = ALIASES[i];
    for (let j = 0; j < g.a.length; j++) {
      if (aliasHit(joined, toks, g.a[j])) return g;
    }
  }
  return { key: joined, a: [joined] };
}
// generic words that shouldn't be used to match two teams together
const FILLER = ["gaming", "esports", "team", "club", "the", "lol", "academy", "challengers", "youth", "pro", "org", "gg", "of", "legends"];
function coreTokens(s) {
  return tokens(s).filter((t) => t.length >= 3 && FILLER.indexOf(t) === -1);
}
function sameTeam(a, b) {
  if (!norm(a) || !norm(b)) return false;
  if (groupFor(a).key === groupFor(b).key) return true;
  const x = norm(a), y = norm(b); // fuzzy fallbacks for teams not in the list
  if (x.length >= 3 && (x.includes(y) || y.includes(x))) return true;
  // share a distinctive (5+ char, non-filler) word, e.g. "invictus" in both
  const ax = coreTokens(a), bx = coreTokens(b);
  return ax.some((t) => t.length >= 5 && bx.indexOf(t) !== -1);
}
// does a free-text title/slug mention this team (via any of its aliases)?
function titleHasTeam(title, name) {
  const joined = norm(title), toks = matchToks(title);
  const g = groupFor(name);
  for (let j = 0; j < g.a.length; j++) {
    if (aliasHit(joined, toks, g.a[j])) return true;
  }
  return false;
}
function accentFor(color) {
  if (color === "blue") return "#3291FF";
  if (color === "red") return "#FF6166";
  return "#EDEDED";
}
function parseMaybeJson(x) {
  if (Array.isArray(x)) return x;
  try { return JSON.parse(x); } catch (e) { return []; }
}

async function getJson(url) {
  try {
    // On Vercel, go through our own /api/poly proxy so the browser never
    // talks to Polymarket directly (that's what avoids the CORS error).
    const proxied = "/api/poly?url=" + encodeURIComponent(url);
    const res = await fetch(proxied);
    if (!res.ok) return { ok: false, error: "HTTP " + res.status };
    const data = await res.json();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// ---------- Kelly at one book level ----------
function levelCalc(priceCents, prob, bankroll, mult) {
  const p = prob / 100;
  const c = priceCents / 100;
  const edge = p - c;                              // in probability terms
  const f = c < 1 ? Math.max(0, (p - c) / (1 - c)) * mult : 0;
  const cost = bankroll * f;
  const shares = c > 0 ? cost / c : 0;
  return { edgePP: edge * 100, cost, shares, bet: edge > 0 };
}

// take top N levels of one side of a book, in cents
function levels(arr, side, n) {
  if (!Array.isArray(arr)) return [];
  const out = arr
    .map((x) => ({ price: parseFloat(x.price) * 100, size: parseFloat(x.size) }))
    .filter((x) => isFinite(x.price) && x.price > 0 && x.price < 100);
  out.sort((a, b) => (side === "ask" ? a.price - b.price : b.price - a.price));
  return out.slice(0, n);
}

// ---------- resolve a Polymarket market into { question, url, legs } ----------
function extractSlug(input) {
  const t = input.trim();
  if (!t) return null;
  if (t.includes("polymarket.com")) {
    try {
      const u = new URL(t.startsWith("http") ? t : "https://" + t);
      const parts = u.pathname.split("/").filter(Boolean);
      return { last: parts[parts.length - 1], prev: parts[parts.length - 2] };
    } catch (e) { return { last: t, prev: "" }; }
  }
  return { last: t, prev: "" };
}

function marketToLegs(m) {
  const outcomes = parseMaybeJson(m.outcomes);
  const tokens = parseMaybeJson(m.clobTokenIds);
  const legs = [];
  for (let i = 0; i < Math.min(outcomes.length, tokens.length); i++) {
    legs.push({ outcome: outcomes[i], tokenId: String(tokens[i]) });
  }
  const base = m.question || m.groupItemTitle || "Polymarket market";
  const git = m.groupItemTitle && !new RegExp(m.groupItemTitle, "i").test(base) ? " · " + m.groupItemTitle : "";
  return {
    question: base + git,
    slug: m.slug,
    url: m.slug ? "https://polymarket.com/market/" + m.slug : "",
    legs,
  };
}

// pull a game/map number out of text: "Map 2", "Game 2 Winner", "g2" -> "2".
// Requires a game/map keyword so stray numbers (BO3, "Round 3-4") don't match.
function mapNumOf(str) {
  const m = String(str || "").match(/\b(?:game|map|g|m)\s*\.?\s*(\d+)/i);
  return m ? m[1] : null;
}

// From an event's markets, pick the real "who wins game N" market.
// Filters to team-vs-team WINNER markets (drops Total Kills / First Blood /
// handicaps etc. by looking at the outcomes), then:
//   1) the numbered "Game N Winner",
//   2) else the un-numbered decider ("Game Winner") — this is what a Bo3's
//      last map / a Bo1 collapses into on Polymarket,
//   3) else the series moneyline (final fallback, e.g. Bo1 map 1).
function pickWinnerMarket(ev, N, a, b) {
  if (!ev || !Array.isArray(ev.markets)) return null;
  const outText = (m) => parseMaybeJson(m.outcomes).join(" ");
  const txt = (m) => [m.question, m.groupItemTitle, m.slug].filter(Boolean).join(" ").toLowerCase();
  // team check prefers the outcomes, but falls back to the market's text, since
  // the /events/slug response sometimes omits outcomes/tokens on nested markets.
  const hasTeams = (m) => (!a || !b) ? true : (function () {
    const src = outText(m) || txt(m);
    return titleHasTeam(src, a) && titleHasTeam(src, b);
  })();
  const isHandicap = (m) => /handicap/.test(txt(m)) || /[+-]\d(\.\d)?/.test(outText(m));
  const isProp = (m) => /first\s*blood|kill|dragon|baron|nashor|inhibitor|penta|quadra|tower|turret|elder|herald|odd|even|total|duration|length/.test(txt(m));

  // team-vs-team WINNER markets (require a slug OR tokens so we can still fetch them)
  const cands = ev.markets.filter((m) => (m.slug || m.clobTokenIds) && hasTeams(m) && !isHandicap(m) && !isProp(m));
  if (!cands.length) return null;

  const num = (m) => mapNumOf(txt(m));
  const isWin = (m) => /winner|win game|win map/.test(txt(m));
  return (
    cands.find((m) => num(m) === String(N) && isWin(m)) ||                 // Game N Winner
    cands.find((m) => !num(m) && /game\s*winner|gamewinner|decid/.test(txt(m))) || // decider
    cands.find((m) => /moneyline|match\s*winner|series|win the match/.test(txt(m))) || // series
    cands.find((m) => !num(m)) || null
  );
}

async function loadMarket(input, hintA, hintB, mapHint) {
  const s = extractSlug(input);
  if (!s) return { ok: false, error: "Enter a Polymarket URL or slug." };
  const wantNum = mapNumOf(mapHint);
  const raw = s.last;
  // esports slugs are "lol-<a>-<b>-YYYY-MM-DD[-suffix]"; the event slug is
  // everything up to and including the date. This turns ANY market slug (game,
  // prop, moneyline) into its parent event slug so the winner-picker can run.
  const dm = raw.match(/^(.*?\d{4}-\d{2}-\d{2})/);
  const base = dm ? dm[1] : raw.replace(/-(?:game|map|g|m)\d+$/i, "");

  const tryMarket = async (slug) => {
    const r = await getJson(`${GAMMA}/markets/slug/${encodeURIComponent(slug)}`);
    if (r.ok && r.data && r.data.clobTokenIds) return marketToLegs(r.data);
    return null;
  };
  const getEvent = async (slug) => {
    const r = await getJson(`${GAMMA}/events/slug/${encodeURIComponent(slug)}`);
    return r.ok ? (Array.isArray(r.data) ? r.data[0] : r.data) : null;
  };

  // When a map is specified, read the event and pick the real winner market.
  // This handles Bo1/Bo3/Bo5, the deciding-game "Game Winner", and ignores props.
  // a market is only acceptable if BOTH model teams are among its outcomes
  // (this rejects Yes/No prop markets that a slug guess might resolve to)
  const isTeamMarket = (mkt) => {
    if (!hintA || !hintB) return true;
    const outs = mkt.legs.map((l) => l.outcome).join(" ");
    return titleHasTeam(outs, hintA) && titleHasTeam(outs, hintB);
  };

  if (wantNum) {
    const mk = pickWinnerMarket(await getEvent(base), wantNum, hintA, hintB);
    if (mk) {
      if (mk.clobTokenIds) return { ok: true, market: marketToLegs(mk) };
      if (mk.slug) { const full = await tryMarket(mk.slug); if (full && isTeamMarket(full)) return { ok: true, market: full }; }
    }
    // last-resort direct slug guesses (game-market slug formats vary a little)
    for (const slug of [`${base}-game${wantNum}`, `${base}-game-${wantNum}`, `${base}-g${wantNum}`, `${base}-game-winner`, `${base}-gamewinner`, base]) {
      const m = await tryMarket(slug);
      if (m && isTeamMarket(m)) return { ok: true, market: m };
    }
    return { ok: false, error: `Couldn't find the Game ${wantNum} market for this match. Paste the exact market URL.` };
  }

  // No map specified: load whatever slug was given (game, moneyline, or event).
  const direct = await tryMarket(raw);
  if (direct) return { ok: true, market: direct };

  const ev = await getEvent(base);
  if (ev && Array.isArray(ev.markets)) {
    const usable = ev.markets.filter((m) => m.clobTokenIds);
    if (usable.length === 1) return { ok: true, market: marketToLegs(usable[0]) };
    if (usable.length > 1) {
      const teamed = usable.filter((m) => {
        if (!hintA || !hintB) return true;
        const q = (m.question || "") + " " + (m.groupItemTitle || "") + " " + (m.slug || "");
        return titleHasTeam(q, hintA) && titleHasTeam(q, hintB);
      });
      return { ok: true, choices: (teamed.length ? teamed : usable).map(marketToLegs) };
    }
  }

  return { ok: false, error: "No market found for that link." };
}

// extract the match date from an esports slug -> UTC timestamp (or null)
const DAY_MS = 86400000;
function slugTs(slug) {
  const m = String(slug || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}
function ymd(ts) {
  const d = new Date(ts), p = (n) => String(n).padStart(2, "0");
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
}
async function eventBySlug(slug) {
  const r = await getJson(`${GAMMA}/events/slug/${encodeURIComponent(slug)}`);
  const ev = r.ok ? (Array.isArray(r.data) ? r.data[0] : r.data) : null;
  return ev && Array.isArray(ev.markets) && ev.markets.length ? ev : null;
}
// a readable, Polymarket-friendly search term for a team (e.g. "Xi'an Team WE" -> "teamwe")
function readableTerm(name) {
  const g = groupFor(name);
  const r = g.a.filter((x) => /^[a-z]+$/.test(x) && x.length >= 4)[0]; // first readable alias
  return r || name;
}
// Exact Polymarket slug codes for known teams (from observed markets). When the
// code is known we send just that one, so we can scan a wide date window cheaply.
const SLUG_CODES = {
  T1: "t1", GENG: "gen", HLE: "hle", DK: "dk", KT: "kt", KDF: "dnf", NS: "ns",
  DRX: "drx", FEARX: "fox1", BRION: "bro2",
  JDG: "jdg", BLG: "blg", TES: "tes", WBG: "wbg", LNG: "lng", AL: "al", IG: "ig1",
  WE: "we", OMG: "omg", FPX: "fpx", RNG: "rng", EDG: "edg", NIP: "nip", TTG: "tt",
  UP: "up", LGD: "lgd", RA: "ra", KC: "kc",
};
// Polymarket's slug codes for a team: the exact known code if we have one, else
// the shortest aliases + numbered variants (fox->fox1, bro->bro2, ig->ig1).
function shortCodes(name) {
  const g = groupFor(name);
  if (SLUG_CODES[g.key]) return [SLUG_CODES[g.key]];
  const alpha = g.a.filter((x) => /^[a-z]+$/.test(x) && x.length >= 2 && x.length <= 5).sort((x, y) => x.length - y.length);
  const seed = alpha[0] || norm(name).slice(0, 5);
  const codes = [seed, seed + "1", seed + "2"];
  if (alpha[1] && codes.indexOf(alpha[1]) === -1) codes.push(alpha[1]);
  return codes;
}
// candidate event slugs to fetch directly when search misses (matches are often
// listed several days ahead). Slugs look like "lol-<a>-<b>-YYYY-MM-DD".
function candidateSlugs(a, b, todayTs) {
  const A = shortCodes(a), B = shortCodes(b), out = [];
  const offs = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6, -7, 7, 8, 9, 10]; // delayed + upcoming
  for (const off of offs) {
    const d = ymd(todayTs + off * DAY_MS);
    for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) {
      out.push(`lol-${A[i]}-${B[j]}-${d}`);
      out.push(`lol-${B[j]}-${A[i]}-${d}`);
    }
  }
  return out.slice(0, 80);
}

// Is this event still live? Slugs carry the ORIGINALLY scheduled date, and
// international events (Worlds/MSI) often slip by days, so the slug date alone
// can't decide. Trust Polymarket's own closed/endDate; Polymarket voids matches
// delayed > 7 days, so that's the outer bound on slug age.
const STALE_DAYS = 7;
function isLiveEvent(ev, todayTs) {
  if (!ev) return false;
  if (ev.closed === true) return false;
  const end = Date.parse(ev.endDate || ev.end_date || "");
  if (isFinite(end) && end < Date.now() - 12 * 3600 * 1000) return false;
  const ts = slugTs(ev.slug);
  return ts == null || (ts - todayTs) / DAY_MS >= -STALE_DAYS;
}

// Primary discovery: list Polymarket's live LoL events (tag-filtered, not-closed =
// only current/upcoming) and match locally by team name. No hardcoded codes or
// dates needed — this is what keeps the tool from needing manual updates.
async function discoverEvent(a, b, todayTs) {
  let scanned = 0;
  const scan = (list) => {
    for (let i = 0; i < list.length; i++) {
      const ev = list[i];
      const txt = [ev.title, ev.slug].filter(Boolean).join(" ");
      if (!/\blol\b|league of legends/i.test(txt) && !String(ev.slug || "").startsWith("lol-")) continue;
      scanned++;
      if (!titleHasTeam(txt, a) || !titleHasTeam(txt, b)) continue;
      if (!isLiveEvent(ev, todayTs)) continue; // skip finished rematches
      return ev.slug;
    }
    return null;
  };
  const fetchTags = async (tags, limit) => {
    const results = await Promise.all(
      tags.map((t) => getJson(`${GAMMA}/events?tag_slug=${t}&closed=false&limit=${limit}&order=startDate&ascending=true`))
    );
    let any = false;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.ok && Array.isArray(r.data) && r.data.length) { any = true; const s = scan(r.data); if (s) return { slug: s, any }; }
    }
    return { slug: null, any };
  };

  // one broad query usually covers every LoL league in a single request
  let res = await fetchTags(["league-of-legends"], 100);
  if (res.slug) return { slug: res.slug, scanned };
  // broad tag missed → one parallel round over international + league tags
  // (Worlds/MSI/First Stand events can sit under their own tag)
  res = await fetchTags(["worlds", "lol-worlds", "msi", "first-stand", "esports-world-cup",
    "lpl", "lck", "lec", "lcs", "lcp", "cblol", "lck-challengers-league"], 60);
  if (res.slug) return { slug: res.slug, scanned };
  // light general fallback (single page)
  const g = await getJson(`${GAMMA}/events?closed=false&limit=100&order=startDate&ascending=true`);
  if (g.ok && Array.isArray(g.data)) { const s = scan(g.data); if (s) return { slug: s, scanned }; }
  return { slug: null, scanned };
}

// run one public-search query; return ALL slugs whose text mentions BOTH teams
async function searchBest(query, a, b) {
  const r = await getJson(`${GAMMA}/public-search?q=${encodeURIComponent(query)}&limit_per_type=20`);
  if (!r.ok) return { err: r.error };
  const d = r.data || {};
  const events = Array.isArray(d.events) ? d.events : Array.isArray(d) ? d : [];
  const markets = Array.isArray(d.markets) ? d.markets : [];

  // include nested market names, since an event's own title/slug may only carry
  // cryptic short codes (e.g. "tt", "al").
  const textOf = (obj) => {
    let t = [obj.title, obj.question, obj.groupItemTitle, obj.slug].filter(Boolean).join(" ");
    if (Array.isArray(obj.markets)) {
      t += " " + obj.markets.map((m) => [m.question, m.groupItemTitle, m.slug].filter(Boolean).join(" ")).join(" ");
    }
    return t;
  };
  const teamsMatch = (obj) => titleHasTeam(textOf(obj), a) && titleHasTeam(textOf(obj), b);

  const out = [];
  const add = (list) => {
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o.slug && teamsMatch(o)) out.push({ slug: o.slug, ts: slugTs(o.slug), active: o.closed !== true });
    }
  };
  add(events);
  add(markets);
  return { candidates: out };
}

// search Polymarket by team names, then pick TODAY's / the next upcoming match
async function autoFind(a, b, mapHint) {
  if (!a || !b) return { ok: false, error: "Need two team names from the model output." };
  const now = new Date();
  const todayTs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  // 0) Primary: discover from Polymarket's live LoL event list (no codes/dates).
  const disc = await discoverEvent(a, b, todayTs);
  if (disc.slug) return await loadMarket(disc.slug, a, b, mapHint);
  // rank: today or upcoming (soonest first) beats undated beats past (newest past first)
  const rank = (c) => {
    const live = c.active ? 200000 : 0;            // not-closed beats closed, always
    if (c.ts == null) return live + 1;
    const days = (c.ts - todayTs) / DAY_MS;
    return live + (days >= -0.5 ? 100000 - days : 50000 + days); // nearest date wins
  };

  // Queries: raw names, Polymarket-friendly terms (Xi'an Team WE -> teamwe), and
  // each team alone for recall. Stop once a today/upcoming candidate appears.
  const ra = readableTerm(a), rb = readableTerm(b);
  const queries = [];
  [a + " " + b, ra + " " + rb, ra, rb, a, b].forEach((q) => { if (q && queries.indexOf(q) === -1) queries.push(q); });
  let all = [], firstErr = null;
  for (let i = 0; i < queries.length; i++) {
    const res = await searchBest(queries[i], a, b);
    if (res.err) { firstErr = firstErr || res.err; continue; }
    all = all.concat(res.candidates);
    if (all.some((c) => c.active && c.ts != null && (c.ts - todayTs) / DAY_MS >= -STALE_DAYS)) break;
  }

  const seen = {};
  const uniq = all.filter((c) => (seen[c.slug] ? false : (seen[c.slug] = true)));
  // never auto-load a stale match (e.g. an old EWC game when today's is LCK).
  // repeat matchups happen constantly, so a wrong-date market is a real risk.
  const fresh = uniq.filter((c) => c.ts == null || (c.ts - todayTs) / DAY_MS >= -STALE_DAYS);
  if (fresh.length) {
    fresh.sort((x, y) => rank(y) - rank(x));
    return await loadMarket(fresh[0].slug, a, b, mapHint);
  }

  // Search missed it (common for low-volume upcoming games). Construct the
  // deterministic slug from team codes + date and fetch it directly.
  const cands = candidateSlugs(a, b, todayTs);
  // fetch in parallel batches (closest dates first) so this stays fast
  for (let i = 0; i < cands.length; i += 10) {
    const batch = cands.slice(i, i + 10);
    const evs = await Promise.all(batch.map((s) => eventBySlug(s)));
    for (let k = 0; k < evs.length; k++) {
      const ev = evs[k];
      if (!ev || !isLiveEvent(ev, todayTs)) continue;
      const txt = (ev.title || "") + " " + ev.markets.map((m) => parseMaybeJson(m.outcomes).join(" ") + " " + (m.question || "")).join(" ");
      if (titleHasTeam(txt, a) && titleHasTeam(txt, b)) return await loadMarket(batch[k], a, b, mapHint);
    }
  }

  // Diagnostic so failures are debuggable instead of guessed at.
  const diag = ` [checked ${disc.scanned} live LoL events; tried ${cands[0]}]`;
  if (uniq.length) {
    return { ok: false, error: "Only older " + a + " vs " + b + " matches turned up. Paste the market URL." + diag };
  }
  if (firstErr) return { ok: false, error: "Auto-search unavailable (" + firstErr + ")." + diag + " Paste the market URL." };
  return { ok: false, error: "Couldn't find " + a + " vs " + b + "." + diag + " Paste the market URL." };
}

async function fetchBook(tokenId) {
  const r = await getJson(`${CLOB}/book?token_id=${tokenId}`);
  if (!r.ok) return null;
  return { bids: r.data.bids || [], asks: r.data.asks || [] };
}

// ================= styling =================
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap');
html,body{ margin:0; background:#000; }
*{ box-sizing:border-box; }
.pk{ --bg:#000; --s1:#0a0a0a; --s2:#111111; --s3:#171717; --line:#1f1f1f; --line2:#2e2e2e;
  --text:#ededed; --muted:#8f8f8f; --dim:#5c5c5c; --pos:#3fe07c; --posbg:rgba(63,224,124,.08);
  --neg:#6b6b6b; --warn:#f5a623; --blue:#3291ff; --red:#ff6166;
  min-height:100vh; background:var(--bg); color:var(--text);
  font-family:'Geist',system-ui,sans-serif; font-size:15px; line-height:1.5;
  -webkit-font-smoothing:antialiased; font-feature-settings:"tnum" 1; }
.mono{ font-family:'Geist Mono',monospace; }

/* nav */
.pk-nav{ position:sticky; top:0; z-index:5; background:rgba(0,0,0,.8); backdrop-filter:saturate(180%) blur(12px);
  border-bottom:1px solid var(--line); }
.pk-navin{ max-width:1360px; margin:0 auto; padding:14px 32px; display:flex; align-items:center; gap:14px; }
.pk-logo{ display:flex; align-items:center; gap:10px; font-weight:600; font-size:16px; letter-spacing:-.01em; }
.pk-logo svg{ width:26px; height:26px; }
.pk-navsep{ color:var(--line2); }
.pk-navsub{ color:var(--muted); font-size:14px; }
.pk-navright{ margin-left:auto; display:flex; align-items:center; gap:10px; }
.pk-live{ display:inline-flex; align-items:center; gap:8px; font-size:13px; color:var(--muted);
  border:1px solid var(--line2); border-radius:999px; padding:5px 12px; }
.pk-dot{ width:7px; height:7px; border-radius:50%; background:var(--dim); }
.pk-dot.on{ background:var(--pos); box-shadow:0 0 0 3px rgba(63,224,124,.18); animation:pkp 1.8s ease-in-out infinite; }
@keyframes pkp{ 50%{ opacity:.45; } }
@media (prefers-reduced-motion: reduce){ .pk-dot.on{ animation:none; } }

.pk-main{ max-width:1360px; margin:0 auto; padding:24px 32px 32px; display:flex; flex-direction:column; gap:16px; }

/* cards */
.pk-card{ background:var(--s1); border:1px solid var(--line); border-radius:14px; }
.pk-cardpad{ padding:22px; }
.pk-cardtitle{ font-size:13px; font-weight:500; color:var(--muted); margin:0 0 12px; }

.pk-top{ display:grid; grid-template-columns:minmax(0,1.6fr) minmax(0,1fr); gap:20px; }

/* inputs */
.pk-ta{ width:100%; background:var(--bg); color:var(--text); border:1px solid var(--line2); border-radius:10px;
  padding:14px 16px; font-family:'Geist Mono',monospace; font-size:13.5px; line-height:1.65; resize:vertical; min-height:150px;
  transition:border-color .15s, box-shadow .15s; }
.pk-ta:focus, .pk-input:focus{ outline:none; border-color:#555; box-shadow:0 0 0 3px rgba(255,255,255,.06); }
.pk-input{ background:var(--bg); color:var(--text); border:1px solid var(--line2); border-radius:9px;
  height:42px; padding:0 14px; font-family:'Geist Mono',monospace; font-size:14px; transition:border-color .15s, box-shadow .15s; }
.pk-prefix{ position:relative; display:flex; align-items:center; }
.pk-prefix span{ position:absolute; left:14px; color:var(--muted); font-family:'Geist Mono',monospace; font-size:14px; pointer-events:none; }
.pk-prefix .pk-input{ padding-left:28px; width:100%; }
.pk-row{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.pk-label{ font-size:13px; color:var(--muted); font-weight:500; }

/* buttons */
.pk-btn{ height:42px; padding:0 18px; border-radius:9px; border:1px solid var(--line2); background:var(--s2); color:var(--text);
  font-family:'Geist',sans-serif; font-size:14px; font-weight:500; cursor:pointer; white-space:nowrap;
  transition:background .15s, border-color .15s, opacity .15s, transform .05s; }
.pk-btn:hover{ background:var(--s3); border-color:#444; }
.pk-btn:active{ transform:translateY(1px); }
.pk-btn:disabled{ opacity:.45; cursor:default; }
.pk-btn.primary{ background:#ededed; border-color:#ededed; color:#000; font-weight:600; }
.pk-btn.primary:hover{ background:#fff; border-color:#fff; }
.pk-btn.sm{ height:32px; padding:0 12px; font-size:13px; }
.pk-btn.warn{ color:var(--warn); border-color:#4a3a15; background:transparent; }

/* settings */
.pk-setgrid{ display:flex; flex-direction:column; gap:18px; }
.pk-seg{ display:grid; grid-template-columns:repeat(4,1fr); background:var(--bg); border:1px solid var(--line2); border-radius:9px; padding:3px; gap:3px; }
.pk-seg button{ height:34px; border:0; border-radius:6px; background:transparent; color:var(--muted); font-family:'Geist',sans-serif;
  font-size:13px; font-weight:500; cursor:pointer; transition:background .15s,color .15s; }
.pk-seg button:hover{ color:var(--text); }
.pk-seg button.on{ background:var(--s3); color:var(--text); box-shadow:0 0 0 1px var(--line2) inset; }
.pk-kellyval{ display:flex; align-items:baseline; justify-content:space-between; }
.pk-kellyval b{ font-family:'Geist Mono',monospace; font-size:22px; font-weight:600; letter-spacing:-.02em; }
.pk-slider{ width:100%; accent-color:#ededed; margin:0; }

.pk-msg{ border-radius:10px; padding:12px 16px; font-size:14px; border:1px solid; }
.pk-msg.err{ color:var(--warn); border-color:#3d3117; background:rgba(245,166,35,.06); }
.pk-msg.info{ color:var(--muted); border-color:var(--line2); background:var(--s1); }

/* match strip (compact) */
.pk-match{ display:flex; align-items:center; gap:14px; padding:12px 18px; flex-wrap:wrap; }
.pk-badge{ font-family:'Geist Mono',monospace; font-size:12px; font-weight:500; letter-spacing:.06em; color:var(--text);
  border:1px solid var(--line2); background:var(--s2); border-radius:6px; padding:3px 9px; }
.pk-mt{ font-size:15px; font-weight:600; letter-spacing:-.01em; white-space:nowrap; }
.pk-mt em{ font-style:normal; font-family:'Geist Mono',monospace; font-size:13px; font-weight:500; color:var(--muted); }
.pk-bar{ flex:1; min-width:80px; display:flex; height:4px; border-radius:999px; overflow:hidden; background:var(--s3); gap:2px; }
.pk-bar i{ display:block; height:100%; transition:width .4s ease; }
.pk-qlink{ color:var(--muted); font-size:13px; text-decoration:none; transition:color .15s; margin-left:auto; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:42%; }
.pk-qlink:hover{ color:var(--text); }

/* sides */
.pk-sides{ display:grid; grid-template-columns:1fr 1fr; gap:20px; }
.pk-side{ padding:18px; display:flex; flex-direction:column; gap:12px; }
.pk-sidehdr{ display:flex; align-items:center; justify-content:space-between; gap:10px; }
.pk-sidename{ display:flex; align-items:center; gap:10px; font-size:18px; font-weight:600; letter-spacing:-.015em; }
.pk-sidename i{ width:10px; height:10px; border-radius:3px; }
.pk-pill{ font-family:'Geist Mono',monospace; font-size:12px; font-weight:500; padding:4px 10px; border-radius:999px; white-space:nowrap; }
.pk-pill.pos{ color:var(--pos); background:var(--posbg); box-shadow:0 0 0 1px rgba(63,224,124,.25) inset; }
.pk-pill.neu{ color:var(--muted); background:var(--s2); box-shadow:0 0 0 1px var(--line2) inset; }

.pk-stats{ display:grid; grid-template-columns:repeat(3,1fr); gap:1px; background:var(--line); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
.pk-stat{ background:var(--s1); padding:8px 12px; }
.pk-stat .k{ font-size:12px; color:var(--muted); }
.pk-stat .v{ font-family:'Geist Mono',monospace; font-size:15px; font-weight:600; margin-top:2px; letter-spacing:-.01em; }

.pk-book{ border:1px solid var(--line); border-radius:10px; overflow:hidden; }
.pk-booktag{ display:flex; align-items:center; gap:8px; padding:10px 14px; background:var(--s2); border-bottom:1px solid var(--line); font-size:13px; }
.pk-booktag b{ font-weight:600; letter-spacing:.04em; font-size:12px; }
.pk-booktag .mut{ color:var(--muted); }
table.pk-tbl{ width:100%; border-collapse:collapse; font-family:'Geist Mono',monospace; }
.pk-tbl th{ font-family:'Geist',sans-serif; font-size:12px; color:var(--muted); font-weight:500; text-align:right; padding:9px 14px; border-bottom:1px solid var(--line); }
.pk-tbl th:first-child, .pk-tbl td:first-child{ text-align:left; }
.pk-tbl td{ font-size:15px; text-align:right; padding:11px 14px; border-bottom:1px solid var(--line); }
.pk-tbl tr:last-child td{ border-bottom:0; }
.pk-tbl tbody tr{ transition:background .12s; }
.pk-tbl tbody tr:hover{ background:var(--s2); }
.pk-tbl tr.bet td:first-child{ box-shadow:inset 2px 0 0 var(--pos); font-weight:600; }
.pk-tbl tr.bet{ background:linear-gradient(90deg, rgba(63,224,124,.05), transparent 60%); }
.pk-tbl tr.dim td{ color:var(--dim); }
.pk-pos{ color:var(--pos); }
.pk-neg{ color:var(--neg); }

.pk-skel{ height:14px; border-radius:6px; background:linear-gradient(90deg,var(--s2),var(--s3),var(--s2)); background-size:200% 100%; animation:pks 1.4s linear infinite; }
@keyframes pks{ to{ background-position:-200% 0; } }
.pk-empty{ color:var(--muted); font-size:14px; padding:28px 0; text-align:center; border:1px dashed var(--line2); border-radius:10px; }

/* tools */
.pk-tools{ display:grid; grid-template-columns:1fr 1fr; gap:20px; align-items:start; }
.pk-toolhdr{ display:flex; align-items:center; justify-content:space-between; padding:18px 22px; cursor:pointer; user-select:none; }
.pk-toolhdr h3{ margin:0; font-size:16px; font-weight:600; letter-spacing:-.01em; }
.pk-toolhdr p{ margin:2px 0 0; font-size:13px; color:var(--muted); }
.pk-chev{ width:18px; height:18px; color:var(--muted); transition:transform .2s; }
.pk-chev.open{ transform:rotate(180deg); }
.pk-toolbody{ padding:0 22px 22px; display:flex; flex-direction:column; gap:16px; }
.pk-fields{ display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:12px; }
.pk-field{ display:flex; flex-direction:column; gap:6px; }
.pk-field .pk-input{ width:100%; }
.pk-out{ display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:1px; background:var(--line); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
.pk-out > div{ background:var(--s1); padding:12px 14px; }
.pk-out .k{ font-size:12px; color:var(--muted); }
.pk-out .v{ font-family:'Geist Mono',monospace; font-size:18px; font-weight:600; margin-top:2px; }
.pk-note{ font-size:13px; color:var(--muted); margin:0; line-height:1.6; }
.pk-note code{ font-family:'Geist Mono',monospace; color:#c4c4c4; background:var(--s2); padding:1px 6px; border-radius:5px; font-size:12.5px; }

.pk-foot{ color:var(--dim); font-size:13px; text-align:center; padding:8px 0 4px; }

@media (max-width:980px){
  .pk-top, .pk-sides, .pk-tools{ grid-template-columns:1fr; }
}
@media (max-width:640px){
  .pk-main{ padding:16px; gap:16px; } .pk-navin{ padding:12px 16px; } .pk-navsub, .pk-navsep{ display:none; }
  .pk-qlink{ max-width:100%; margin-left:0; flex-basis:100%; } .pk-tbl td, .pk-tbl th{ padding-left:10px; padding-right:10px; }
}
`;

const Chevron = ({ open }) => (
  <svg className={"pk-chev" + (open ? " open" : "")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
);
const Logo = () => (
  <svg viewBox="0 0 64 64" aria-hidden="true">
    <rect width="64" height="64" rx="14" fill="#111" stroke="#2e2e2e" strokeWidth="2" />
    <rect x="14" y="36" width="9" height="14" rx="2" fill="#5c5c5c" />
    <rect x="27.5" y="26" width="9" height="24" rx="2" fill="#a1a1a1" />
    <rect x="41" y="14" width="9" height="36" rx="2" fill="#ededed" />
  </svg>
);

// ---------- ladder table ----------
function Ladder({ tag, hint, rows, accent }) {
  return (
    <div className="pk-book">
      <div className="pk-booktag"><b style={{ color: accent }}>{tag}</b><span className="mut">{hint}</span></div>
      <table className="pk-tbl">
        <thead>
          <tr><th>{tag === "ASK" ? "Price" : "Bid"}</th><th>Avail.</th><th>Edge</th><th>Shares</th><th>Cost</th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr className="dim"><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} className={r.bet ? "bet" : "dim"}>
              <td>{cents(r.price)}</td>
              <td>{ints(r.avail)}</td>
              <td className={r.bet ? "pk-pos" : "pk-neg"}>{(r.edgePP >= 0 ? "+" : "") + r.edgePP.toFixed(2)}%</td>
              <td>{r.bet ? ints(r.shares) : "—"}</td>
              <td>{r.bet ? money(r.cost) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- one team column ----------
function Side({ o, book, bankroll, mult, loaded }) {
  const accent = accentFor(o.color);
  const askLv = levels(book && book.asks, "ask", 2);
  const bidLv = levels(book && book.bids, "bid", 3);
  const build = (lv) => lv.map((x) => ({ price: x.price, avail: x.size, ...levelCalc(x.price, o.prob, bankroll, mult) }));
  const asks = build(askLv), bids = build(bidLv);

  const bestAsk = asks[0];
  const top = [...asks, ...bids].filter((r) => r.bet).sort((x, y) => y.edgePP - x.edgePP)[0];
  const fair = o.prob;

  return (
    <div className="pk-card pk-side">
      <div className="pk-sidehdr">
        <div className="pk-sidename"><i style={{ background: accent }} />{o.name}</div>
        {book
          ? (top ? <span className="pk-pill pos">+{top.edgePP.toFixed(1)}% edge</span> : <span className="pk-pill neu">No +EV</span>)
          : null}
      </div>

      <div className="pk-stats">
        <div className="pk-stat"><div className="k">Model</div><div className="v">{o.prob.toFixed(2)}%</div></div>
        <div className="pk-stat"><div className="k">Best ask</div><div className="v">{bestAsk ? cents(bestAsk.price) : "—"}</div></div>
        <div className="pk-stat"><div className="k">Max +EV price</div><div className="v">{fair.toFixed(1)}¢</div></div>
      </div>

      {!book && (loaded
        ? <div style={{ display: "flex", flexDirection: "column", gap: 10 }}><div className="pk-skel" /><div className="pk-skel" style={{ width: "70%" }} /><div className="pk-skel" style={{ width: "85%" }} /></div>
        : <div className="pk-empty">Find the match to load the live order book</div>)}
      {book && <Ladder tag="ASK" hint="buy now" rows={asks} accent={accent} />}
      {book && <Ladder tag="BID" hint="limit buy below market" rows={bids} accent={accent} />}
    </div>
  );
}

// Standalone Kelly calculator: punch in your model probability and a Polymarket
// price (the share price IS the odds — c¢ means c% implied), get the bet size.
function KellyCalc({ bankroll, mult }) {
  const [open, setOpen] = useState(true);
  const [prob, setProb] = useState("");
  const [price, setPrice] = useState("");

  const p = toNum(prob), c = toNum(price);
  const has = isFinite(p) && p > 0 && p <= 100 && isFinite(c) && c > 0 && c < 100;
  const r = has ? levelCalc(c, p, bankroll, mult) : null;
  const ev = has ? (p - c) / c : 0;
  const decOdds = has ? 100 / c : 0;

  return (
    <div className="pk-card">
      <div className="pk-toolhdr" onClick={() => setOpen(!open)}>
        <div><h3>Kelly calculator</h3><p>Your probability vs a Polymarket price</p></div>
        <Chevron open={open} />
      </div>
      {open && (
        <div className="pk-toolbody">
          <div className="pk-fields">
            <label className="pk-field"><span className="pk-label">Win probability (%)</span>
              <input className="pk-input" inputMode="decimal" value={prob} placeholder="78" onChange={(e) => setProb(e.target.value)} /></label>
            <label className="pk-field"><span className="pk-label">Polymarket price (¢)</span>
              <input className="pk-input" inputMode="decimal" value={price} placeholder="60" onChange={(e) => setPrice(e.target.value)} /></label>
          </div>
          {has ? (
            r.bet ? (
              <div className="pk-out">
                <div><div className="k">Edge</div><div className="v pk-pos">+{r.edgePP.toFixed(2)}pp</div></div>
                <div><div className="k">Stake</div><div className="v">{money(r.cost)}</div></div>
                <div><div className="k">Shares</div><div className="v">{ints(r.shares)}</div></div>
                <div><div className="k">EV / bet</div><div className="v pk-pos">+{(ev * 100).toFixed(1)}%</div></div>
                <div><div className="k">Dec. odds</div><div className="v">{decOdds.toFixed(2)}</div></div>
              </div>
            ) : (
              <div className="pk-msg info">No bet — {c}¢ is at or above your {p}%. Edge {r.edgePP.toFixed(2)}pp.</div>
            )
          ) : null}
          <p className="pk-note">A share at <code>c¢</code> = <code>c%</code> implied. Sized on <b style={{ color: "var(--text)" }}>{money(bankroll)}</b> at <b style={{ color: "var(--text)" }}>{mult.toFixed(2)}×</b> Kelly.</p>
        </div>
      )}
    </div>
  );
}

function Hedge({ oppAskCents }) {
  const [open, setOpen] = useState(true);
  const [shares, setShares] = useState(7427);
  const [entry, setEntry] = useState(13);
  const [hedge, setHedge] = useState("");

  const hCents = toNum(hedge);
  const hasHedge = isFinite(hCents) && hCents > 0 && hCents < 100;
  const nA = toNum(shares) || 0;
  const eA = (toNum(entry) || 0) / 100;
  const cB = hCents / 100;
  const costA = nA * eA;
  const costB = nA * cB;
  const locked = nA * (1 - cB) - costA;

  useEffect(() => {
    if (isFinite(oppAskCents) && hedge === "") setHedge(String(oppAskCents));
  }, [oppAskCents]); // eslint-disable-line

  return (
    <div className="pk-card">
      <div className="pk-toolhdr" onClick={() => setOpen(!open)}>
        <div><h3>Hedge calculator</h3><p>Lock P/L by buying the other side</p></div>
        <Chevron open={open} />
      </div>
      {open && (
        <div className="pk-toolbody">
          <div className="pk-fields">
            <label className="pk-field"><span className="pk-label">Shares held</span>
              <input className="pk-input" inputMode="decimal" value={shares} onChange={(e) => setShares(e.target.value)} /></label>
            <label className="pk-field"><span className="pk-label">Entry (¢)</span>
              <input className="pk-input" inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} /></label>
            <label className="pk-field"><span className="pk-label">Hedge price (¢)</span>
              <input className="pk-input" inputMode="decimal" value={hedge} placeholder="opp. ask" onChange={(e) => setHedge(e.target.value)} /></label>
          </div>
          {hasHedge ? (
            <div className="pk-out">
              <div><div className="k">Buy other side</div><div className="v">{ints(nA)}</div></div>
              <div><div className="k">Hedge cost</div><div className="v">{money(costB)}</div></div>
              <div><div className="k">Locked P/L</div>
                <div className="v" style={{ color: locked >= 0 ? "var(--pos)" : "var(--warn)" }}>{(locked >= 0 ? "+" : "−") + money(Math.abs(locked))}</div></div>
            </div>
          ) : (
            <p className="pk-note">Enter the opposite side's price to see the locked P/L.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ================= main =================
export default function PolyKellyLive() {
  const [text, setText] = useState(SAMPLE);
  const [bankroll, setBankroll] = useState(15000);
  const [mult, setMult] = useState(1);
  const [mktInput, setMktInput] = useState("");
  const [market, setMarket] = useState(null);
  const [choices, setChoices] = useState(null);
  const [books, setBooks] = useState({});
  const [live, setLive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => parse(text), [text]);
  const timer = useRef(null);

  const apply = (r, fallback) => {
    if (r.ok && r.market) { setMarket(r.market); setBooks({}); setLive(true); }
    else if (r.ok && r.choices) { setChoices(r.choices); }
    else { setErr(r.error || fallback); }
  };

  const doLoad = async () => {
    setErr(""); setChoices(null); setBusy(true);
    const r = await loadMarket(mktInput, parsed.outcomes[0] && parsed.outcomes[0].name, parsed.outcomes[1] && parsed.outcomes[1].name, parsed.map);
    setBusy(false);
    apply(r, "Could not load market.");
  };

  const doFind = async () => {
    setErr(""); setChoices(null); setBusy(true);
    const a = parsed.outcomes[0] && parsed.outcomes[0].name;
    const b = parsed.outcomes[1] && parsed.outcomes[1].name;
    const r = await autoFind(a, b, parsed.map);
    setBusy(false);
    apply(r, "Auto-search failed.");
  };

  const refresh = useCallback(async () => {
    if (!market) return;
    const got = await Promise.all(market.legs.map((leg) => fetchBook(leg.tokenId)));
    const next = {};
    got.forEach((b, i) => { if (b) next[market.legs[i].tokenId] = b; });
    if (Object.keys(next).length) {
      setBooks(next); setUpdatedAt(Date.now()); setErr("");
    } else {
      setErr("No live order book for this market — it may be resolved/finished.");
    }
  }, [market]);

  useEffect(() => {
    if (!market || !live) return;
    refresh();
    timer.current = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer.current);
  }, [market, live, refresh]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const legFor = (name) => (market ? market.legs.find((l) => sameTeam(l.outcome, name)) : null);
  const bookFor = (name) => {
    if (!market) return null;
    let leg = legFor(name);
    if (!leg) {
      const idx = parsed.outcomes.findIndex((o) => o.name === name);
      leg = market.legs[idx];
    }
    return leg ? books[leg.tokenId] : null;
  };

  const best = useMemo(() => {
    let top = null;
    for (let i = 0; i < parsed.outcomes.length; i++) {
      const o = parsed.outcomes[i];
      const b = bookFor(o.name);
      const all = [...levels(b && b.asks, "ask", 2), ...levels(b && b.bids, "bid", 3)];
      for (let j = 0; j < all.length; j++) {
        const c = levelCalc(all[j].price, o.prob, bankroll, mult);
        if (c.bet && (!top || c.cost > top.cost)) top = { name: o.name, price: all[j].price, cost: c.cost, color: o.color };
      }
    }
    return top;
  }, [parsed, books, bankroll, mult, market]);

  const oppAsk = useMemo(() => {
    if (!best || parsed.outcomes.length < 2) return NaN;
    const other = parsed.outcomes.find((o) => o.name !== best.name);
    const b = other ? bookFor(other.name) : null;
    const lv = levels(b && b.asks, "ask", 1);
    return lv.length ? Math.round(lv[0].price * 10) / 10 : NaN;
  }, [best, books, parsed, market]);

  const secsAgo = updatedAt ? Math.round((now - updatedAt) / 1000) : null;
  const A = parsed.outcomes[0], B = parsed.outcomes[1];
  const presets = [["¼", 0.25], ["½", 0.5], ["¾", 0.75], ["Full", 1]];

  return (
    <div className="pk">
      <style>{CSS}</style>

      <nav className="pk-nav">
        <div className="pk-navin">
          <div className="pk-logo"><Logo />Kelly Edge</div>
          <span className="pk-navsep">/</span>
          <span className="pk-navsub">Polymarket order-book edge finder</span>
          <div className="pk-navright">
            {market && (
              <span className="pk-live"><span className={"pk-dot" + (live ? " on" : "")} />
                {live ? (secsAgo == null ? "Connecting" : "Live · " + secsAgo + "s") : "Paused"}</span>
            )}
            {market && (live
              ? <button className="pk-btn sm warn" onClick={() => setLive(false)}>Pause</button>
              : <button className="pk-btn sm" onClick={() => setLive(true)}>Resume</button>)}
          </div>
        </div>
      </nav>

      <main className="pk-main">
        <div className="pk-top">
          <section className="pk-card pk-cardpad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p className="pk-cardtitle" style={{ margin: 0 }}>Model output</p>
            <textarea className="pk-ta" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
              placeholder="Paste the model output block here" />
            <div className="pk-row">
              <button className="pk-btn primary" onClick={doFind} disabled={busy || parsed.outcomes.length < 2}>
                {busy ? "Searching…" : "Find match"}
              </button>
              <input className="pk-input" style={{ flex: 1, minWidth: 220 }} placeholder="or paste a Polymarket URL"
                value={mktInput} onChange={(e) => setMktInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && mktInput.trim()) doLoad(); }} />
              <button className="pk-btn" onClick={doLoad} disabled={busy || !mktInput.trim()}>Load</button>
            </div>
          </section>

          <section className="pk-card pk-cardpad pk-setgrid">
            <label className="pk-field"><span className="pk-label">Bankroll</span>
              <div className="pk-prefix"><span>$</span>
                <input className="pk-input" inputMode="decimal" value={bankroll} onChange={(e) => setBankroll(toNum(e.target.value) || 0)} />
              </div>
            </label>
            <div className="pk-field">
              <div className="pk-kellyval"><span className="pk-label">Kelly fraction</span><b>{mult.toFixed(2)}×</b></div>
              <div className="pk-seg">
                {presets.map(([l, v]) => (
                  <button key={l} className={Math.abs(mult - v) < 1e-9 ? "on" : ""} onClick={() => setMult(v)}>{l}</button>
                ))}
              </div>
              <input className="pk-slider" type="range" min="0.05" max="1" step="0.05" value={mult}
                onChange={(e) => setMult(parseFloat(e.target.value))} />
            </div>
          </section>
        </div>

        {err && <div className="pk-msg err">{err}</div>}

        {choices && (
          <div className="pk-msg info">
            Multiple markets in that event — pick one:
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {choices.map((c, i) => (
                <button key={i} className="pk-btn sm" onClick={() => { setMarket(c); setBooks({}); setChoices(null); setLive(true); }}>{c.question}</button>
              ))}
            </div>
          </div>
        )}

        {A && B ? (
          <>
            <section className="pk-card pk-match">
              <span className="pk-badge">{parsed.map ? parsed.map.toUpperCase() : "MATCH"}</span>
              <span className="pk-mt" style={{ color: accentFor(A.color) }}>{A.name} <em>{A.prob.toFixed(1)}%</em></span>
              <div className="pk-bar">
                <i style={{ width: A.prob + "%", background: accentFor(A.color) }} />
                <i style={{ width: B.prob + "%", background: accentFor(B.color) }} />
              </div>
              <span className="pk-mt" style={{ color: accentFor(B.color) }}><em>{B.prob.toFixed(1)}%</em> {B.name}</span>
              {market && market.url
                ? <a className="pk-qlink" href={market.url} target="_blank" rel="noreferrer">{market.question} ↗</a>
                : <span className="pk-qlink">No market loaded</span>}
            </section>

            <div className="pk-sides">
              <Side o={A} book={bookFor(A.name)} bankroll={bankroll} mult={mult} loaded={!!market} />
              <Side o={B} book={bookFor(B.name)} bankroll={bankroll} mult={mult} loaded={!!market} />
            </div>

            <div className="pk-tools">
              <KellyCalc bankroll={bankroll} mult={mult} />
              <Hedge oppAskCents={oppAsk} />
            </div>
          </>
        ) : (
          <div className="pk-msg info">Couldn't read two teams. Each line should look like <span className="mono">Team: Win probability 38.5%</span>.</div>
        )}

        <p className="pk-foot">Kelly (p − price) / (1 − price) × fraction · ASK = buy now · BID = limit below market · fees & slippage not modeled</p>
      </main>
    </div>
  );
}
