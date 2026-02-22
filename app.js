document.addEventListener("DOMContentLoaded", () => {
  const el = {
    fileInput: document.getElementById("fileInput"),
    btnImport: document.getElementById("btnImport"),
    status: document.getElementById("status"),

    previewBody: document.getElementById("previewBody"),
    sumBody: document.getElementById("sumBody"),

    btnRefresh: document.getElementById("btnRefresh"),
    btnExport: document.getElementById("btnExport"),
    btnClear: document.getElementById("btnClear"),

    symbolFilter: document.getElementById("symbolFilter"),
    btnCopy: document.getElementById("btnCopy"),

    kpiGross: document.getElementById("kpiGross"),
    kpiTax: document.getElementById("kpiTax"),
    kpiZakat: document.getElementById("kpiZakat"),
    kpiNet: document.getElementById("kpiNet"),

    summaryText: document.getElementById("summaryText"),

    ftGross: document.getElementById("ftGross"),
    ftTax: document.getElementById("ftTax"),
    ftJhTax: document.getElementById("ftJhTax"),
    ftZakat: document.getElementById("ftZakat"),
    ftNet: document.getElementById("ftNet"),
    ftCount: document.getElementById("ftCount"),
  };

  let selectedFile = null;

  // Configure PDF.js if present
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.js";
  }

  el.fileInput.addEventListener("change", () => {
    selectedFile = el.fileInput.files?.[0] || null;
    el.status.textContent = selectedFile
      ? `Selected: ${selectedFile.name}`
      : "Select a PDF file, then click Import.";
  });

  el.btnImport.addEventListener("click", async () => {
    if (!selectedFile) {
      el.status.textContent = "Please select a PDF first.";
      return;
    }
    if (!window.pdfjsLib) {
      el.status.textContent =
        "PDF.js did not load (CDN blocked). Try disabling adblock, or tell me and I’ll give you an offline bundled build.";
      return;
    }

    try {
      el.status.textContent = "Reading PDF…";
      const rows = await extractRowsFromPdfWithFallback(selectedFile);

      if (!rows.length) {
        el.status.textContent = "No rows detected. If your PDF is scanned (image), it needs OCR.";
        return;
      }

      renderPreview(rows);
      el.status.textContent = `Extracted ${rows.length} rows. Saving to database…`;
      await dbAddMany(rows);

      el.status.textContent = "Saved. Refreshing summary…";
      await refreshSummary();
      el.status.textContent = `Done. Imported ${rows.length} rows.`;
    } catch (e) {
      console.error(e);
      el.status.textContent = `Error: ${e?.message || e}`;
    }
  });

  el.btnRefresh.addEventListener("click", refreshSummary);
  el.symbolFilter.addEventListener("input", refreshSummary);

  el.btnClear.addEventListener("click", async () => {
    if (!confirm("Clear ALL stored rows from the local database?")) return;
    await dbClear();
    el.previewBody.innerHTML = "";
    el.sumBody.innerHTML = "";
    el.summaryText.textContent = "—";
    setKpis(null);
    el.status.textContent = "Database cleared.";
  });

  el.btnExport.addEventListener("click", async () => {
    const rows = await dbGetAll();
    if (!rows.length) return alert("Database is empty.");
    downloadTextFile(toCsv(rows), "dividends_db_export.csv", "text/csv");
  });

  el.btnCopy.addEventListener("click", async () => {
    const text = el.summaryText.textContent || "";
    if (!text || text === "—") return;
    await navigator.clipboard.writeText(text);
    alert("Summary copied.");
  });

  // ---------- helpers ----------
  function parseNumber(x) {
    const s = String(x ?? "").replace(/,/g, "").trim();
    const v = Number(s);
    return Number.isFinite(v) ? v : 0;
  }
  function money(n) {
    return Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function intFmt(n) {
    return Number(n || 0).toLocaleString("en-PK", { maximumFractionDigits: 0 });
  }
  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ---------- PDF extraction ----------
  async function extractRowsFromPdfWithFallback(file) {
    try {
      return await extractRowsFromPdf(file);
    } catch (e) {
      console.warn("Worker failed; retrying without worker…", e);
      pdfjsLib.disableWorker = true;
      return await extractRowsFromPdf(file);
    }
  }

  async function extractRowsFromPdf(file) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

    // Build one normalized text string
    let text = "";
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      text += tc.items.map(it => it.str).join(" ") + "\n";
    }
    text = text.replace(/\s+/g, " ").trim();

    const date2 = "(\\d{2}\\/\\d{2}\\/\\d{4})\\s+(\\d{2}\\/\\d{2}\\/\\d{4})";
    const num = "(-?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?)";

    // Find all row starts
    const startRe = new RegExp(date2, "g");
    const starts = [];
    let m;
    while ((m = startRe.exec(text)) !== null) starts.push(m.index);
    if (!starts.length) return [];

    const tailRe = new RegExp(
      "\\s" + num + "\\s" + num + "\\s" + num + "\\s" + num + "\\s" + num + "\\s" + num + "\\s*$"
    );

    const rows = [];
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i];
      const end = (i + 1 < starts.length) ? starts[i + 1] : text.length;
      const chunk = text.slice(start, end).trim();

      if (chunk.startsWith("Total ")) continue;

      const md = chunk.match(new RegExp("^" + date2 + "\\s+(.*)$"));
      if (!md) continue;

      const paymentDate = md[1];
      const issueDate = md[2];
      const rest = md[3];

      const mt = rest.match(tailRe);
      if (!mt) continue;

      const securities = parseNumber(mt[1]);
      const gross = parseNumber(mt[2]);
      const tax = parseNumber(mt[3]);
      const jhTax = parseNumber(mt[4]);
      const zakat = parseNumber(mt[5]);
      const net = parseNumber(mt[6]);

      const beforeTail = rest.slice(0, mt.index).trim();
      const symMatch = beforeTail.match(/^([A-Z0-9]+)\s-\s(.+)$/i);

      let symbol = "";
      let secName = "";

      if (symMatch) {
        symbol = String(symMatch[1]).toUpperCase();
        secName = String(symMatch[2]).trim();
      } else {
        const parts = beforeTail.split(" ");
        symbol = String(parts[0] || "").toUpperCase();
        secName = parts.slice(1).join(" ").trim();
      }
      if (!symbol) continue;

      rows.push({
        paymentDate, issueDate, symbol, secName,
        securities, gross, tax, jhTax, zakat, net,
        source: "CDC PDF",
        importedAt: new Date().toISOString()
      });
    }
    return rows;
  }

  // ---------- UI rendering ----------
  function renderPreview(rows) {
    el.previewBody.innerHTML = "";
    rows.slice(0, 15).forEach(r => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${esc(r.paymentDate)}</td>
        <td>${esc(r.issueDate)}</td>
        <td><b>${esc(r.symbol)}</b></td>
        <td class="num">${intFmt(r.securities)}</td>
        <td class="num">${money(r.gross)}</td>
        <td class="num">${money(r.tax)}</td>
        <td class="num">${money(r.jhTax)}</td>
        <td class="num">${money(r.zakat)}</td>
        <td class="num">${money(r.net)}</td>
      `;
      el.previewBody.appendChild(tr);
    });
  }

  function setKpis(t) {
    if (!t) {
      el.kpiGross.textContent = el.kpiTax.textContent = el.kpiZakat.textContent = el.kpiNet.textContent = "—";
      return;
    }
    el.kpiGross.textContent = money(t.gross);
    el.kpiTax.textContent = money(t.tax + t.jhTax);
    el.kpiZakat.textContent = money(t.zakat);
    el.kpiNet.textContent = money(t.net);
  }

  async function refreshSummary() {
    const all = await dbGetAll();
    const q = (el.symbolFilter.value || "").trim().toUpperCase();
    const rows = q ? all.filter(r => String(r.symbol || "").toUpperCase().includes(q)) : all;

    const totals = rows.reduce((t, r) => {
      t.gross += Number(r.gross || 0);
      t.tax += Number(r.tax || 0);
      t.jhTax += Number(r.jhTax || 0);
      t.zakat += Number(r.zakat || 0);
      t.net += Number(r.net || 0);
      t.count += 1;
      return t;
    }, { gross:0, tax:0, jhTax:0, zakat:0, net:0, count:0 });

    const map = new Map();
    for (const r of rows) {
      const s = String(r.symbol || "").toUpperCase();
      if (!s) continue;
      if (!map.has(s)) map.set(s, { symbol:s, gross:0, tax:0, jhTax:0, zakat:0, net:0, count:0 });
      const g = map.get(s);
      g.gross += Number(r.gross || 0);
      g.tax += Number(r.tax || 0);
      g.jhTax += Number(r.jhTax || 0);
      g.zakat += Number(r.zakat || 0);
      g.net += Number(r.net || 0);
      g.count += 1;
    }
    const grouped = Array.from(map.values()).sort((a,b) => b.gross - a.gross);

    setKpis(totals);

    el.sumBody.innerHTML = "";
    grouped.forEach(g => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><b>${esc(g.symbol)}</b></td>
        <td class="num">${money(g.gross)}</td>
        <td class="num">${money(g.tax)}</td>
        <td class="num">${money(g.jhTax)}</td>
        <td class="num">${money(g.zakat)}</td>
        <td class="num">${money(g.net)}</td>
        <td class="num">${g.count}</td>
      `;
      el.sumBody.appendChild(tr);
    });

    el.ftGross.textContent = money(totals.gross);
    el.ftTax.textContent = money(totals.tax);
    el.ftJhTax.textContent = money(totals.jhTax);
    el.ftZakat.textContent = money(totals.zakat);
    el.ftNet.textContent = money(totals.net);
    el.ftCount.textContent = String(totals.count);

    const lines = [];
    if (grouped.length) {
      lines.push(`Dividend total: ${money(totals.gross)}`);
      grouped.forEach(g => lines.push(` - ${g.symbol.padEnd(10, " ")} ${money(g.gross)}`));
      lines.push("");
      lines.push(`Total tax deducted: ${money(totals.tax + totals.jhTax)}`);
      lines.push(`Total zakat deducted: ${money(totals.zakat)}`);
      lines.push(`Total dividend earned: ${money(totals.net)}`);
      el.summaryText.textContent = lines.join("\n");
    } else {
      el.summaryText.textContent = "—";
    }
  }

  // ---------- CSV export ----------
  function toCsv(rows) {
    const headers = ["paymentDate","issueDate","symbol","secName","securities","gross","tax","jhTax","zakat","net","source","importedAt"];
    const out = [headers.join(",")];
    for (const r of rows) out.push(headers.map(h => csvCell(r[h])).join(","));
    return out.join("\n");
  }
  function csvCell(v) {
    const s = String(v ?? "");
    return /[,"\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
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
});
