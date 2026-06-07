/**
 * content_script.js
 *
 * Injects a "📋 BibTeX" button on every Google Scholar search result.
 * Clicking it fetches metadata from Crossref directly — no Scholar
 * BibTeX URL needed at all.
 */

// ─── Toast notifications ───────────────────────────────────────────────────────

function showToast(message, color = "#1a73e8", duration = 4000) {
  // Remove any existing toast
  const existing = document.getElementById("doi-injector-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "doi-injector-toast";
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: ${color};
    color: white;
    font-family: monospace;
    font-size: 12px;
    padding: 10px 14px;
    z-index: 99999;
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.25);
    max-width: 340px;
    transition: opacity 0.3s;
  `;
  toast.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()" style="
      background: transparent; border: none; color: white;
      cursor: pointer; font-size: 14px; padding: 0; line-height: 1;
    ">✕</button>
  `;
  document.body.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
}

// ─── Extract paper metadata from Scholar result DOM ───────────────────────────

function extractMetaFromResult(resultEl) {
  // Title — inside h3 > a
  const titleEl = resultEl.querySelector("h3 a, .gs_rt a");
  const title = titleEl ? titleEl.innerText.trim() : null;

  // Authors + journal info — inside .gs_a
  const metaEl = resultEl.querySelector(".gs_a");
  const metaText = metaEl ? metaEl.innerText : "";

  // Authors are before the first " - "
  const parts = metaText.split(" - ");
  const authorRaw = parts[0] ? parts[0].trim() : "";

  // Year — look for 4-digit number in meta text
  const yearMatch = metaText.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : null;

  return { title, authorRaw, year };
}

// ─── Build BibTeX string from Crossref item ────────────────────────────────────

function buildBibtex(item) {
  const doi    = item.DOI || "";
  const title  = (item.title?.[0] || "").replace(/[{}]/g, "");
  const year   = item.published?.["date-parts"]?.[0]?.[0] || "";
  const volume = item.volume || "";
  const issue  = item.issue || "";
  const pages  = item.page || "";
  const publisher = item.publisher || "";

  // Journal name
  const journal = item["container-title"]?.[0] || item["event"]?.name || "";

  // Authors: Last, First and Last, First ...
  const authors = (item.author || [])
    .map(a => [a.family, a.given].filter(Boolean).join(", "))
    .join(" and ");

  // Citation key: firstauthorlastYEARfirsttitleword
  const firstAuthor = (item.author?.[0]?.family || "unknown").toLowerCase().replace(/\s/g, "");
  const firstWord   = title.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "") || "paper";
  const citeKey     = `${firstAuthor}${year}${firstWord}`;

  // Determine entry type
  const type = item.type === "proceedings-article" ? "inproceedings"
             : item.type === "book-chapter"         ? "incollection"
             : "article";

  const lines = [`@${type}{${citeKey},`];
  if (doi)        lines.push(`  doi={${doi}},`);
  if (title)      lines.push(`  title={${title}},`);
  if (authors)    lines.push(`  author={${authors}},`);
  if (journal)    lines.push(`  journal={${journal}},`);
  if (volume)     lines.push(`  volume={${volume}},`);
  if (issue)      lines.push(`  number={${issue}},`);
  if (pages)      lines.push(`  pages={${pages}},`);
  if (year)       lines.push(`  year={${year}},`);
  if (publisher)  lines.push(`  publisher={${publisher}},`);
  lines.push("}");

  return lines.join("\n");
}

// ─── Copy to clipboard ─────────────────────────────────────────────────────────

function copyToClipboard(text) {
  return navigator.clipboard.writeText(text).then(() => true).catch(() => {
    // Fallback for older contexts
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return true;
  });
}

// ─── Handle button click ───────────────────────────────────────────────────────

