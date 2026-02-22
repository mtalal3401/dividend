pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.js";

const els = {
  fileInput: document.getElementById("fileInput"),
  fileName: document.getElementById("fileName"),
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

els.fileInput.addEventListener("change", () => {
  selectedFile = els.fileInput.files?.[0] || null;
  els.btnImport.disabled = !selectedFile;

  els.fileName.textContent = selectedFile ? selectedFile.name : "No file selected";
  els.status.textContent = selectedFile ? `Selected: ${selectedFile.name}` : "Choose a PDF to start.";
});

els.btnImport.addEventListener("click", async () => {
  if (!selectedFile) return;

  try {
    els.status.textContent = "Reading PDF…";
    const rows = await extractRowsFromPdf(selectedFile);

    if (!rows.length) {
      els.status.textContent = "No rows detected in PDF (layout may differ).";
      return;
    }

    renderPreview(rows);

    els.status.textContent = `Extracted ${rows.length} rows. Saving to database…`;
    await dbAddMany(rows);

    els.status.textContent = `Imported ${rows.length}. Refreshing summary…`;
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
  if (!rows.length) return alert("Database is empty.");
  downloadTextFile(toCsv(rows), "dividends_db_export.csv", "text/csv");
});

els.symbolFilter.addEventListener("input", refreshSummary);

els.btnCopy.addEventListener("click", async () => {
  const text = els.summaryText.textContent || "";
  if (!text || text === "—") return;
  await navigator.clipboard.writeText(text);
  alert("Summary copied.");
});

/* ---------- formatting ---------- */
function money(n){ return Number(n||0).toLocaleString("en-PK",{minimumFractionDigits:2,maximumFractionDigits:2}); }
function intFmt(n){ return Number(n||0).toLocaleString("en-PK",{maximumFractionDigits:0}); }
function parseNumber(s){
  if (s==null) return 0;
  const v = Number(String(s).replace(/,/g,"").trim());
  return Number.isFinite(v) ? v : 0;
}
function escapeHtml(s){
  return String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

/* ---------- UI ---------- */
function setKpis(t){
  if(!t){ els.kpiGross.textContent=els.kpiTax.textContent=els.kpiZakat.textContent=els.kpiNet.textContent="—"; return; }
  els.kpiGross.textContent = money(t.gross);
  els.kpiTax.textContent = money(t.tax + t.jhTax);
  els.kpiZakat.textContent = money(t.zakat);
  els.kpiNet.textContent = money(t.net);
}

function renderPreview(rows){
  els.previewBody.innerHTML="";
  rows.slice(0,15).forEach(r=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td>${escapeHtml(r.paymentDate)}</td>
      <td>${escapeHtml(r.issueDate)}</td>
      <td><b>${escapeHtml(r.symbol)}</b></td>
      <td class="num">${intFmt(r.securities)}</td>
      <td class="num">${money(r.gross)}</td>
      <td class="num">${money(r.tax)}</td>
      <td class="num">${money(r.jhTax)}</td>
      <td class="num">${money(r.zakat)}</td>
      <td class="num">${money(r.net)}</td>`;
    els.previewBody.appendChild(tr);
  });
}

async function refreshSummary(){
  const all = await dbGetAll();
  const q = (els.symbolFilter.value||"").trim().toUpperCase();
  const rows = q ? all.filter(r=>String(r.symbol||"").toUpperCase().includes(q)) : all;

  const grouped = groupBySymbol(rows);
  const totals = calcTotals(rows);

  setKpis(totals);
  renderSummaryTable(grouped, totals);
  renderRequestedText(grouped, totals);
}

function calcTotals(rows){
  const t={gross:0,tax:0,jhTax:0,zakat:0,net:0,count:0};
  rows.forEach(r=>{
    t.gross+=Number(r.gross||0);
    t.tax+=Number(r.tax||0);
    t.jhTax+=Number(r.jhTax||0);
    t.zakat+=Number(r.zakat||0);
    t.net+=Number(r.net||0);
    t.count+=1;
  });
  return t;
}

function groupBySymbol(rows){
  const m=new Map();
  rows.forEach(r=>{
    const sym=String(r.symbol||"").toUpperCase();
    if(!sym) return;
    if(!m.has(sym)) m.set(sym,{symbol:sym,gross:0,tax:0,jhTax:0,zakat:0,net:0,count:0});
    const g=m.get(sym);
    g.gross+=Number(r.gross||0);
    g.tax+=Number(r.tax||0);
    g.jhTax+=Number(r.jhTax||0);
    g.zakat+=Number(r.zakat||0);
    g.net+=Number(r.net||0);
    g.count+=1;
  });
  return Array.from(m.values()).sort((a,b)=>b.gross-a.gross);
}

function renderSummaryTable(grouped, totals){
  els.summaryBody.innerHTML="";
  grouped.forEach(g=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td><b>${escapeHtml(g.symbol)}</b></td>
      <td class="num">${money(g.gross)}</td>
      <td class="num">${money(g.tax)}</td>
      <td class="num">${money(g.jhTax)}</td>
      <td class="num">${money(g.zakat)}</td>
      <td class="num">${money(g.net)}</td>
      <td class="num">${intFmt(g.count)}</td>`;
    els.summaryBody.appendChild(tr);
  });

  els.ftGross.textContent=money(totals.gross);
  els.ftTax.textContent=money(totals.tax);
  els.ftJhTax.textContent=money(totals.jhTax);
  els.ftZakat.textContent=money(totals.zakat);
  els.ftNet.textContent=money(totals.net);
  els.ftCount.textContent=intFmt(totals.count);
}

function renderRequestedText(grouped, totals){
  const lines=[];
  lines.push(`Dividend total: ${money(totals.gross)}`);
  grouped.forEach(g=>lines.push(` - ${g.symbol.padEnd(8," ")} ${money(g.gross)}`));
  lines.push("");
  lines.push(`Total tax deducted: ${money(totals.tax + totals.jhTax)}`);
  lines.push(`Total zakat deducted: ${money(totals.zakat)}`);
  lines.push(`Total dividend earned: ${money(totals.net)}`);
  els.summaryText.textContent=lines.join("\n");
}

/* ---------- PDF extraction ---------- */
async function extractRowsFromPdf(file){
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data:buf}).promise;

  const allLines=[];
  for(let p=1;p<=pdf.numPages;p++){
    const page=await pdf.getPage(p);
    const tc=await page.getTextContent();
    const pageText=tc.items.map(it=>it.str).join("\n");
    pageText.split(/\r?\n/).forEach(line=>{
      const cleaned=line.replace(/\s+/g," ").trim();
      if(cleaned) allLines.push(cleaned);
    });
  }

  const dateStart=/^\d{2}\/\d{2}\/\d{4}\b/;
  const blocks=[];
  let cur=[];

  for(const line of allLines){
    const skip=["Dividend / Zakat","Date and Time Printed","UIN","Name","Security Symbol","Payment Date",
      "* As per Issuer","Disclaimer","By accessing","End of Report","Total "];
    if(skip.some(s=>line.startsWith(s))) continue;

    if(dateStart.test(line)){
      if(cur.length) blocks.push(cur.join(" "));
      cur=[line];
    }else if(cur.length){
      cur.push(line);
    }
  }
  if(cur.length) blocks.push(cur.join(" "));

  const rows=[];
  for(const b of blocks){
    const r=parseCdcBlock(b);
    if(r) rows.push(r);
  }
  return rows;
}

