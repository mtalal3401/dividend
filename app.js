/* PDF parser tuned for CDC "Dividend / Zakat & Tax Deduction Summary Report"
   It detects each row by lines that start with a date dd/mm/yyyy
   Then extracts last 6 numeric columns:
   securities, gross, tax, jhTax, zakat, net
*/

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.js";

const els = {
  fileInput: document.getElementById("fileInput"),
  btnImport: document.getElementById("btnImport"),
  status: document.getElementById("status"),
  previewBody: document.querySelector("#previewTable tbody"),
  btnRefresh: document.getElementById("btnRefresh"),
  btnClear: document.getElementById("btnClear"),
  btnExport: document.getElementById("btnExport"),
  symbolFilter: document.getElementById("symbolFilter"),
  btnCopy: document.getElementById("btnCopy"),

  kpiGross: document.getElementById("kpiGross"),
  kpiTax: document.getElementById("kpiTax"),
  kpiZakat: document.getElementById("kpiZakat"),
  kpiNet: document.getElementById("kpiNet"),

  summaryText: document.getElementById("summaryText"),

  summaryBody: document.querySelector("#summaryTable tbody"),
  ftGross: document.getElementById("ftGross"),
  ftTax: document.getElementById("ftTax"),
  ftJhTax: document.getElementById("ftJhTax"),
  ftZakat: document.getElementById("ftZakat"),
  ftNet: document.getElementById("ftNet"),
  ftCount: document.getElementById("ftCount"),
};

let selectedFile = null;
let lastExtractedRows = [];

els.fileInput.addEventListener("change", () => {
  selectedFile = els.fileInput.files?.[0] || null;
  els.btnImport.disabled = !selectedFile;
  els.status.textContent = selectedFile
    ? `Selected: ${selectedFile.name}`
    : "No file selected.";
});

els.btnImport.addEventListener("click", async () => {
  if (!selectedFile) return;

  try {
    els.status.textContent = "Reading PDF…";
    const rows = await extractRowsFromPdf(selectedFile);

    if (!rows.length) {
      els.status.textContent = "No rows detected. (If your PDF layout differs, I can adjust the parser.)";
      return;
    }

    lastExtractedRows = rows;
    renderPreview(rows);

    els.status.textContent = `Extracted ${rows.length} rows. Saving to database…`;
    await dbAddMany(rows);

    els.status.textContent = `Imported & saved: ${rows.length} rows. Refreshing summary…`;
    await refreshSummary();
    els.status.textContent = `Done. Imported ${rows.length} rows into the database.`;
  } catch (e) {
    console.error(e);
    els.status.textContent = `Error: ${e?.message || e}`;
  }
});

els.btnRefresh.addEventListener("click", refreshSummary);

els.btnClear.addEventListener("click", async () => {
  if (!confirm("Clear ALL stored dividend rows from the local database?")) return;
  await dbClear();
  els.previewBody.innerHTML = "";
  els.summaryBody.innerHTML = "";
  els.summaryText.textContent = "—";
  setKpis(null);
  els.status.textContent = "Database cleared.";
});

els.btnExport.addEventListener("click", async () => {
  const rows = await dbGetAll();
  if (!rows.length) {
    alert("Database is empty.");
    return;
  }
  const csv = toCsv(rows);
  downloadTextFile(csv, "dividends_db_export.csv", "text/csv");
});

els.symbolFilter.addEventListener("input", refreshSummary);

els.btnCopy.addEventListener("click", async () => {
  const text = els.summaryText.textContent || "";
  if (!text || text === "—") return;
  await navigator.clipboard.writeText(text);
  alert("Summary copied.");
});