async function handleCiteClick(btn, resultEl) {
  const { title, authorRaw, year } = extractMetaFromResult(resultEl);

  if (!title) {
    showToast("⚠️ Could not extract title from this result.", "#e8710a");
    return;
  }

  // Update button state
  btn.innerText = "⏳ Fetching...";
  btn.disabled = true;

  showToast("🔍 Looking up DOI...", "#1a73e8", 0);

  try {
    const response = await Promise.race([
      new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: "FETCH_BIBTEX", title, authorRaw, year },
          resolve
        );
      }),
      new Promise((resolve) => setTimeout(() => resolve({ success: false, error: "Request timed out" }), 10000))
    ]);

    if (response && response.success) {
      await copyToClipboard(response.bibtex);
      btn.innerText = "✅ Copied!";
      showToast(`✅ BibTeX copied!<br><code style="font-size:10px">${response.doi}</code>`, "#1a73e8", 5000);
      setTimeout(() => {
        btn.innerText = "📋 BibTeX";
        btn.disabled = false;
      }, 3000);
    } else {
      btn.innerText = "❌ Not found";
      showToast(`⚠️ ${response?.error || "DOI lookup failed"}`, "#e8710a", 5000);
      setTimeout(() => {
        btn.innerText = "📋 BibTeX";
        btn.disabled = false;
      }, 3000);
    }
  } catch (err) {
    btn.innerText = "❌ Error";
    showToast("⚠️ Extension error. Check console.", "#e8710a");
    setTimeout(() => {
      btn.innerText = "📋 BibTeX";
      btn.disabled = false;
    }, 3000);
  }
}

// ─── Inject "📋 BibTeX" button into each Scholar result ──────────────────────

function injectCiteButtons() {
  // Scholar result containers
  const results = document.querySelectorAll(".gs_r.gs_or:not([data-doi-btn])");

  results.forEach((resultEl) => {
    resultEl.setAttribute("data-doi-btn", "true");

    // Action bar where Cited by / Related articles links sit
    const actionBar = resultEl.querySelector(".gs_fl");
    if (!actionBar) return;

    const btn = document.createElement("button");
    btn.innerText = "📋 BibTeX";
    btn.title = "Get BibTeX with DOI via Crossref";
    btn.style.cssText = `
      background: #1a73e8;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 3px 9px;
      font-size: 12px;
      cursor: pointer;
      margin-left: 8px;
      font-family: Arial, sans-serif;
      vertical-align: middle;
      transition: background 0.2s;
    `;
    btn.onmouseover = () => btn.style.background = "#1557b0";
    btn.onmouseout  = () => btn.style.background = "#1a73e8";

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleCiteClick(btn, resultEl);
    });

    actionBar.appendChild(btn);
  });
}

// ─── Watch for dynamically loaded results (pagination, etc.) ──────────────────

const observer = new MutationObserver(() => injectCiteButtons());
observer.observe(document.body, { childList: true, subtree: true });

// Run on initial page load
injectCiteButtons();
console.log("[DOI Injector] Injecting BibTeX buttons on Scholar results...");

// ─── Detail page support (scholar.google.com/citations?view_op=view_citation) ──

function isDetailPage() {
  return window.location.href.includes("view_citation") ||
         window.location.href.includes("citation_for_view");
}

function extractMetaFromDetailPage() {
  // Title is in the <a class="gsc_oci_title_link"> or just <div id="gsc_oci_title">
  const titleEl = document.querySelector("#gsc_oci_title a, .gsc_oci_title_link, #gsc_oci_title");
  const title = titleEl ? titleEl.innerText.trim() : null;

  // Fields are in a table: rows of .gsc_oci_field / .gsc_oci_value
  const fields = {};
  document.querySelectorAll(".gs_scl").forEach(row => {
    const key   = row.querySelector(".gsc_oci_field")?.innerText?.trim().toLowerCase();
    const value = row.querySelector(".gsc_oci_value")?.innerText?.trim();
    if (key && value) fields[key] = value;
  });

  const authorRaw = fields["authors"] || fields["author"] || "";
  const journal   = fields["journal"] || fields["source"] || "";
  const year = (fields["publication date"] || fields["date"] || "").match(/\d{4}/)?.[0] || null;

  return { title, authorRaw, year, journal };
}

