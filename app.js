/* ═══════════════════════════════════════════════════════════════════
   Screenshot Data Extractor – app.js
   Simple rule: read number exactly as shown, find name above it.
   ═══════════════════════════════════════════════════════════════════ */

/* ── DOM refs ──────────────────────────────────────────────────────── */
const imageInput       = document.getElementById('imageInput');
const extractBtn       = document.getElementById('extractBtn');
const copyBtn          = document.getElementById('copyBtn');
const copyNameBtn      = document.getElementById('copyNameBtn');
const copyMobileBtn    = document.getElementById('copyMobileBtn');
const copyEmailBtn     = document.getElementById('copyEmailBtn');
const copyUpiBtn       = document.getElementById('copyUpiBtn');
const downloadCsvBtn   = document.getElementById('downloadCsvBtn');
const downloadXlsxBtn  = document.getElementById('downloadXlsxBtn');
const checkDupBtn      = document.getElementById('checkDupBtn');
const statusEl         = document.getElementById('status');
const tableBody        = document.querySelector('#resultsTable tbody');
const previewGrid      = document.getElementById('previewGrid');
const imageModal       = document.getElementById('imageModal');
const modalImage       = document.getElementById('modalImage');
const modalCaption     = document.getElementById('modalCaption');
const closeModalBtn    = document.getElementById('closeModalBtn');
const selectedCountEl  = document.getElementById('selectedCount');
const dupModal         = document.getElementById('dupModal');
const dupModalBody     = document.getElementById('dupModalBody');
const closeDupModalBtn = document.getElementById('closeDupModalBtn');

const HEADERS = ['File', 'Name', 'Mobile', 'Email', 'UPI ID'];
let extractedRows = [];
let previewUrls   = [];
let selectedFiles = [];

/* ════════════════════════════════════════════════════════════════════
   SECTION 1 – READ PHONE NUMBERS EXACTLY AS SHOWN
   ════════════════════════════════════════════════════════════════════ */

/**
 * Find all phone numbers in a line of text.
 * Returns them EXACTLY as they appear (spaces removed for cleanliness).
 * Handles:
 *   +91 97467 68963  →  +917746768963  (keeps +91)
 *   +971 54 453 3584 →  +971544533584  (keeps any country code)
 *   9746768963       →  9746768963     (bare number)
 */
