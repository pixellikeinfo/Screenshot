/* ═══════════════════════════════════════════════════════════════════
   Screenshot Data Extractor  –  app.js
   ═══════════════════════════════════════════════════════════════════ */

/* ── DOM refs ─────────────────────────────────────────────────────── */
const imageInput      = document.getElementById('imageInput');
const extractBtn      = document.getElementById('extractBtn');
const copyBtn         = document.getElementById('copyBtn');
const copyNameBtn     = document.getElementById('copyNameBtn');
const copyMobileBtn   = document.getElementById('copyMobileBtn');
const copyEmailBtn    = document.getElementById('copyEmailBtn');
const copyUpiBtn      = document.getElementById('copyUpiBtn');
const downloadCsvBtn  = document.getElementById('downloadCsvBtn');
const downloadXlsxBtn = document.getElementById('downloadXlsxBtn');
const checkDupBtn     = document.getElementById('checkDupBtn');
const statusEl        = document.getElementById('status');
const tableBody       = document.querySelector('#resultsTable tbody');
const previewGrid     = document.getElementById('previewGrid');
const imageModal      = document.getElementById('imageModal');
const modalImage      = document.getElementById('modalImage');
const modalCaption    = document.getElementById('modalCaption');
const closeModalBtn   = document.getElementById('closeModalBtn');
const selectedCountEl = document.getElementById('selectedCount');
const dupModal        = document.getElementById('dupModal');
const dupModalBody    = document.getElementById('dupModalBody');
const closeDupModalBtn= document.getElementById('closeDupModalBtn');

const HEADERS = ['File', 'Name', 'Mobile', 'Email', 'UPI ID'];
let extractedRows = [];
let previewUrls   = [];
let selectedFiles = [];

/* ════════════════════════════════════════════════════════════════════
   SECTION 1 – PHONE NUMBER UTILITIES
   ════════════════════════════════════════════════════════════════════ */

/**
 * Given a raw matched string return a canonical phone string:
 *   Indian  → 10 plain digits
 *   Other   → "+<digits>"
 *   Invalid → ""
 */
function canonicalPhone(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    const n = digits.slice(2);
    if (/^[6-9]\d{9}$/.test(n)) return n;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    const n = digits.slice(1);
    if (/^[6-9]\d{9}$/.test(n)) return n;
  }
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) return digits;
  // International (non-91, 7-15 digits)
  if (digits.length >= 7 && digits.length <= 15 &&
      !digits.startsWith('91') && !digits.startsWith('0')) {
    return '+' + digits;
  }
  return '';
}

/**
 * Extract ALL distinct phone numbers from a single text string.
 * Conservative regex – no sliding window – so no phantom numbers.
 */
function phonesFromText(text) {
  // OCR digit-context substitutions only
  const t = text
    .replace(/(?<=\d\s*)[oO](?=\s*\d)/g, '0')
    .replace(/[lI|](?=\d)/g, '1')
    .replace(/(?<=\d)[lI|]/g, '1');

  const seen   = new Set();
  const result = [];

  const tryAdd = (raw) => {
    const c = canonicalPhone(raw);
    if (c && !seen.has(c)) { seen.add(c); result.push(c); }
  };

  // Primary: Indian numbers (+91 / 91 / 0 / bare) with optional separators
  const RE_INDIAN =
    /(?<!\d)(?:\+\s*91|91|0)?[\s.\-()]*[6-9](?:[\s.\-()]*\d){9}(?!\d)/g;

  // Secondary: explicit + prefix international (covers +971, +1, etc.)
  const RE_INTL =
    /\+(?!91[\s.\-()])[1-9]\d{0,2}[\s.\-()]*\d[\s.\-()]*(?:\d[\s.\-()]*){6,12}(?!\d)/g;

  let m;
  while ((m = RE_INDIAN.exec(t)) !== null) tryAdd(m[0]);
  while ((m = RE_INTL.exec(t))   !== null) tryAdd(m[0]);

  return result;
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 2 – NAME / EMAIL / UPI UTILITIES
   ════════════════════════════════════════════════════════════════════ */

function extractEmail(text) {
  const m = text.match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i);
  return m ? m[0].trim() : '';
}

function extractUPI(text) {
  const m = text.match(/\b[a-zA-Z0-9._\-]{2,}@[a-zA-Z]{2,9}\b/);
  if (!m) return '';
  const val = m[0].trim();
  if (/\.(com|in|org|net|edu|gov|io|co)$/i.test(val)) return '';
  return val;
}

