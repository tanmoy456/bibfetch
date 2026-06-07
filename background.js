/**
 * background.js — Manifest V3 service worker
 *
 * Handles FETCH_BIBTEX messages from content_script.js
 * Fallback chain: Crossref → Semantic Scholar → OpenAlex
 * Missing fields are filled in from whichever source has them.
 */

// ─── Levenshtein similarity ────────────────────────────────────────────────────

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function similarityRatio(a, b) {
  if (!a || !b) return 0;
  const al = a.toLowerCase(), bl = b.toLowerCase();
  return 1 - levenshtein(al, bl) / Math.max(al.length, bl.length);
}

// ─── Fetch with timeout helper ─────────────────────────────────────────────────

async function fetchWithTimeout(url, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Source 1: Crossref ────────────────────────────────────────────────────────

async function queryCrossref({ title, authorRaw, year }) {
  const params = new URLSearchParams({
    "query.bibliographic": [title, authorRaw, year].filter(Boolean).join(" "),
    rows: 3,
    mailto: "scholar-doi-injector@example.com",
  });
  const url = `https://api.crossref.org/works?${params}`;
  console.log("[DOI Injector BG] Crossref:", url);

  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Crossref HTTP ${res.status}`);
  const json = await res.json();
  const items = json?.message?.items ?? [];

  let best = null, bestScore = 0;
  for (const item of items) {
    const score = similarityRatio(title, item?.title?.[0] ?? "");
    if (score > bestScore) { bestScore = score; best = item; }
  }

  if (!best || bestScore < 0.70) return null;

  return {
    doi:       best.DOI || "",
    title:     best.title?.[0] || "",
    authors:   (best.author || []).map(a => [a.family, a.given].filter(Boolean).join(", ")).join(" and "),
    journal:   best["container-title"]?.[0] || "",
    year:      String(best.published?.["date-parts"]?.[0]?.[0] || ""),
    volume:    best.volume || "",
    issue:     best.issue || "",
    pages:     best.page || "",
    publisher: best.publisher || "",
    type:      best.type || "article",
    score:     bestScore,
  };
}

// ─── Source 2: Semantic Scholar ────────────────────────────────────────────────

async function querySemanticScholar(title) {
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(title)}&fields=title,authors,year,journal,volume,publicationVenue,externalIds&limit=3`;
  console.log("[DOI Injector BG] Semantic Scholar:", url);

  try {
    const res = await fetchWithTimeout(url, 6000);
    if (!res.ok) return null;
    const json = await res.json();
    const items = json?.data ?? [];

    let best = null, bestScore = 0;
    for (const item of items) {
      const score = similarityRatio(title, item.title || "");
      if (score > bestScore) { bestScore = score; best = item; }
    }
    if (!best || bestScore < 0.70) return null;

    // Extract pages from publicationVenue or journal if available
    const venue = best.publicationVenue || {};
    return {
      pages:   best.journal?.pages || "",
      volume:  best.journal?.volume || venue.volume || "",
      journal: best.journal?.name || venue.name || "",
      year:    String(best.year || ""),
    };
  } catch (e) {
    console.warn("[DOI Injector BG] Semantic Scholar failed:", e.message);
    return null;
  }
}

// ─── Source 3: OpenAlex ────────────────────────────────────────────────────────

async function queryOpenAlex(title) {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(title)}&per-page=3&select=title,doi,biblio,primary_location,publication_year`;
  console.log("[DOI Injector BG] OpenAlex:", url);

  try {
    const res = await fetchWithTimeout(url, 6000);
    if (!res.ok) return null;
    const json = await res.json();
    const items = json?.results ?? [];

    let best = null, bestScore = 0;
    for (const item of items) {
      const score = similarityRatio(title, item.title || "");
      if (score > bestScore) { bestScore = score; best = item; }
    }
    if (!best || bestScore < 0.70) return null;

    const biblio = best.biblio || {};
    // Pages: first_page-last_page
    const pages = (biblio.first_page && biblio.last_page)
      ? `${biblio.first_page}--${biblio.last_page}`
      : biblio.first_page || "";

    return {
      pages:  pages,
      volume: biblio.volume || "",
      issue:  biblio.issue  || "",
      year:   String(best.publication_year || ""),
    };
  } catch (e) {
    console.warn("[DOI Injector BG] OpenAlex failed:", e.message);
    return null;
  }
}

// ─── Merge metadata from multiple sources ─────────────────────────────────────

function mergeMetadata(primary, ...fallbacks) {
  const merged = { ...primary };
  for (const fb of fallbacks) {
    if (!fb) continue;
    // Only fill in fields that are missing in primary
    for (const [key, val] of Object.entries(fb)) {
      if (!merged[key] && val) {
        merged[key] = val;
        console.log(`[DOI Injector BG] Filled "${key}" from fallback: ${val}`);
      }
    }
  }
  return merged;
}

// ─── Build BibTeX from merged metadata ────────────────────────────────────────

function buildBibtex(meta) {
  const title     = (meta.title || "").replace(/[{}]/g, "");
  const firstAuthor = (meta.authors || "").split(" and ")[0].split(",")[0].toLowerCase().replace(/\s/g, "");
  const firstWord   = title.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "") || "paper";
  const citeKey     = `${firstAuthor}${meta.year || ""}${firstWord}`;

  const type = meta.type === "proceedings-article" ? "inproceedings"
             : meta.type === "book-chapter"         ? "incollection"
             : "article";

  const lines = [`@${type}{${citeKey},`];
  if (meta.doi)       lines.push(`  doi={${meta.doi}},`);
  if (title)          lines.push(`  title={${title}},`);
  if (meta.authors)   lines.push(`  author={${meta.authors}},`);
  if (meta.journal)   lines.push(`  journal={${meta.journal}},`);
  if (meta.volume)    lines.push(`  volume={${meta.volume}},`);
  if (meta.issue)     lines.push(`  number={${meta.issue}},`);
  if (meta.pages)     lines.push(`  pages={${meta.pages}},`);
  if (meta.year)      lines.push(`  year={${meta.year}},`);
  if (meta.publisher) lines.push(`  publisher={${meta.publisher}},`);
  lines.push("}");

  return lines.join("\n");
}

// ─── Main message handler ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "FETCH_BIBTEX") return;

  (async () => {
    try {
      const { title, authorRaw, year } = message;

      // Step 1: Crossref (primary)
      const crossref = await queryCrossref({ title, authorRaw, year });
      if (!crossref) {
        sendResponse({ success: false, error: "No confident match found in Crossref" });
        return;
      }

      let meta = { ...crossref };

      // Step 2: If pages missing, try Semantic Scholar
      if (!meta.pages) {
        console.log("[DOI Injector BG] Pages missing — trying Semantic Scholar...");
        const ss = await querySemanticScholar(title);
        meta = mergeMetadata(meta, ss);
      }

      // Step 3: Still missing pages? Try OpenAlex
      if (!meta.pages) {
        console.log("[DOI Injector BG] Pages still missing — trying OpenAlex...");
        const oa = await queryOpenAlex(title);
        meta = mergeMetadata(meta, oa);
      }

      if (!meta.pages) {
        console.log("[DOI Injector BG] Pages not found in any source — leaving blank.");
      }

      const bibtex = buildBibtex(meta);
      console.log(`[DOI Injector BG] ✅ Final BibTeX (pages: "${meta.pages || "none"}")`);
      sendResponse({ success: true, bibtex, doi: meta.doi, score: crossref.score });

    } catch (err) {
      console.error("[DOI Injector BG] Error:", err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true;
});

// ─── FETCH_ALL_SOURCES handler (for popup) ────────────────────────────────────
// Queries all 3 sources in parallel and returns each result independently
// so popup can display and compare them side by side.

async function buildFromCrossref({ title, authorRaw, year }) {
  try {
    const meta = await queryCrossref({ title, authorRaw: authorRaw || "", year: year || "" });
    if (!meta) return { success: false };
    return { success: true, meta, bibtex: buildBibtex(meta), score: meta.score, doi: meta.doi };
  } catch (e) { return { success: false, error: e.message }; }
}

async function buildFromSemantic(title) {
  try {
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(title)}&fields=title,authors,year,journal,externalIds,publicationVenue&limit=3`;
    const res = await fetchWithTimeout(url, 7000);
    if (!res.ok) return { success: false };
    const json = await res.json();
    const items = json?.data ?? [];

    let best = null, bestScore = 0;
    for (const item of items) {
      const score = similarityRatio(title, item.title || "");
      if (score > bestScore) { bestScore = score; best = item; }
    }
    if (!best || bestScore < 0.65) return { success: false };

    const doi     = best.externalIds?.DOI || "";
    const authors = (best.authors || []).map(a => a.name).join(" and ");
    const journal = best.journal?.name || best.publicationVenue?.name || "";
    const pages   = best.journal?.pages || "";
    const volume  = best.journal?.volume || "";
    const year    = String(best.year || "");

    const meta = { doi, title: best.title, authors, journal, pages, volume, issue: "", year, publisher: "", type: "article" };
    return { success: true, meta, bibtex: buildBibtex(meta), score: bestScore, doi };
  } catch (e) { return { success: false, error: e.message }; }
}