function findPhonesInLine(line) {
  const phones = [];
  const seen = new Set();

  // Match: optional + and country code, then digit groups separated by spaces/dashes
  // This single pattern catches all formats
  const RE = /(\+\d{1,3}[\s\-]?)?\d[\d\s\-]{7,}/g;

  let m;
  while ((m = RE.exec(line)) !== null) {
    // Strip all spaces and dashes to get clean digits (keep + prefix)
    const raw = m[0].trim();
    const cleaned = raw.startsWith('+')
      ? '+' + raw.slice(1).replace(/[\s\-]/g, '')
      : raw.replace(/[\s\-]/g, '');

    // Must have at least 7 digits to be a phone number
    const digitCount = cleaned.replace(/\D/g, '').length;
    if (digitCount < 7 || digitCount > 15) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    phones.push(cleaned);
  }

  return phones;
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 2 – NAME UTILITIES
   ════════════════════════════════════════════════════════════════════ */

function cleanStr(v) { return (v || '').replace(/\s+/g, ' ').trim(); }

/** Words that are UI chrome, not names */
const SKIP_WORDS = new Set([
  'search', 'mobile', 'add', 'view', 'contacts', 'view contacts',
  'lte', '5g', '4g', 'cancel', 'done', 'ok', 'back',
]);

function isSkipWord(s) {
  return SKIP_WORDS.has(s.toLowerCase().trim());
}

/**
 * Clean a line to get a name candidate:
 * - Remove the ~ prefix WhatsApp adds
 * - Remove known UI words
 * - Remove non-name characters
 */
function toNameCandidate(line) {
  let s = line
    .replace(/^[\s~\-_*•]+/, '')       // strip leading ~ decorator
    .replace(/[\s~\-_*•]+$/, '')       // strip trailing decorator
    .replace(/\bmobile\b/gi, '')
    .replace(/\badd\b/gi, '')
    .replace(/\bview\s*contacts\b/gi, '')
    .replace(/\bsearch\b/gi, '')
    .replace(/[^a-zA-Z0-9\s.'\-]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Strip leading single digit or short all-caps OCR noise (e.g. "1 Name", "TTA Name")
  s = s.replace(/^(\d{1,2}|[A-Z]{1,3})\s+/, '').trim();

  return s;
}

/**
 * Is this a plausible person name?
 */
function isName(s) {
  if (!s || s.length < 2 || s.length > 60) return false;
  if (isSkipWord(s)) return false;
  if (/^[\d\s.\-+()]+$/.test(s)) return false;  // purely numbers
  if (/[@:/\\]/.test(s)) return false;
  const letters = (s.match(/[a-zA-Z]/g) || []).length;
  if (letters < 2) return false;
  return true;
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 3 – EMAIL / UPI
   ════════════════════════════════════════════════════════════════════ */

function extractEmail(text) {
  const m = text.match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i);
  return m ? cleanStr(m[0]) : '';
}

function extractUPI(text) {
  const m = text.match(/\b[\w.\-]{2,}@[a-zA-Z]{2,9}\b/);
  if (!m) return '';
  const val = cleanStr(m[0]);
  if (/\.[a-zA-Z]{2,}$/.test(val.split('@')[1] || '')) return '';
  return val;
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 4 – PARSE CONTACTS FROM OCR TEXT
   Simple approach: go line by line.
   When a phone number line is found, look at the lines just above it for a name.
   ════════════════════════════════════════════════════════════════════ */

function parseContacts(text, globalEmail, globalUPI) {
  const lines      = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const linePhones = lines.map(l => findPhonesInLine(l));

  const usedPhones = new Set();
  const records    = [];

  for (let i = 0; i < lines.length; i++) {
    const phones = linePhones[i];
    if (!phones.length) continue;

    for (const phone of phones) {
      if (usedPhones.has(phone)) continue;
      usedPhones.add(phone);

      let name = '';

      // Look backward up to 3 lines for a name (stop at another phone line)
      for (let off = 1; off <= 3 && !name; off++) {
        const idx = i - off;
        if (idx < 0) break;
        if (linePhones[idx].length > 0) break;  // hit another number line → stop
        const cand = toNameCandidate(lines[idx]);
        if (isName(cand)) name = cand;
      }

      // Same line: strip the number and check what's left
      if (!name) {
        const rest = lines[i].replace(/(\+\d{1,3}[\s\-]?)?\d[\d\s\-]{7,}/g, '').trim();
        const cand = toNameCandidate(rest);
        if (isName(cand)) name = cand;
      }

      // Look forward up to 1 line (last resort)
      if (!name) {
        const idx = i + 1;
        if (idx < lines.length && linePhones[idx].length === 0) {
          const cand = toNameCandidate(lines[idx]);
          if (isName(cand)) name = cand;
        }
      }

      records.push({
        name:   cleanStr(name),
        mobile: cleanStr(phone),
        email:  cleanStr(globalEmail),
        upi:    cleanStr(globalUPI),
      });
    }
  }

  return records;
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 5 – IMAGE PRE-PROCESSING (4 variants for best OCR)
   ════════════════════════════════════════════════════════════════════ */

async function preprocessImageVariants(file) {
  const variants = [];
  try {
    const bitmap = await createImageBitmap(file);

    const binarise = (ctx, w, h, thr) => {
      const id = ctx.getImageData(0, 0, w, h);
      const d  = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        const v = g > thr ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(id, 0, 0);
    };

    const toBlob = c => new Promise(res => c.toBlob(res, 'image/png'));
    const mkC    = scale => {
      const c = document.createElement('canvas');
      c.width  = bitmap.width  * scale;
      c.height = bitmap.height * scale;
      return c;
    };

    // v1 – 2× + threshold 145 (light background)
    { const c = mkC(2), ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bitmap, 0, 0, c.width, c.height);
      binarise(ctx, c.width, c.height, 145);
      const b = await toBlob(c); if (b) variants.push(b); }

    // v2 – 2× greyscale + contrast (coloured backgrounds)
    { const c = mkC(2), ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.filter = 'grayscale(1) contrast(1.5) brightness(1.1)';
      ctx.drawImage(bitmap, 0, 0, c.width, c.height);
      const b = await toBlob(c); if (b) variants.push(b); }

    // v3 – 3× + threshold 128 (small text)
    { const c = mkC(3), ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bitmap, 0, 0, c.width, c.height);
      binarise(ctx, c.width, c.height, 128);
      const b = await toBlob(c); if (b) variants.push(b); }

    // v4 – 2× inverted + threshold (dark mode screenshots)
    { const c = mkC(2), ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, c.width, c.height);
      const id = ctx.getImageData(0, 0, c.width, c.height); const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2];
      }
      ctx.putImageData(id, 0, 0);
      binarise(ctx, c.width, c.height, 128);
      const b = await toBlob(c); if (b) variants.push(b); }

  } catch (err) { console.error('Preprocessing failed:', err); }
  return variants;
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 6 – OCR
   ════════════════════════════════════════════════════════════════════ */

async function ocrBlob(blob) {
  try {
    const { data: { text } } = await Tesseract.recognize(blob, 'eng', {
      tessedit_pageseg_mode: 6,
    });
    return text || '';
  } catch (e) {
    console.error('OCR error:', e);
    return '';
  }
}

async function runOCR(file) {
  const origText     = await ocrBlob(file);
  const variants     = await preprocessImageVariants(file);
  const variantTexts = await Promise.all(variants.map(v => ocrBlob(v)));

  const allTexts = [origText, ...variantTexts].filter(t => t.trim().length > 0);
  if (!allTexts.length) {
    return [{ file: file.name, name: '', mobile: '', email: '', upi: '' }];
  }

  // Use the OCR result that found the most phone numbers
  const best = allTexts
    .map(t => ({ text: t, score: findPhonesInLine(t.replace(/\n/g, ' ')).length }))
    .sort((a, b) => b.score - a.score)[0].text;

  const globalEmail = extractEmail(allTexts.join('\n'));
  const globalUPI   = extractUPI(allTexts.join('\n'));

  const records = parseContacts(best, globalEmail, globalUPI);

  if (!records.length) {
    return [{ file: file.name, name: '', mobile: '', email: globalEmail, upi: globalUPI }];
  }

  return records.map(r => ({ file: file.name, ...r }));
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 7 – TABLE / EXPORT HELPERS
   ════════════════════════════════════════════════════════════════════ */

function selectedFields() {
  return Array.from(document.querySelectorAll('.field-checkbox:checked')).map(el => el.value);
}

function objectToOrderedRow(d) {
  return {
    File:     cleanStr(d.file),
    Name:     cleanStr(d.name),
    Mobile:   cleanStr(d.mobile),
    Email:    cleanStr(d.email),
    'UPI ID': cleanStr(d.upi),
  };
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

function showStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? '#b91c1c' : '#334155';
}

function getDuplicateMobiles(rows) {
  const count = {};
  rows.forEach(r => { if (r.Mobile) count[r.Mobile] = (count[r.Mobile] || 0) + 1; });
  return new Set(Object.keys(count).filter(k => count[k] > 1));
}

function renderTable(rows) {
  tableBody.innerHTML = '';
  const dupSet = getDuplicateMobiles(rows);
  for (const row of rows) {
    const tr = document.createElement('tr');
    if (row.Mobile && dupSet.has(row.Mobile)) tr.classList.add('dup-row');
    HEADERS.forEach(key => {
      const td = document.createElement('td');
      td.textContent = row[key] || '';
      tr.appendChild(td);
    });
    tableBody.appendChild(tr);
  }
}

function toTSV(rows) {
  const esc = v => (v ?? '').toString().replace(/\t/g, ' ').replace(/\n/g, ' ');
  return [HEADERS.join('\t'), ...rows.map(r => HEADERS.map(k => esc(r[k])).join('\t'))].join('\n');
}

function toCSV(rows) {
  const esc = v => { const s = (v ?? '').toString(); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [HEADERS.join(','), ...rows.map(r => HEADERS.map(k => esc(r[k])).join(','))].join('\n');
}

function downloadFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);
}

function enableActions(enabled) {
  [copyBtn, copyNameBtn, copyMobileBtn, copyEmailBtn, copyUpiBtn,
   downloadCsvBtn, downloadXlsxBtn, checkDupBtn].forEach(btn => { btn.disabled = !enabled; });
}

function copyColumn(headerKey, label) {
  const values = getOrderedRows().map(row => row[headerKey] || '').join('\n');
  navigator.clipboard.writeText(values)
    .then(() => showStatus(`Copied ${label} column.`))
    .catch(err => { console.error(err); showStatus('Copy failed.', true); });
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 8 – FILE SELECTION & PREVIEWS
   ════════════════════════════════════════════════════════════════════ */

function fileKey(file) { return `${file.name}__${file.size}__${file.lastModified}`; }

function updateSelectedCount() {
  selectedCountEl.textContent = selectedFiles.length
    ? `${selectedFiles.length} file(s) selected.`
    : 'No files selected yet.';
}

function addSelectedFiles(newFiles) {
  const seen = new Set(selectedFiles.map(fileKey));
  newFiles.forEach(f => { const k = fileKey(f); if (!seen.has(k)) { selectedFiles.push(f); seen.add(k); } });
}

function removeSelectedFile(target) {
  selectedFiles = selectedFiles.filter(f => fileKey(f) !== fileKey(target));
  renderPreviews(selectedFiles);
  updateSelectedCount();
}

function clearPreviews() {
  previewUrls.forEach(url => URL.revokeObjectURL(url));
  previewUrls = []; previewGrid.innerHTML = '';
}

function renderPreviews(files) {
  clearPreviews();
  files.forEach(file => {
    const url = URL.createObjectURL(file);
    previewUrls.push(url);

    const card      = document.createElement('div');    card.className = 'preview-card';
    const removeBtn = document.createElement('button'); removeBtn.type = 'button';
    removeBtn.className = 'preview-remove-btn'; removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', `Remove ${file.name}`);
    removeBtn.addEventListener('click', e => { e.stopPropagation(); removeSelectedFile(file); });

    const previewBtn = document.createElement('button'); previewBtn.type = 'button';
    previewBtn.className = 'preview-open-btn';
    previewBtn.addEventListener('click', () => {
      modalImage.src = url; modalCaption.textContent = file.name; imageModal.hidden = false;
    });

    const img = document.createElement('img'); img.src = url; img.alt = file.name;
    const nameSpan = document.createElement('span');
    nameSpan.className = 'preview-name'; nameSpan.textContent = file.name;

    previewBtn.appendChild(img); previewBtn.appendChild(nameSpan);
    card.appendChild(removeBtn); card.appendChild(previewBtn);
    previewGrid.appendChild(card);
  });
}

function closePreviewModal() {
  imageModal.hidden = true; modalImage.removeAttribute('src'); modalCaption.textContent = '';
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 9 – DUPLICATE MODAL
   ════════════════════════════════════════════════════════════════════ */

function showDuplicates() {
  const rows   = getOrderedRows();
  const dupSet = getDuplicateMobiles(rows);
  if (!dupSet.size) {
    dupModalBody.innerHTML = '<p class="no-dup">✅ No duplicate mobile numbers found.</p>';
  } else {
    let html = `<p class="dup-count">${dupSet.size} duplicate number(s) found:</p>
      <table class="dup-table"><thead><tr><th>Mobile</th><th>Count</th><th>Names</th></tr></thead><tbody>`;
    dupSet.forEach(mobile => {
      const matching = rows.filter(r => r.Mobile === mobile);
      const names    = [...new Set(matching.map(r => r.Name).filter(Boolean))].join(', ');
      html += `<tr><td>${mobile}</td><td>${matching.length}</td><td>${names || '—'}</td></tr>`;
    });
    html += '</tbody></table>';
    dupModalBody.innerHTML = html;
  }
  dupModal.hidden = false;
}

function closeDupModal() { dupModal.hidden = true; }

/* ════════════════════════════════════════════════════════════════════
   SECTION 10 – EVENT LISTENERS
   ════════════════════════════════════════════════════════════════════ */

imageInput.addEventListener('change', () => {
  addSelectedFiles(Array.from(imageInput.files || []));
  renderPreviews(selectedFiles); updateSelectedCount(); imageInput.value = '';
});

closeModalBtn.addEventListener('click', closePreviewModal);
imageModal.addEventListener('click', e => { if (e.target === imageModal) closePreviewModal(); });
closeDupModalBtn.addEventListener('click', closeDupModal);
dupModal.addEventListener('click', e => { if (e.target === dupModal) closeDupModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!imageModal.hidden) closePreviewModal();
    if (!dupModal.hidden)   closeDupModal();
  }
});

extractBtn.addEventListener('click', async () => {
  const files  = selectedFiles;
  const fields = selectedFields();
  if (!files.length)  { showStatus('Please upload at least one screenshot.', true); return; }
  if (!fields.length) { showStatus('Please select at least one field to extract.', true); return; }

  extractBtn.disabled = true; enableActions(false); extractedRows = []; renderTable([]);

  try {
    for (let i = 0; i < files.length; i++) {
      showStatus(`Processing ${i + 1}/${files.length}: ${files[i].name} …`);
      const results = await runOCR(files[i]);
      results
        .filter(r => !fields.includes('mobile') || r.mobile)
        .forEach(r => extractedRows.push(applyFieldSelection(r, fields)));
    }

    const orderedRows = getOrderedRows();
    renderTable(orderedRows); enableActions(orderedRows.length > 0);

    const mobileCount = orderedRows.filter(r => r.Mobile).length;
    const dupSet      = getDuplicateMobiles(orderedRows);
    const dupMsg      = dupSet.size ? `  ⚠️ ${dupSet.size} duplicate(s) detected.` : '';
    showStatus(`Done. ${orderedRows.length} row(s) · ${mobileCount} mobile number(s).${dupMsg}`);
  } catch (err) {
    console.error(err); showStatus('Extraction failed. Try a clearer screenshot.', true);
  } finally { extractBtn.disabled = false; }
});

copyBtn.addEventListener('click', async () => {
  const rows = getOrderedRows(); if (!rows.length) return;
  try { await navigator.clipboard.writeText(toTSV(rows)); showStatus('Copied. Paste into Google Sheets or Excel.'); }
  catch (err) { console.error(err); showStatus('Copy failed.', true); }
});

copyNameBtn.addEventListener('click',   () => copyColumn('Name',   'Name'));
copyMobileBtn.addEventListener('click', () => copyColumn('Mobile', 'Mobile'));
copyEmailBtn.addEventListener('click',  () => copyColumn('Email',  'Email'));
copyUpiBtn.addEventListener('click',    () => copyColumn('UPI ID', 'UPI ID'));

downloadCsvBtn.addEventListener('click', () => {
  const rows = getOrderedRows(); if (!rows.length) return;
  downloadFile(toCSV(rows), 'extracted_data.csv', 'text/csv;charset=utf-8');
});

downloadXlsxBtn.addEventListener('click', () => {
  const rows = getOrderedRows(); if (!rows.length) return;
  const ws = XLSX.utils.json_to_sheet(rows, { header: HEADERS });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ExtractedData');
  XLSX.writeFile(wb, 'extracted_data.xlsx');
});

checkDupBtn.addEventListener('click', showDuplicates);