function stripDecorators(line) {
  return line
    .replace(/^[\s~\u2022\u00b7*\-_]+/, '')
    .replace(/[\s~\u2022\u00b7*\-_]+$/, '')
    .trim();
}

function isLikelyName(raw) {
  if (!raw) return false;
  const val = stripDecorators(raw);
  if (val.length < 2 || val.length > 60) return false;
  if (/[@:/\\]/.test(val)) return false;
  if (/\bupi\b/i.test(val)) return false;
  if (/\bmobile\b/i.test(val)) return false;
  if (/^[\d\s.\-+()]+$/.test(val)) return false;  // pure number string
  const letters = (val.match(/[a-zA-Z]/g) || []).length;
  const digits  = (val.match(/\d/g) || []).length;
  if (letters < 2) return false;
  if (digits > letters) return false;
  if (!val.includes(' ') && val.length > 25) return false;
  return true;
}

function toNameCandidate(line) {
  return stripDecorators(
    line
      .replace(/\bmobile\b/gi, '')
      .replace(/\badd\b/gi, '')
      .replace(/\bview contacts\b/gi, '')
      .replace(/[^a-zA-Z0-9\s.'\-]/g, ' ')
  ).replace(/\s{2,}/g, ' ').trim();
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 3 – STRUCTURED LINE-PAIR PARSING
   ════════════════════════════════════════════════════════════════════
   WhatsApp contact lists:  "~ Name" on line N,  "+91 XXXXX XXXXX" on line N+1.
   We exploit this layout instead of a global search.
   ════════════════════════════════════════════════════════════════════ */

function parseContactsFromText(text, globalEmail, globalUPI) {
  const rawLines  = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const linePhones = rawLines.map(l => phonesFromText(l));

  const assignedPhones = new Set();
  const records = [];

  for (let i = 0; i < rawLines.length; i++) {
    const phones = linePhones[i];
    if (!phones.length) continue;

    for (const phone of phones) {
      if (assignedPhones.has(phone)) continue;
      assignedPhones.add(phone);

      let name = '';

      // 1. Look backward up to 4 lines (stop if we hit another phone line)
      for (let off = 1; off <= 4 && !name; off++) {
        const idx = i - off;
        if (idx < 0) break;
        if (linePhones[idx].length > 0) break;  // another phone → boundary
        const cand = toNameCandidate(rawLines[idx]);
        if (isLikelyName(cand)) name = cand;
      }

      // 2. Same line remainder (e.g. "Jeevan bose33  +91 79074 25814")
      if (!name) {
        const stripped = rawLines[i]
          .replace(/(?:\+\s*\d{1,3}[\s.\-()]*)?[6-9](?:[\s.\-()]*\d){9}/g, '')
          .replace(/\+[\d\s.\-()]{7,}/g, '');
        const cand = toNameCandidate(stripped);
        if (isLikelyName(cand)) name = cand;
      }

      // 3. Look forward up to 2 lines (stop at another phone line)
      if (!name) {
        for (let off = 1; off <= 2 && !name; off++) {
          const idx = i + off;
          if (idx >= rawLines.length) break;
          if (linePhones[idx].length > 0) break;
          const cand = toNameCandidate(rawLines[idx]);
          if (isLikelyName(cand)) name = cand;
        }
      }

      records.push({ name, mobile: phone, email: globalEmail, upi: globalUPI });
    }
  }

  return records;
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 4 – IMAGE PRE-PROCESSING
   ════════════════════════════════════════════════════════════════════ */

async function preprocessImageVariants(file) {
  const variants = [];
  try {
    const bitmap = await createImageBitmap(file);

    const binarise = (ctx, w, h, thr) => {
      const id = ctx.getImageData(0, 0, w, h); const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.2126 * d[i] + 0.7152 * d[i+1] + 0.0722 * d[i+2];
        const v = g > thr ? 255 : 0;
        d[i] = d[i+1] = d[i+2] = v;
      }
      ctx.putImageData(id, 0, 0);
    };

    const makeBlob = (c) => new Promise(res => c.toBlob(res, 'image/png'));

    // v1 – 2× + threshold 145 (light bg)
    { const c = document.createElement('canvas'); c.width = bitmap.width*2; c.height = bitmap.height*2;
      const ctx = c.getContext('2d',{willReadFrequently:true}); ctx.fillStyle='#fff'; ctx.fillRect(0,0,c.width,c.height);
      ctx.drawImage(bitmap,0,0,c.width,c.height); binarise(ctx,c.width,c.height,145);
      const b = await makeBlob(c); if (b) variants.push(b); }

    // v2 – 2× greyscale + contrast
    { const c = document.createElement('canvas'); c.width = bitmap.width*2; c.height = bitmap.height*2;
      const ctx = c.getContext('2d',{willReadFrequently:true});
      ctx.filter = 'grayscale(1) contrast(1.5) brightness(1.1)';
      ctx.drawImage(bitmap,0,0,c.width,c.height);
      const b = await makeBlob(c); if (b) variants.push(b); }

    // v3 – 3× + threshold 128
    { const c = document.createElement('canvas'); c.width = bitmap.width*3; c.height = bitmap.height*3;
      const ctx = c.getContext('2d',{willReadFrequently:true}); ctx.fillStyle='#fff'; ctx.fillRect(0,0,c.width,c.height);
      ctx.drawImage(bitmap,0,0,c.width,c.height); binarise(ctx,c.width,c.height,128);
      const b = await makeBlob(c); if (b) variants.push(b); }

    // v4 – inverted + binarise (dark-mode / dark background screenshots)
    { const c = document.createElement('canvas'); c.width = bitmap.width*2; c.height = bitmap.height*2;
      const ctx = c.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(bitmap,0,0,c.width,c.height);
      const id = ctx.getImageData(0,0,c.width,c.height); const d = id.data;
      for (let i = 0; i < d.length; i+=4) { d[i]=255-d[i]; d[i+1]=255-d[i+1]; d[i+2]=255-d[i+2]; }
      ctx.putImageData(id,0,0); binarise(ctx,c.width,c.height,128);
      const b = await makeBlob(c); if (b) variants.push(b); }

  } catch (err) { console.error('Preprocessing failed:', err); }
  return variants;
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 5 – OCR ORCHESTRATION
   ════════════════════════════════════════════════════════════════════ */

async function ocrBlob(blob, lang = 'eng') {
  const { data: { text } } = await Tesseract.recognize(blob, lang, { tessedit_pageseg_mode: 6 });
  return text || '';
}

async function runOCR(file) {
  const origText = await ocrBlob(file, 'eng');

  const variants     = await preprocessImageVariants(file);
  const variantTexts = await Promise.all(variants.map(v => ocrBlob(v,'eng').catch(()=>'')));

  const allTexts = [origText, ...variantTexts].filter(Boolean);

  // Score each text by how many phone numbers it finds
  const scored = allTexts
    .map(t => ({ text: t, score: phonesFromText(t).length }))
    .sort((a, b) => b.score - a.score);

  const primaryText   = scored[0]?.text || '';
  const secondaryText = scored[1]?.text || '';

  // Email / UPI: scan everything combined (no phantom risk)
  const allMerged = allTexts.join('\n');
  const globalEmail = extractEmail(allMerged);
  const globalUPI   = extractUPI(allMerged);

  const primaryRecords   = parseContactsFromText(primaryText, globalEmail, globalUPI);
  const secondaryRecords = parseContactsFromText(secondaryText, globalEmail, globalUPI);

  // Merge – primary wins; secondary fills in any missing phones
  const seenPhones = new Set(primaryRecords.map(r => r.mobile));
  const merged = [...primaryRecords];
  for (const r of secondaryRecords) {
    if (!seenPhones.has(r.mobile)) { seenPhones.add(r.mobile); merged.push(r); }
  }

  if (!merged.length) {
    return [{ file: file.name, name: '', mobile: '', email: globalEmail, upi: globalUPI }];
  }

  return merged.map(r => ({ file: file.name, ...r }));
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 6 – TABLE / EXPORT HELPERS
   ════════════════════════════════════════════════════════════════════ */

function cleanText(value) { return value ? value.replace(/\s+/g, ' ').trim() : ''; }

function selectedFields() {
  return Array.from(document.querySelectorAll('.field-checkbox:checked')).map(el => el.value);
}

function objectToOrderedRow(data) {
  return { File: data.file, Name: data.name, Mobile: data.mobile, Email: data.email, 'UPI ID': data.upi };
}

function applyFieldSelection(record, fields) {
  return {
    file:   record.file,
    name:   fields.includes('name')   ? record.name   : '',
    mobile: fields.includes('mobile') ? record.mobile : '',
    email:  fields.includes('email')  ? record.email  : '',
    upi:    fields.includes('upi')    ? record.upi    : '',
  };
}

function getOrderedRows() { return extractedRows.map(objectToOrderedRow); }

function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b91c1c' : '#334155';
}

function getDuplicateMobiles(rows) {
  const count = {};
  rows.forEach(row => { if (row.Mobile) count[row.Mobile] = (count[row.Mobile] || 0) + 1; });
  return new Set(Object.keys(count).filter(k => count[k] > 1));
}

function renderTable(rows) {
  tableBody.innerHTML = '';
  const dupMobiles = getDuplicateMobiles(rows);
  for (const row of rows) {
    const tr = document.createElement('tr');
    if (row.Mobile && dupMobiles.has(row.Mobile)) tr.classList.add('dup-row');
    HEADERS.forEach(key => {
      const td = document.createElement('td');
      td.textContent = row[key] || '';
      tr.appendChild(td);
    });
    tableBody.appendChild(tr);
  }
}

function toTSV(rows) {
  const esc = v => (v ?? '').toString().replace(/\t/g,' ').replace(/\n/g,' ');
  return [HEADERS.join('\t'), ...rows.map(r => HEADERS.map(k=>esc(r[k])).join('\t'))].join('\n');
}

function toCSV(rows) {
  const esc = v => { const s=(v??'').toString(); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; };
  return [HEADERS.join(','), ...rows.map(r => HEADERS.map(k=>esc(r[k])).join(','))].join('\n');
}

function downloadFile(content, fileName, mimeType) {
  const blob = new Blob([content],{type:mimeType});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href=url; a.download=fileName; a.click();
  URL.revokeObjectURL(url);
}

function enableActions(enabled) {
  [copyBtn,copyNameBtn,copyMobileBtn,copyEmailBtn,copyUpiBtn,
   downloadCsvBtn,downloadXlsxBtn,checkDupBtn].forEach(btn => { btn.disabled = !enabled; });
}

function copyColumn(headerKey, label) {
  const values = getOrderedRows().map(row => row[headerKey]||'').join('\n');
  navigator.clipboard.writeText(values)
    .then(()  => showStatus(`Copied ${label} column.`))
    .catch(err => { console.error(err); showStatus('Copy failed.',true); });
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 7 – FILE SELECTION & PREVIEWS
   ════════════════════════════════════════════════════════════════════ */

function fileKey(file) { return `${file.name}__${file.size}__${file.lastModified}`; }

function updateSelectedCount() {
  selectedCountEl.textContent = selectedFiles.length
    ? `${selectedFiles.length} file(s) selected.` : 'No files selected yet.';
}

function addSelectedFiles(newFiles) {
  const seen = new Set(selectedFiles.map(fileKey));
  newFiles.forEach(f => { const k=fileKey(f); if(!seen.has(k)){selectedFiles.push(f);seen.add(k);} });
}

function removeSelectedFile(targetFile) {
  selectedFiles = selectedFiles.filter(f => fileKey(f) !== fileKey(targetFile));
  renderPreviews(selectedFiles); updateSelectedCount();
}

function clearPreviews() {
  previewUrls.forEach(url => URL.revokeObjectURL(url));
  previewUrls = []; previewGrid.innerHTML = '';
}

function renderPreviews(files) {
  clearPreviews();
  files.forEach(file => {
    const url = URL.createObjectURL(file); previewUrls.push(url);
    const card      = document.createElement('div');      card.className      = 'preview-card';
    const previewBtn= document.createElement('button');   previewBtn.type     = 'button'; previewBtn.className = 'preview-open-btn';
    const img       = document.createElement('img');      img.src             = url; img.alt = file.name;
    const nameSpan  = document.createElement('span');     nameSpan.className  = 'preview-name'; nameSpan.textContent = file.name;
    const removeBtn = document.createElement('button');   removeBtn.type      = 'button'; removeBtn.className = 'preview-remove-btn';
    removeBtn.textContent = '✕'; removeBtn.setAttribute('aria-label',`Remove ${file.name}`);
    removeBtn.addEventListener('click', e => { e.stopPropagation(); removeSelectedFile(file); });
    previewBtn.appendChild(img); previewBtn.appendChild(nameSpan);
    previewBtn.addEventListener('click', () => { modalImage.src=url; modalCaption.textContent=file.name; imageModal.hidden=false; });
    card.appendChild(removeBtn); card.appendChild(previewBtn); previewGrid.appendChild(card);
  });
}

function closePreviewModal() {
  imageModal.hidden = true; modalImage.removeAttribute('src'); modalCaption.textContent = '';
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 8 – DUPLICATE MODAL
   ════════════════════════════════════════════════════════════════════ */

function showDuplicates() {
  const rows   = getOrderedRows();
  const dupSet = getDuplicateMobiles(rows);
  if (!dupSet.size) {
    dupModalBody.innerHTML = '<p class="no-dup">No duplicate mobile numbers found.</p>';
  } else {
    let html = `<p class="dup-count">${dupSet.size} duplicate number(s) found:</p>
      <table class="dup-table"><thead><tr><th>Mobile</th><th>Count</th><th>Names</th></tr></thead><tbody>`;
    dupSet.forEach(mobile => {
      const matching = rows.filter(r => r.Mobile === mobile);
      const names    = [...new Set(matching.map(r=>r.Name).filter(Boolean))].join(', ');
      html += `<tr><td>${mobile}</td><td>${matching.length}</td><td>${names||'—'}</td></tr>`;
    });
    html += '</tbody></table>';
    dupModalBody.innerHTML = html;
  }
  dupModal.hidden = false;
}

function closeDupModal() { dupModal.hidden = true; }

/* ════════════════════════════════════════════════════════════════════
   SECTION 9 – EVENT LISTENERS
   ════════════════════════════════════════════════════════════════════ */

imageInput.addEventListener('change', () => {
  addSelectedFiles(Array.from(imageInput.files||[]));
  renderPreviews(selectedFiles); updateSelectedCount(); imageInput.value = '';
});

closeModalBtn.addEventListener('click', closePreviewModal);
imageModal.addEventListener('click', e => { if(e.target===imageModal) closePreviewModal(); });
document.addEventListener('keydown', e => {
  if(e.key==='Escape'){ if(!imageModal.hidden) closePreviewModal(); if(!dupModal.hidden) closeDupModal(); }
});
closeDupModalBtn.addEventListener('click', closeDupModal);
dupModal.addEventListener('click', e => { if(e.target===dupModal) closeDupModal(); });

extractBtn.addEventListener('click', async () => {
  const files  = selectedFiles;
  const fields = selectedFields();
  if (!files.length)  { showStatus('Please upload at least one screenshot.',true); return; }
  if (!fields.length) { showStatus('Please select at least one field to extract.',true); return; }

  extractBtn.disabled = true; enableActions(false); extractedRows = []; renderTable([]);

  try {
    for (let i = 0; i < files.length; i++) {
      showStatus(`Processing ${i+1}/${files.length}: ${files[i].name} …`);
      const results = await runOCR(files[i]);
      results
        .filter(r => !fields.includes('mobile') || r.mobile)
        .forEach(r => extractedRows.push(applyFieldSelection(r, fields)));
    }
    const orderedRows = getOrderedRows();
    renderTable(orderedRows); enableActions(orderedRows.length > 0);
    const mobileCount = orderedRows.filter(r=>r.Mobile).length;
    const dupMobiles  = getDuplicateMobiles(orderedRows);
    const dupMsg      = dupMobiles.size ? `  ⚠️ ${dupMobiles.size} duplicate(s) detected.` : '';
    showStatus(`Done. ${orderedRows.length} row(s) · ${mobileCount} mobile number(s).${dupMsg}`);
  } catch (err) {
    console.error(err); showStatus('Extraction failed. Try a clearer screenshot.',true);
  } finally { extractBtn.disabled = false; }
});

copyBtn.addEventListener('click', async () => {
  const rows = getOrderedRows(); if(!rows.length) return;
  try { await navigator.clipboard.writeText(toTSV(rows)); showStatus('Copied. Paste into Google Sheets or Excel.'); }
  catch(err) { console.error(err); showStatus('Copy failed.',true); }
});

copyNameBtn.addEventListener('click',   () => copyColumn('Name',   'Name'));
copyMobileBtn.addEventListener('click', () => copyColumn('Mobile', 'Mobile'));
copyEmailBtn.addEventListener('click',  () => copyColumn('Email',  'Email'));
copyUpiBtn.addEventListener('click',    () => copyColumn('UPI ID', 'UPI ID'));

downloadCsvBtn.addEventListener('click', () => {
  const rows = getOrderedRows(); if(!rows.length) return;
  downloadFile(toCSV(rows), 'extracted_data.csv', 'text/csv;charset=utf-8');
});

downloadXlsxBtn.addEventListener('click', () => {
  const rows = getOrderedRows(); if(!rows.length) return;
  const ws = XLSX.utils.json_to_sheet(rows,{header:HEADERS});
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'ExtractedData');
  XLSX.writeFile(wb,'extracted_data.xlsx');
});

checkDupBtn.addEventListener('click', showDuplicates);
