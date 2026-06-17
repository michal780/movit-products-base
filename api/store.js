// Sdílené úložiště přes Redis (Upstash / Vercel KV) – data jsou společná pro VŠECHNY uživatele.
// Po vytvoření Redis databáze ve Vercelu (Storage → Marketplace → Redis) se přihlašovací údaje
// vloží automaticky jako env proměnné: KV_REST_API_URL/KV_REST_API_TOKEN nebo
// UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN. Tato funkce podporuje obě sady.

export default async function handler(req, res) {
  const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!URL || !TOKEN) {
    res.status(503).json({ error: "Sdílené úložiště není nakonfigurováno (chybí Redis env proměnné)." });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const redis = async (cmd) => {
    const r = await fetch(URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmd),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || (d && d.error)) throw new Error((d && d.error) || "Redis HTTP " + r.status);
    return d.result;
  };

  try {
    const p = req.body || {};
    const { action, key } = p;

    if (action === "get") {
      const v = await redis(["GET", key]);
      res.status(200).json(v === null || v === undefined ? null : { key, value: v });
    } else if (action === "set") {
      await redis(["SET", key, p.value]);
      res.status(200).json({ key, value: p.value });
    } else if (action === "delete") {
      await redis(["DEL", key]);
      res.status(200).json({ key, deleted: true });
    } else if (action === "list") {
      const keys = await redis(["KEYS", (p.prefix || "") + "*"]);
      res.status(200).json({ keys: keys || [], prefix: p.prefix || "" });
    } else {
      res.status(400).json({ error: "Neznámá akce" });
    }
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
}
