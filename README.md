# BibFetch

A Chrome extension that fetches complete BibTeX entries (with DOI, pages, volume, authors) directly from Google Scholar — no rate limits, no broken exports.

## Features

- **📋 One-click BibTeX** injected on every Scholar search result and citation page
- **Multi-source lookup**: Crossref → Semantic Scholar → OpenAlex fallback chain for missing fields
- **arXiv support**: detects preprints and assigns `10.48550/arXiv.*` DOI automatically
- **Compare panel**: popup lets you search any title and compare results from all 3 sources side by side
- **Copy individually**: pick the most complete result and copy it

## How to install (dev mode)

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select this folder
4. The 📚 BibFetch icon appears in your toolbar

## How to use

**Quick copy** — on any Scholar page, click the blue `📋 BibTeX` button on a result → copied to clipboard instantly.

**Compare & search** — click the BibFetch toolbar icon to open the popup:
- If you're on a Scholar page, the search box is pre-filled automatically with that paper's title (the cited paper on a detail page, or the first result on a search page) — just hit **Fetch**
- Otherwise, paste any paper title in the search box → hit Fetch
- See results from Crossref, OpenAlex, Semantic Scholar side by side
- Click **Copy BibTeX** on whichever source has the most complete data

## Sources

| Source | Coverage | Pages |
|--------|---------|-------|
| Crossref | 150M+ papers | Good |
| Semantic Scholar | CS/bio heavy | Good |
| OpenAlex | OA-focused | first–last page |