function money(n) {
  const x = Number(n || 0);
  return x.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function intFmt(n) {
  const x = Number(n || 0);
  return x.toLocaleString("en-PK", { maximumFractionDigits: 0 });
}

function parseNumber(s) {
  if (s == null) return 0;
  const cleaned = String(s).replace(/,/g, "").trim();
  const val = Number(cleaned);
  return Number.isFinite(val) ? val : 0;
}

function setKpis(totals) {
  if (!totals) {
    els.kpiGross.textContent = "—";
    els.kpiTax.textContent = "—";
    els.kpiZakat.textContent = "—";
    els.kpiNet.textContent = "—";
    return;
  }
  els.kpiGross.textContent = money(totals.gross);
  els.kpiTax.textContent = money(totals.tax + totals.jhTax);
  els.kpiZakat.textContent = money(totals.zakat);
  els.kpiNet.textContent = money(totals.net);
}

function renderPreview(rows) {
  els.previewBody.innerHTML = "";
  rows.slice(0, 15).forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.paymentDate)}</td>
      <td>${escapeHtml(r.issueDate)}</td>
      <td><b>${escapeHtml(r.symbol)}</b></td>
      <td class="num">${intFmt(r.securities)}</td>
      <td class="num">${money(r.gross)}</td>
      <td class="num">${money(r.tax)}</td>
      <td class="num">${money(r.jhTax)}</td>
      <td class="num">${money(r.zakat)}</td>
      <td class="num">${money(r.net)}</td>
    `;
    els.previewBody.appendChild(tr);
  });
}

async function refreshSummary() {
  const all = await dbGetAll();
  const filter = (els.symbolFilter.value || "").trim().toUpperCase();

  const rows = filter
    ? all.filter(r => String(r.symbol || "").toUpperCase().includes(filter))
    : all;

  const grouped = groupBySymbol(rows);
  const totals = calcTotals(rows);

  setKpis(totals);
  renderSummaryTable(grouped, totals);
  renderRequestedText(grouped, totals);
}

function calcTotals(rows) {
  const totals = { gross:0, tax:0, jhTax:0, zakat:0, net:0, count:0 };
  rows.forEach(r => {
    totals.gross += Number(r.gross || 0);
    totals.tax += Number(r.tax || 0);
    totals.jhTax += Number(r.jhTax || 0);
    totals.zakat += Number(r.zakat || 0);
    totals.net += Number(r.net || 0);
    totals.count += 1;
  });
  return totals;
}

function groupBySymbol(rows) {
  const map = new Map();
  rows.forEach(r => {
    const sym = String(r.symbol || "").toUpperCase();
    if (!sym) return;

    if (!map.has(sym)) {
      map.set(sym, { symbol:sym, gross:0, tax:0, jhTax:0, zakat:0, net:0, count:0 });
    }
    const g = map.get(sym);
    g.gross += Number(r.gross || 0);
    g.tax += Number(r.tax || 0);
    g.jhTax += Number(r.jhTax || 0);
    g.zakat += Number(r.zakat || 0);
    g.net += Number(r.net || 0);
    g.count += 1;
  });

  return Array.from(map.values()).sort((a,b) => b.gross - a.gross);
}

function renderSummaryTable(grouped, totals) {
  els.summaryBody.innerHTML = "";

  grouped.forEach(g => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><b>${escapeHtml(g.symbol)}</b></td>
      <td class="num">${money(g.gross)}</td>
      <td class="num">${money(g.tax)}</td>
      <td class="num">${money(g.jhTax)}</td>
      <td class="num">${money(g.zakat)}</td>
      <td class="num">${money(g.net)}</td>
      <td class="num">${intFmt(g.count)}</td>
    `;
    els.summaryBody.appendChild(tr);
  });

  els.ftGross.textContent = money(totals.gross);
  els.ftTax.textContent = money(totals.tax);
  els.ftJhTax.textContent = money(totals.jhTax);
  els.ftZakat.textContent = money(totals.zakat);
  els.ftNet.textContent = money(totals.net);
  els.ftCount.textContent = intFmt(totals.count);
}

function renderRequestedText(grouped, totals) {
  // EXACT requested style
  const lines = [];
  lines.push(`Dividend total: ${money(totals.gross)}`);
  grouped.forEach(g => {
    lines.push(` - ${g.symbol.padEnd(8, " ")} ${money(g.gross)}`);
  });
  lines.push("");
  lines.push(`Total tax deducted: ${money(totals.tax + totals.jhTax)}`);
  lines.push(`Total zakat deducted: ${money(totals.zakat)}`);
  lines.push(`Total dividend earned: ${money(totals.net)}`);

  els.summaryText.textContent = lines.join("\n");
}

