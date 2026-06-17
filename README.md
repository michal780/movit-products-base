# MOVit — Portfolio Console (samostatný web)

Aplikace pro řízení vývoje produktového portfolia MOVit. Tato verze je připravená
k nasazení jako **samostatný web s vlastním backendem**, takže AI analýzy
(konkurence, trendovost vyhledávání, doporučení & SWOT) fungují i pro návštěvníky
**bez účtu Claude**. API klíč je uložený jen na serveru.

## Co je uvnitř
- `src/App.jsx` – celá aplikace (React, jeden soubor).
- `src/main.jsx`, `index.html` – vstupní body.
- `api/analyze.js` – serverless proxy na Anthropic API (drží API klíč na serveru).
- `api/store.js` – serverless sdílené úložiště (Redis) – volitelné, viz níže.
- Perzistence dat: se sdíleným úložištěm (Redis) jsou data **společná pro všechny**;
  bez něj se použije `localStorage` (každý prohlížeč má vlastní data).

## Rychlé nasazení na Vercel (doporučeno, ~5 minut)

1. **Získej API klíč** na https://console.anthropic.com → API Keys.
   Ujisti se, že má účet povolené **web search** (nástroj `web_search`) a kredit –
   každá analýza je jedno volání API s web searchem (placené).
2. Nahraj tuto složku do **GitHub** repozitáře (nebo použij `vercel` CLI z této složky).
3. Na https://vercel.com → **Add New → Project** → naimportuj repozitář.
   Vercel sám rozpozná Vite i složku `api/`.
4. V **Project → Settings → Environment Variables** přidej:
   - `ANTHROPIC_API_KEY` = tvůj klíč
   - (volitelně) `ANTHROPIC_MODEL` = `claude-sonnet-4-6`
5. Klikni **Deploy**. Po dokončení dostaneš veřejnou URL, kterou pošleš kolegům.

### Lokální spuštění
```bash
npm install
cp .env.example .env      # doplň ANTHROPIC_API_KEY
npm i -g vercel
vercel dev                # spustí web i /api/analyze funkci na http://localhost:3000
```
(Samotné `npm run dev` (Vite) spustí jen frontend; serverless funkce `/api/analyze`
potřebuje `vercel dev`, jinak AI analýzy nepojedou.)

## Přihlášení do aplikace
Aplikace má vlastní přihlášení (demo účty):
- `admin` / `admin` – plný přístup (editace, mazání, scoring)
- `nahled` / `nahled` – jen náhled (smí přidat nový produkt)

> Pozn.: toto přihlášení je klientské (slouží k oddělení rolí v UI), ne k zabezpečení dat.

## Sdílení dat mezi uživateli (společná data, historie analýz)
Bez nastavení níže si **každý uživatel ukládá data jen do svého prohlížeče** (localStorage),
takže kolegové navzájem nevidí svoje produkty ani historii analýz. Pokud chceš, aby všichni
sdíleli stejná data, přidej Redis úložiště – je to pár kliknutí a má free tier:

1. Ve Vercelu otevři svůj projekt → záložka **Storage** → **Create Database**
   (nebo „Connect Database") → v **Marketplace** vyber **Redis** (Upstash) → vytvoř ji
   a připoj k tomuto projektu.
2. Vercel sám doplní potřebné env proměnné (`KV_REST_API_URL` a `KV_REST_API_TOKEN`,
   příp. `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`). Nic dalšího nepřidáváš.
3. Klikni **Redeploy** (Deployments → … → Redeploy). Od té chvíle jsou data společná –
   všichni uživatelé vidí stejné produkty, analýzy i historii.

Poznámky:
- Jde o jeden **společný** testovací prostor – co jeden uživatel upraví/smaže, mění se všem
  (poslední uložení vyhrává). Pro testování je to obvykle žádoucí.
- Když Redis nenastavíš, aplikace funguje dál, jen každý vidí jen svá data v daném prohlížeči.

## Zabezpečení a náklady (důležité)
- Endpoint `/api/analyze` je po nasazení veřejný – kdokoli s URL může spouštět analýzy,
  což **stojí kredit** na tvém Anthropic účtu. Pro testovací nasazení doporučuji:
  - **Vercel Deployment Protection** (Project → Settings → Deployment Protection →
    Password/Vercel Authentication) = nejjednodušší způsob, jak web schovat za heslo.
  - Na Anthropic účtu nastav **spend limit**, ať máš strop nákladů.
  - Volitelně proměnná `ANALYZE_TOKEN` (viz `.env.example`) přidá lehkou kontrolu,
    ale token je viditelný v prohlížeči, takže nenahrazuje ochranu heslem.
- `index.html` má `noindex`, aby web nešel do vyhledávačů.

## Alternativa: Netlify
Funguje obdobně – funkci přesuň do `netlify/functions/analyze.js` (stejný kód,
export přes `exports.handler`) a nastav stejnou env proměnnou. Rád dodám variantu pro Netlify.

## Aktualizace aplikace
Když ti v Claude doladím novou verzi `App.jsx`, stačí přepsat `src/App.jsx`,
commitnout a Vercel nasadí novou verzi automaticky.
