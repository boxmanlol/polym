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
.pk{ --ink:#000000; --panel:#0A0A0A; --panel2:#111111; --line:#252525; --line2:#333333; --text:#EDEDED; --muted:#8F8F8F;
  --accent:#3291FF; --pos:#3FE07C; --neg:#5B5B5B; --warn:#F5A623;
  min-height:100vh; background:var(--ink);
  color:var(--text); font-family:'Geist',system-ui,sans-serif; padding:20px 26px 40px; box-sizing:border-box; }
.pk-wrap{ max-width:1500px; margin:0 auto; }
.pk-eyebrow{ font-size:10px; letter-spacing:.28em; color:var(--muted); text-transform:uppercase; margin:0 0 4px; }
.pk-title{ font-size:19px; font-weight:600; letter-spacing:-.01em; margin:0 0 12px; }
.pk-ta{ width:100%; box-sizing:border-box; background:var(--panel); color:var(--text); border:1px solid var(--line);
  border-radius:8px; padding:9px 11px; font-family:'Geist Mono',monospace; font-size:12px; line-height:1.5; resize:vertical; min-height:58px; }
.pk-ta:focus{ outline:none; border-color:var(--line2); }
.pk-row{ display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:8px 0; }
.pk-label{ font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); }
.pk-input{ background:var(--panel); color:var(--text); border:1px solid var(--line); border-radius:7px;
  padding:7px 10px; font-family:'Geist Mono',monospace; font-size:12.5px; box-sizing:border-box; }
.pk-input:focus{ outline:none; border-color:var(--line2); }
.pk-btn{ background:#0A0A0A; color:var(--text); border:1px solid var(--line2); border-radius:7px; padding:7px 12px;
  cursor:pointer; font-family:'Geist',sans-serif; font-weight:500; font-size:12px; transition:background .15s, border-color .15s, opacity .15s; }
