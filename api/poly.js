// Drop this at:  api/poly.js  (project root, next to your Vite app)
// It runs on Vercel's servers, so there's no browser CORS — the frontend
// calls /api/poly?url=... on its own origin, and this function relays the
// request to Polymarket and hands the JSON back.
//
// Only Polymarket read endpoints are allowed, so this can't be abused as an
// open proxy. No API key is needed for public order-book / market data.

const ALLOWED = ["gamma-api.polymarket.com", "clob.polymarket.com"];

export default async function handler(req, res) {
  const target = req.query.url;
  if (!target) {
    res.status(400).json({ error: "Pass ?url=<encoded polymarket url>" });
    return;
  }

  let host;
  try {
    host = new URL(target).hostname;
  } catch (e) {
    res.status(400).json({ error: "Bad url" });
    return;
  }

  if (!ALLOWED.includes(host)) {
    res.status(403).json({ error: "Host not allowed" });
    return;
  }

  try {
    const upstream = await fetch(target, { headers: { accept: "application/json" } });
    const body = await upstream.text();
    // short cache so rapid polling doesn't hammer Polymarket
    res.setHeader("Cache-Control", "s-maxage=2, stale-while-revalidate=4");
    res.status(upstream.status).setHeader("Content-Type", "application/json").send(body);
  } catch (e) {
    res.status(502).json({ error: "Upstream failed: " + String(e.message || e) });
  }
}
