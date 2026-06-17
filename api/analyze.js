// Serverless funkce (Vercel) – proxy na Anthropic API.
// API klíč je drženy POUZE na serveru (env ANTHROPIC_API_KEY), nikdy se neposílá do prohlížeče.
// Díky tomu fungují AI analýzy i pro návštěvníky bez účtu Claude.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Chybí ANTHROPIC_API_KEY na serveru." });
    return;
  }

  // Volitelná jednoduchá ochrana proti zneužití endpointu (viz README).
  if (process.env.ANALYZE_TOKEN) {
    const token = req.headers["x-analyze-token"];
    if (token !== process.env.ANALYZE_TOKEN) {
      res.status(401).json({ error: "Neautorizováno" });
      return;
    }
  }

  try {
    const { prompt, search, maxTokens } = req.body || {};
    if (!prompt) {
      res.status(400).json({ error: "Chybí prompt" });
      return;
    }

    const body = {
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: Math.min(Number(maxTokens) || 4096, 8000),
      messages: [{ role: "user", content: String(prompt) }],
    };
    if (search) {
      body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];
    }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    if (!r.ok) {
      res.status(r.status).json({ error: (data && data.error && data.error.message) || "Chyba Anthropic API" });
      return;
    }

    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    res.status(200).json({ text });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
}