.pk-btn:hover{ background:#191919; border-color:#454545; }
.pk-btn.ghost{ background:transparent; border-color:var(--line); }
.pk-btn.primary{ background:#EDEDED; border-color:#EDEDED; color:#000; font-weight:600; }
.pk-btn.primary:hover{ background:#fff; border-color:#fff; }
.pk-btn:disabled{ opacity:.45; cursor:default; }
.pk-btn.stop{ background:transparent; color:var(--warn); border-color:#4a3a15; }
.pk-slider{ flex:1; min-width:130px; accent-color:var(--text); }
.pk-status{ font-family:'Geist Mono',monospace; font-size:11px; color:var(--muted); }
.pk-err{ color:var(--warn); font-family:'Geist Mono',monospace; font-size:11px; margin:6px 0; }

.pk-matchbar{ display:flex; align-items:center; gap:9px; font-weight:600; font-size:13px; letter-spacing:-.01em; margin:14px 0 8px; }
.pk-matchbar .mut{ color:var(--muted); font-weight:400; }

.pk-mapcard{ border:1px solid var(--line); border-radius:10px; background:var(--panel); overflow:hidden; }
.pk-maphdr{ display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 12px; border-bottom:1px solid var(--line);
  background:var(--panel2); }
.pk-mappill{ font-family:'Geist Mono',monospace; font-size:10px; letter-spacing:.08em; padding:2px 8px; border:1px solid var(--line2); color:var(--muted); border-radius:5px; white-space:nowrap; }
.pk-qlink{ color:var(--muted); font-size:11.5px; text-decoration:none; text-align:right; }
.pk-qlink:hover{ color:var(--text); }

.pk-sides{ display:grid; grid-template-columns:1fr 1fr; }
.pk-side{ padding:12px 13px; }
.pk-side + .pk-side{ border-left:1px solid var(--line); }
.pk-sidehdr{ display:flex; align-items:baseline; gap:8px; margin-bottom:9px; }
.pk-sidename{ font-size:14px; font-weight:600; letter-spacing:-.01em; }
.pk-sidemodel{ font-family:'Geist Mono',monospace; font-size:11px; color:var(--muted); }

.pk-book{ border:1px solid var(--line); border-radius:7px; overflow:hidden; margin-bottom:9px; }
.pk-booktag{ padding:6px 10px; background:var(--panel2); font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
.pk-booktag b{ letter-spacing:0; }
.pk-booktag .mut{ color:var(--muted); font-weight:400; margin-left:5px; }
table.pk-tbl{ width:100%; border-collapse:collapse; font-family:'Geist Mono',monospace; }
.pk-tbl th{ font-size:9px; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); font-weight:400;
  text-align:right; padding:5px 10px; border-top:1px solid var(--line); }
.pk-tbl th:first-child{ text-align:left; }
.pk-tbl td{ font-size:12px; text-align:right; padding:5px 10px; }
.pk-tbl td:first-child{ text-align:left; font-weight:500; }
.pk-tbl tr.dim td{ color:var(--muted); }
.pk-pos{ color:var(--pos); }
.pk-neg{ color:var(--neg); }

.pk-hedge{ margin-top:10px; border:1px solid var(--line); border-radius:10px; background:var(--panel); overflow:hidden; }
.pk-hedgehdr{ display:flex; align-items:center; justify-content:space-between; padding:9px 12px; cursor:pointer; }
.pk-hedgehdr h3{ margin:0; font-size:11.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
.pk-hedgebody{ padding:0 12px 13px; }
.pk-hgrid{ display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; margin-bottom:11px; }
.pk-lockrow{ display:flex; gap:20px; flex-wrap:wrap; padding-top:11px; border-top:1px solid var(--line); }
.pk-lockrow .k{ font-size:9px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
.pk-lockrow .v{ font-family:'Geist Mono',monospace; font-size:17px; font-weight:600; margin-top:3px; }

.pk-foot{ color:var(--muted); font-size:10.5px; line-height:1.6; margin-top:14px; }
.pk-foot code{ font-family:'Geist Mono',monospace; color:#c4c4c4; }
@media (max-width:640px){ .pk-sides{ grid-template-columns:1fr; } .pk-side + .pk-side{ border-left:none; border-top:1px solid var(--line);} }
`;

// ---------- ladder table ----------
function Ladder({ tag, hint, rows, accent }) {
  return (
    <div className="pk-book">
      <div className="pk-booktag"><b style={{ color: accent }}>{tag}</b><span className="mut">{hint}</span></div>
      <table className="pk-tbl">
        <thead>
          <tr>
            <th>{tag === "ASK" ? "Price" : "Bid"}</th><th>Avail.</th><th>Edge</th><th>Shares</th><th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr className="dim"><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} className={r.bet ? "" : "dim"}>
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
function Side({ o, book, bankroll, mult }) {
  const accent = accentFor(o.color);
  const askLv = levels(book && book.asks, "ask", 2);
  const bidLv = levels(book && book.bids, "bid", 3);

  const build = (lv) =>
    lv.map((x) => {
      const calc = levelCalc(x.price, o.prob, bankroll, mult);
      return { price: x.price, avail: x.size, ...calc };
    });

  return (
    <div className="pk-side">
      <div className="pk-sidehdr">
        <span className="pk-sidename" style={{ color: accent }}>{o.name}</span>
        <span className="pk-sidemodel">model {o.prob.toFixed(2)}%</span>
      </div>
      {!book && <div className="pk-status">waiting for order book…</div>}
      {book && <Ladder tag="ASK" hint="buy" rows={build(askLv)} accent={accent} />}
      {book && <Ladder tag="BID" hint="limit buy YES" rows={build(bidLv)} accent={accent} />}
    </div>
  );
}

// ---------- hedge calculator ----------
// Standalone Kelly calculator: punch in your model probability and a Polymarket
// price (the share price IS the odds — c¢ means c% implied), get the bet size.
function KellyCalc({ bankroll, mult }) {
  const [open, setOpen] = useState(false);
  const [prob, setProb] = useState("");   // your win probability %
  const [price, setPrice] = useState(""); // Polymarket price ¢ (= implied prob)

  const p = toNum(prob), c = toNum(price);
  const has = isFinite(p) && p > 0 && p <= 100 && isFinite(c) && c > 0 && c < 100;
  const r = has ? levelCalc(c, p, bankroll, mult) : null;
  const ev = has ? (p - c) / c : 0;          // return on stake per bet
  const decOdds = has ? 100 / c : 0;         // decimal odds the price implies

  return (
    <div className="pk-hedge">
      <div className="pk-hedgehdr" onClick={() => setOpen(!open)}>
        <h3>Kelly Calculator</h3>
        <span style={{ color: "var(--muted)" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div className="pk-hedgebody">
          <div className="pk-hgrid">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="pk-label">Win probability (%)</span>
              <input className="pk-input" style={{ width: 120 }} value={prob} placeholder="e.g. 78" onChange={(e) => setProb(e.target.value)} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="pk-label">Polymarket price (¢)</span>
              <input className="pk-input" style={{ width: 120 }} value={price} placeholder="e.g. 60"
                onChange={(e) => setPrice(e.target.value)} />
            </div>
          </div>
          {has ? (
            r.bet ? (
              <div className="pk-lockrow">
                <div><div className="k">Edge</div><div className="v pk-pos">+{r.edgePP.toFixed(2)} pp</div></div>
                <div><div className="k">Kelly stake</div><div className="v">{money(r.cost)}</div></div>
                <div><div className="k">Shares @ {c}¢</div><div className="v">{ints(r.shares)}</div></div>
                <div><div className="k">EV / bet</div><div className="v pk-pos">+{(ev * 100).toFixed(1)}%</div></div>
                <div><div className="k">Odds</div><div className="v">{decOdds.toFixed(2)}</div></div>
              </div>
            ) : (
              <div className="pk-lockrow">
                <div><div className="k">Edge</div><div className="v pk-neg">{r.edgePP.toFixed(2)} pp</div></div>
                <div><div className="k">Verdict</div><div className="v" style={{ color: "var(--neg)" }}>No bet — price is at/above your probability</div></div>
              </div>
            )
          ) : (
            <div className="pk-status">Enter your win probability and the Polymarket price (both 0–100).</div>
          )}
          <p className="pk-foot" style={{ marginTop: 10 }}>
            The price is the odds: a share at <code>c¢</code> = <code>c%</code> implied. Kelly = <code>(p − price)/(1 − price)</code>, sized with the
            {" "}<b>{money(bankroll)}</b> bankroll and <b>{mult.toFixed(2)}x</b> Kelly from the top controls.
          </p>
        </div>
      )}
    </div>
  );
}

function Hedge({ oppAskCents }) {
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState(7427);
  const [entry, setEntry] = useState(13);      // ¢ you paid for the held side
  const [hedge, setHedge] = useState("");       // ¢ to buy the opposite side

  const hCents = toNum(hedge);
  const hasHedge = isFinite(hCents) && hCents > 0 && hCents < 100;
  const nA = toNum(shares) || 0;
  const eA = (toNum(entry) || 0) / 100;
  const cB = hCents / 100;

  const costA = nA * eA;
  const costB = nA * cB;               // buy same share count on the other side to fully lock
  const locked = nA * (1 - cB) - costA; // identical P/L whichever side wins

  useEffect(() => {
    if (isFinite(oppAskCents) && hedge === "") setHedge(String(oppAskCents));
  }, [oppAskCents]); // eslint-disable-line

  return (
    <div className="pk-hedge">
      <div className="pk-hedgehdr" onClick={() => setOpen(!open)}>
        <h3>Hedge Calculator</h3>
        <span style={{ color: "var(--muted)" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div className="pk-hedgebody">
          <div className="pk-hgrid">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="pk-label">Shares held</span>
              <input className="pk-input" style={{ width: 120 }} value={shares} onChange={(e) => setShares(e.target.value)} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="pk-label">Entry price (¢)</span>
              <input className="pk-input" style={{ width: 100 }} value={entry} onChange={(e) => setEntry(e.target.value)} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="pk-label">Hedge price (¢)</span>
              <input className="pk-input" style={{ width: 100 }} value={hedge} placeholder="opp. ask" onChange={(e) => setHedge(e.target.value)} />
            </div>
          </div>
          {hasHedge ? (
            <div className="pk-lockrow">
              <div><div className="k">Buy on other side</div><div className="v">{ints(nA)} sh</div></div>
              <div><div className="k">Hedge cost</div><div className="v">{money(costB)}</div></div>
              <div><div className="k">Locked P/L (either outcome)</div>
                <div className="v" style={{ color: locked >= 0 ? "var(--pos)" : "var(--warn)" }}>
                  {(locked >= 0 ? "+" : "") + money(locked)}
                </div></div>
            </div>
          ) : (
            <div className="pk-status">Enter the opposite side's price to see the locked profit.</div>
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
    if (r.ok && r.market) { setMarket(r.market); setLive(true); }
    else if (r.ok && r.choices) { setChoices(r.choices); }
    else { setErr(r.error || fallback); }
  };

  // resolve market from the pasted link
  const doLoad = async () => {
    setErr(""); setChoices(null); setBusy(true);
    const r = await loadMarket(mktInput, parsed.outcomes[0] && parsed.outcomes[0].name, parsed.outcomes[1] && parsed.outcomes[1].name, parsed.map);
    setBusy(false);
    apply(r, "Could not load market.");
  };

  // find the market automatically from the two team names
  const doFind = async () => {
    setErr(""); setChoices(null); setBusy(true);
    const a = parsed.outcomes[0] && parsed.outcomes[0].name;
    const b = parsed.outcomes[1] && parsed.outcomes[1].name;
    const r = await autoFind(a, b, parsed.map);
    setBusy(false);
    apply(r, "Auto-search failed.");
  };

  // poll the order books
  const refresh = useCallback(async () => {
    if (!market) return;
    const next = {};
    for (let i = 0; i < market.legs.length; i++) {
      const leg = market.legs[i];
      const b = await fetchBook(leg.tokenId);
      if (b) next[leg.tokenId] = b;
    }
    if (Object.keys(next).length) {
      setBooks(next); setUpdatedAt(Date.now()); setErr("");
    } else {
      setErr("No live order book for this market — it may be resolved/finished, or (in the preview only) blocked by CORS. On Vercel a live match will load.");
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
    if (!leg) { // fall back to index alignment if names don't match
      const idx = parsed.outcomes.findIndex((o) => o.name === name);
      leg = market.legs[idx];
    }
    return leg ? books[leg.tokenId] : null;
  };

  // best play across every book level
  const best = useMemo(() => {
    let top = null;
    for (let i = 0; i < parsed.outcomes.length; i++) {
      const o = parsed.outcomes[i];
      const b = bookFor(o.name);
      const all = [...levels(b && b.asks, "ask", 2), ...levels(b && b.bids, "bid", 3)];
      for (let j = 0; j < all.length; j++) {
        const c = levelCalc(all[j].price, o.prob, bankroll, mult);
        if (c.bet && (!top || c.cost > top.cost)) {
          top = { name: o.name, price: all[j].price, cost: c.cost, color: o.color };
        }
      }
    }
    return top;
  }, [parsed, books, bankroll, mult, market]);

  // opposite side's best ask, to prefill the hedge
  const oppAsk = useMemo(() => {
    if (!best || parsed.outcomes.length < 2) return NaN;
    const other = parsed.outcomes.find((o) => o.name !== best.name);
    const b = other ? bookFor(other.name) : null;
    const lv = levels(b && b.asks, "ask", 1);
    return lv.length ? Math.round(lv[0].price * 10) / 10 : NaN;
  }, [best, books, parsed, market]);

  const secsAgo = updatedAt ? Math.round((now - updatedAt) / 1000) : null;

  return (
    <div className="pk">
      <style>{CSS}</style>
      <div className="pk-wrap">
        <p className="pk-eyebrow">Polymarket · Kelly · live book</p>
        <h1 className="pk-title">Order-book edge finder</h1>

        <textarea className="pk-ta" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />

        <div className="pk-row">
          <button className="pk-btn primary" onClick={doFind} disabled={busy || parsed.outcomes.length < 2}>
            {busy ? "Searching…" : "Find match automatically"}
          </button>
          {market && (live
            ? <button className="pk-btn stop" onClick={() => setLive(false)}>Stop</button>
            : <button className="pk-btn" onClick={() => setLive(true)}>Resume</button>)}
          {market && <span className="pk-status">{secsAgo == null ? "…" : secsAgo + "s ago"}</span>}
        </div>

        <div className="pk-row">
          <span className="pk-label" style={{ whiteSpace: "nowrap" }}>or paste URL</span>
          <input className="pk-input" style={{ flex: 1, minWidth: 200 }} placeholder="https://polymarket.com/market/..."
            value={mktInput} onChange={(e) => setMktInput(e.target.value)} />
          <button className="pk-btn ghost" onClick={doLoad} disabled={busy}>Load</button>
        </div>

        <div className="pk-row">
          <span className="pk-label">Bankroll $</span>
          <input className="pk-input" style={{ width: 130 }} value={bankroll} onChange={(e) => setBankroll(toNum(e.target.value) || 0)} />
          <span className="pk-label">Kelly {mult.toFixed(2)}x{mult === 1 ? " (full)" : mult === 0.5 ? " (half)" : mult === 0.25 ? " (quarter)" : ""}</span>
          <input className="pk-slider" type="range" min="0.05" max="1" step="0.05" value={mult}
            onChange={(e) => setMult(parseFloat(e.target.value))} />
        </div>

        {err && <div className="pk-err">{err}</div>}

        {choices && (
          <div className="pk-err" style={{ color: "var(--muted)" }}>
            Multiple markets in that event — pick one:
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {choices.map((c, i) => (
                <button key={i} className="pk-btn ghost" onClick={() => { setMarket(c); setChoices(null); setLive(true); }}>
                  {c.question}
                </button>
              ))}
            </div>
          </div>
        )}

        {parsed.outcomes.length >= 2 && (
          <>
            <div className="pk-matchbar">
              {parsed.outcomes[0].name} <span className="mut">vs</span> {parsed.outcomes[1].name}
            </div>

            <div className="pk-mapcard">
              <div className="pk-maphdr">
                <span className="pk-mappill">{parsed.map ? parsed.map.toUpperCase() : "MARKET"}</span>
                {market && market.url
                  ? <a className="pk-qlink" href={market.url} target="_blank" rel="noreferrer">{market.question} ↗</a>
                  : <span className="pk-qlink">load a market to pull live prices</span>}
              </div>
              <div className="pk-sides">
                <Side o={parsed.outcomes[0]} book={bookFor(parsed.outcomes[0].name)} bankroll={bankroll} mult={mult} />
                <Side o={parsed.outcomes[1]} book={bookFor(parsed.outcomes[1].name)} bankroll={bankroll} mult={mult} />
              </div>
            </div>

            <KellyCalc bankroll={bankroll} mult={mult} />
            <Hedge oppAskCents={oppAsk} />
          </>
        )}

        <p className="pk-foot">
          Kelly <code>(p − price)/(1 − price)</code> × multiplier · shares = cost ÷ price · ASK = buy now, BID = limit lower. No fees/slippage modeled.
        </p>
      </div>
    </div>
  );
}