function parseCdcBlock(block){
  const m=block.match(/^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(.*)$/);
  if(!m) return null;
  const paymentDate=m[1], issueDate=m[2], rest=m[3];

  const num="(?:-?\\d{1,3}(?:,\\d{3})*|-?\\d+)(?:\\.\\d+)?";
  const tailRe=new RegExp("\\s("+num+")\\s("+num+")\\s("+num+")\\s("+num+")\\s("+num+")\\s("+num+")\\s*$");
  const t=rest.match(tailRe);
  if(!t) return null;

  const securities=parseNumber(t[1]);
  const gross=parseNumber(t[2]);
  const tax=parseNumber(t[3]);
  const jhTax=parseNumber(t[4]);
  const zakat=parseNumber(t[5]);
  const net=parseNumber(t[6]);

  const before=rest.slice(0, t.index).trim();

  let symbol="", secName="";
  const ms=before.match(/^([A-Z0-9]+)\s-\s(.+)$/i);
  if(ms){ symbol=String(ms[1]).toUpperCase(); secName=String(ms[2]).trim(); }
  else { const parts=before.split(" "); symbol=String(parts[0]||"").toUpperCase(); secName=parts.slice(1).join(" ").trim(); }

  if(!symbol) return null;

  return { paymentDate, issueDate, symbol, secName, securities, gross, tax, jhTax, zakat, net, source:"CDC PDF", importedAt:new Date().toISOString() };
}

/* ---------- CSV export ---------- */
function toCsv(rows){
  const headers=["paymentDate","issueDate","symbol","secName","securities","gross","tax","jhTax","zakat","net","source","importedAt"];
  const out=[headers.join(",")];
  for(const r of rows) out.push(headers.map(h=>csvCell(r[h])).join(","));
  return out.join("\n");
}
function csvCell(v){
  const s=String(v??"");
  if(/[,"\n]/.test(s)) return `"${s.replaceAll('"','""')}"`;
  return s;
}
function downloadTextFile(content, filename, mime){
  const blob=new Blob([content],{type:mime||"text/plain"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download=filename;
  document.body.appendChild(a);
  a.click(); a.remove();
  URL.revokeObjectURL(url);
}