async function extractRowsFromPdf(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  // extract text page by page
  const allLines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(it => it.str).join("\n");
    pageText.split(/\r?\n/).forEach(line => {
      const cleaned = line.replace(/\s+/g, " ").trim();
      if (cleaned) allLines.push(cleaned);
    });
  }

  // Build "row blocks" starting with dd/mm/yyyy
  const dateStart = /^\d{2}\/\d{2}\/\d{4}\b/;
  const blocks = [];
  let current = [];

  for (const line of allLines) {
    if (line.startsWith("Total ")) continue;
    if (line.startsWith("Dividend / Zakat")) continue;
    if (line.startsWith("Date and Time Printed")) continue;
    if (line.startsWith("UIN")) continue;
    if (line.startsWith("Name")) continue;
    if (line.startsWith("Security Symbol")) continue;
    if (line.startsWith("Payment Date")) continue;
    if (line.startsWith("* As per Issuer")) continue;
    if (line.startsWith("Disclaimer")) continue;
    if (line.startsWith("By accessing")) continue;
    if (line.startsWith("End of Report")) continue;

    if (dateStart.test(line)) {
      if (current.length) blocks.push(current.join(" "));
      current = [line];
    } else if (current.length) {
      // append wrapped content (symbol name wraps)
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join(" "));

  const rows = [];
  for (const b of blocks) {
    const r = parseCdcBlock(b);
    if (r) rows.push(r);
  }

  return rows;
}

function parseCdcBlock(block) {
  // Example (conceptual):
  // 20/08/2024 20/08/2024 EFERT - ENGRO FERTILIZERS LIMITED 06684-... ... 450 1,350.00 405.00 0.00 0.00 945.00

  // 1) capture two dates at start
  const mDates = block.match(/^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(.*)$/);
  if (!mDates) return null;

  const paymentDate = mDates[1];
  const issueDate = mDates[2];
  const rest = mDates[3];

  // 2) capture last 6 numeric columns:
  // securities (int), gross, tax, jhTax, zakat, net
  // We search from the end, allowing commas and decimals.
  const num = "(?:-?\\d{1,3}(?:,\\d{3})*|-?\\d+)(?:\\.\\d+)?";
  const tailRe = new RegExp(
    "\\s(" + num + ")\\s(" + num + ")\\s(" + num + ")\\s(" + num + ")\\s(" + num + ")\\s(" + num + ")\\s*$"
  );

  const mTail = rest.match(tailRe);
  if (!mTail) return null;

  const securities = parseNumber(mTail[1]);
  const gross = parseNumber(mTail[2]);
  const tax = parseNumber(mTail[3]);
  const jhTax = parseNumber(mTail[4]);
  const zakat = parseNumber(mTail[5]);
  const net = parseNumber(mTail[6]);

  // 3) Symbol is usually right after dates and before " - "
  // We'll take the part before " - " as symbol, and after as company name (until other ids)
  const beforeTail = rest.slice(0, mTail.index).trim();

  // symbol/name extraction
  let symbol = "";
  let secName = "";

  const mSym = beforeTail.match(/^([A-Z0-9]+)\s-\s(.+)$/i);
  if (mSym) {
    symbol = String(mSym[1]).toUpperCase();
    secName = String(mSym[2]).trim();
    // strip trailing account/warrant etc if present (often contains digits-digits or lots of tokens)
    // keep name reasonably clean by cutting at first obvious account pattern
    secName = secName.split(/\s\d{4,}-\d{3,}|\s\d{7,}|\sNONFILER|\sNon\sFiller|\sFILER|\sFiller|\s\d{1,2}%/i)[0].trim();
  } else {
    // fallback: first token as symbol
    const parts = beforeTail.split(" ");
    symbol = String(parts[0] || "").toUpperCase();
    secName = "";
  }

  if (!symbol) return null;

  return {
    paymentDate,
    issueDate,
    symbol,
    secName,
    securities,
    gross,
    tax,
    jhTax,
    zakat,
    net,
    source: "CDC PDF",
    importedAt: new Date().toISOString()
  };
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toCsv(rows) {
  const headers = [
    "paymentDate","issueDate","symbol","secName",
    "securities","gross","tax","jhTax","zakat","net","source","importedAt"
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const line = headers.map(h => csvCell(r[h])).join(",");
    lines.push(line);
  }
  return lines.join("\n");
}

function csvCell(v) {
  const s = String(v ?? "");
  if (/[,"\n]/.test(s)) return `"${s.replaceAll('"','""')}"`;
  return s;
}

function downloadTextFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime || "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
