/**
 * popup.js — BibFetch popup
 * Search by title, compare results from Crossref + Semantic Scholar + OpenAlex,
 * copy any source's BibTeX individually.
 */

const searchInput = document.getElementById("searchInput");
const searchBtn   = document.getElementById("searchBtn");
const statusBar   = document.getElementById("statusBar");
const resultsDiv  = document.getElementById("results");

// ─── Status helpers ────────────────────────────────────────────────────────────

function setStatus(msg, type = "") {
  statusBar.textContent = msg;
  statusBar.className = type;
}

// ─── Score badge colour ────────────────────────────────────────────────────────

function scoreClass(score) {
  if (score >= 0.85) return "score-high";
  if (score >= 0.70) return "score-mid";
  return "score-low";
}

// ─── Metadata pills row ────────────────────────────────────────────────────────

function metaPill(label, value) {
  if (value) {
    return `<div class="meta-pill">${label}: <span>${value}</span></div>`;
  }
  return `<div class="meta-pill missing">${label}: n/a</div>`;
}

// ─── Render a single source card ──────────────────────────────────────────────

function renderSourceCard(source, result) {
  const badges = {
    crossref: { cls: "badge-crossref", label: "Crossref" },
    semantic: { cls: "badge-semantic", label: "Semantic Scholar" },
    openalex: { cls: "badge-openalex", label: "OpenAlex" },
  };
  const badge = badges[source];

  if (!result || !result.success) {
    return `
      <div class="source-card not-found">
        <div class="source-header">
          <span class="source-badge ${badge.cls}">${badge.label}</span>
          <span class="not-found-label">Not found</span>
        </div>
      </div>`;
  }

  const m = result.meta;
  const scoreStr = result.score ? (result.score * 100).toFixed(0) + "% match" : "";

  return `
    <div class="source-card">
      <div class="source-header">
        <span class="source-badge ${badge.cls}">${badge.label}</span>
        <span class="source-score ${scoreClass(result.score || 0)}">${scoreStr}</span>
      </div>
      <div class="meta-row">
        ${metaPill("DOI", m.doi)}
        ${metaPill("Year", m.year)}
        ${metaPill("Vol", m.volume)}
        ${metaPill("Issue", m.issue)}
        ${metaPill("Pages", m.pages)}
      </div>
      <div class="bibtex-block" id="bib-${source}">${escapeHtml(result.bibtex)}</div>
      <button class="copy-btn" data-source="${source}" data-bibtex="${escapeAttr(result.bibtex)}">
        📋 Copy BibTeX
      </button>
    </div>`;
}

function escapeHtml(str) {
  return (str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function escapeAttr(str) {
  return (str || "").replace(/"/g,"&quot;");
}

// ─── Render all source cards ───────────────────────────────────────────────────

function renderResults(data) {
  // Semantic Scholar comes up empty most of the time — show it last
  // so the cards that usually have data aren't pushed down by it.
  resultsDiv.innerHTML =
    renderSourceCard("crossref", data.crossref) +
    renderSourceCard("openalex", data.openalex) +
    renderSourceCard("semantic", data.semantic);

  // Attach copy button listeners
  resultsDiv.querySelectorAll(".copy-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const bibtex = btn.getAttribute("data-bibtex");
      await navigator.clipboard.writeText(bibtex);
      btn.textContent = "✅ Copied!";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = "📋 Copy BibTeX";
        btn.classList.remove("copied");
      }, 2500);
    });
  });
}

// ─── Fetch from all sources via background ────────────────────────────────────

async function fetchAllSources(title) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "FETCH_ALL_SOURCES", title },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(response);
        }
      }
    );
  });
}

// ─── Main search handler ───────────────────────────────────────────────────────

async function doSearch() {
  const title = searchInput.value.trim();
  if (!title) {
    setStatus("Please enter a paper title.", "error");
    return;
  }

  searchBtn.disabled = true;
  searchBtn.textContent = "⏳";
  setStatus("Querying Crossref, Semantic Scholar, OpenAlex…", "loading");
  resultsDiv.innerHTML = "";

  const data = await Promise.race([
    fetchAllSources(title),
    new Promise(resolve => setTimeout(() => resolve(null), 15000))
  ]);

  searchBtn.disabled = false;
  searchBtn.textContent = "Fetch";

  if (!data) {
    setStatus("Request timed out. Check your connection.", "error");
    resultsDiv.innerHTML = `<div class="empty-state"><div class="icon">⏱️</div><p>Request timed out.</p></div>`;
    return;
  }

  const found = [data.crossref, data.semantic, data.openalex].filter(r => r?.success).length;
  setStatus(`Found results from ${found}/3 sources.`, found > 0 ? "success" : "error");
  renderResults(data);
}

// ─── Event listeners ───────────────────────────────────────────────────────────

searchBtn.addEventListener("click", doSearch);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") doSearch();
});

// ─── Pre-fill from the Scholar page that's currently open ─────────────────────
// Ask the content script for "the title on this page" — the cited paper on a
// detail page, or the first result on a search-results page. Pre-fill the
// search box with it (user still clicks Fetch themselves).

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (!tab || !tab.url || !tab.url.includes("scholar.google")) return;

  chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_TITLE" }, (response) => {
    if (chrome.runtime.lastError) return; // content script not present on this page
    if (response && response.title) {
      searchInput.value = response.title;
      setStatus("Title pre-filled from Scholar — click Fetch to search.", "success");
    } else {
      setStatus("Active on Google Scholar — enter a title to search.", "success");
    }
  });
});