function injectDetailPageButton() {
  if (!isDetailPage()) return;
  if (document.getElementById("doi-injector-detail-btn")) return;

  // Wait for title to appear
  const titleEl = document.querySelector("#gsc_oci_title");
  if (!titleEl) return;

  const btn = document.createElement("button");
  btn.id = "doi-injector-detail-btn";
  btn.innerText = "📋 Get BibTeX";
  btn.style.cssText = `
    display: block;
    margin-top: 14px;
    background: #1a73e8;
    color: white;
    border: none;
    border-radius: 5px;
    padding: 7px 16px;
    font-size: 13px;
    cursor: pointer;
    font-family: Arial, sans-serif;
    box-shadow: 0 1px 4px rgba(0,0,0,0.2);
  `;
  btn.onmouseover = () => btn.style.background = "#1557b0";
  btn.onmouseout  = () => btn.style.background = "#1a73e8";

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    const { title, authorRaw, year, journal } = extractMetaFromDetailPage();

    if (!title) {
      showToast("⚠️ Could not extract title from this page.", "#e8710a");
      return;
    }

    btn.innerText = "⏳ Fetching...";
    btn.disabled = true;

    // arXiv fast path: build DOI directly from arXiv ID in journal field
    const arxivMatch = journal.match(/arXiv[:\s]+(\d{4}\.\d{4,5}(?:v\d+)?)/i);
    if (arxivMatch) {
      const arxivId  = arxivMatch[1].replace(/v\d+$/, "");
      const doi      = `10.48550/arXiv.${arxivId}`;
      const authors  = authorRaw.split(",").map(a => a.trim()).join(" and ");
      const citeKey  = (authorRaw.split(",")[0] || "unknown").toLowerCase().replace(/\s/g,"") + (year||"") + title.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g,"");
      const bibtex   = `@misc{${citeKey},
  doi={${doi}},
  title={${title}},
  author={${authors}},
  journal={${journal}},
  year={${year||""}},
  note={arXiv preprint arXiv:${arxivId}}
}`;
      await copyToClipboard(bibtex);
      btn.innerText = "✅ Copied!";
      showToast(`✅ arXiv BibTeX copied!<br><code style="font-size:10px">${doi}</code>`, "#1a73e8", 6000);
      setTimeout(() => { btn.innerText = "📋 Get BibTeX"; btn.disabled = false; }, 3000);
      return;
    }

    showToast("🔍 Looking up on Crossref...", "#1a73e8", 0);

    const response = await Promise.race([
      new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "FETCH_BIBTEX", title, authorRaw, year }, resolve);
      }),
      new Promise((resolve) => setTimeout(() => resolve({ success: false, error: "Request timed out" }), 10000))
    ]);

    if (response && response.success) {
      await copyToClipboard(response.bibtex);
      btn.innerText = "✅ Copied!";
      showToast(`✅ BibTeX copied!<br><code style="font-size:10px">${response.doi}</code>`, "#1a73e8", 6000);
      setTimeout(() => { btn.innerText = "📋 Get BibTeX"; btn.disabled = false; }, 3000);
    } else {
      btn.innerText = "❌ Not found";
      showToast(`⚠️ ${response?.error || "DOI lookup failed"}`, "#e8710a", 5000);
      setTimeout(() => { btn.innerText = "📋 Get BibTeX"; btn.disabled = false; }, 3000);
    }
  });

  // Insert button right below the title
  titleEl.parentNode.insertBefore(btn, titleEl.nextSibling);
}

// Run for detail pages too
if (isDetailPage()) {
  // Use observer since page content loads dynamically
  const detailObserver = new MutationObserver(() => injectDetailPageButton());
  detailObserver.observe(document.body, { childList: true, subtree: true });
  setTimeout(injectDetailPageButton, 500);
}