async function buildFromOpenAlex(title) {
  try {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(title)}&per-page=3&select=title,doi,biblio,primary_location,publication_year,authorships`;
    const res = await fetchWithTimeout(url, 7000);
    if (!res.ok) return { success: false };
    const json = await res.json();
    const items = json?.results ?? [];

    let best = null, bestScore = 0;
    for (const item of items) {
      const score = similarityRatio(title, item.title || "");
      if (score > bestScore) { bestScore = score; best = item; }
    }
    if (!best || bestScore < 0.65) return { success: false };

    const biblio  = best.biblio || {};
    const pages   = (biblio.first_page && biblio.last_page) ? `${biblio.first_page}--${biblio.last_page}` : biblio.first_page || "";
    const doi     = (best.doi || "").replace("https://doi.org/", "");
    const authors = (best.authorships || []).map(a => a.author?.display_name || "").filter(Boolean).join(" and ");
    const journal = best.primary_location?.source?.display_name || "";
    const year    = String(best.publication_year || "");

    const meta = { doi, title: best.title, authors, journal, pages, volume: biblio.volume || "", issue: biblio.issue || "", year, publisher: "", type: "article" };
    return { success: true, meta, bibtex: buildBibtex(meta), score: bestScore, doi };
  } catch (e) { return { success: false, error: e.message }; }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "FETCH_ALL_SOURCES") return;

  (async () => {
    const { title } = message;
    const [crossref, semantic, openalex] = await Promise.all([
      buildFromCrossref({ title, authorRaw: "", year: "" }),
      buildFromSemantic(title),
      buildFromOpenAlex(title),
    ]);
    sendResponse({ crossref, semantic, openalex });
  })();

  return true;
});
