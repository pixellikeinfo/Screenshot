/* ═══════════════════════════════════════════════════════════════════
   Screenshot Data Extractor  –  app.js  (final audited build)
   ═══════════════════════════════════════════════════════════════════ */

/* ── DOM refs ─────────────────────────────────────────────────────── */
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
   SECTION 1 – PHONE NUMBER UTILITIES
   ════════════════════════════════════════════════════════════════════ */

/**
 * Strip all non-digit characters and return a canonical phone string:
 *   Indian  → exactly 10 digits starting with 6-9
 *   Intl    → "+" followed by full digit string (7–15 digits, non-Indian)
 *   Invalid → ""
 *
 * Also recovers from single OCR-noise digit on 11-digit strings.
 */
function canonicalPhone(raw) {
  const digits = raw.replace(/\D/g, '');

  // Indian with +91 / 91 prefix → 12 digits
  if (digits.length === 12 && digits.startsWith('91')) {
    const n = digits.slice(2);
    if (/^[6-9]\d{9}$/.test(n)) return n;
  }
  // Indian with leading 0 → 11 digits
  if (digits.length === 11 && digits.startsWith('0')) {
    const n = digits.slice(1);
    if (/^[6-9]\d{9}$/.test(n)) return n;
  }
  // Indian bare 10 digits
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) return digits;

  // OCR noise: 11 digits, not 91/0-prefixed → one stray digit attached
  if (digits.length === 11 && !digits.startsWith('91') && !digits.startsWith('0')) {
    const dropFirst = digits.slice(1);
    const dropLast  = digits.slice(0, 10);
    if (/^[6-9]\d{9}$/.test(dropFirst)) return dropFirst;
    if (/^[6-9]\d{9}$/.test(dropLast))  return dropLast;
  }

  // International: not Indian-prefixed, 7–15 digits total
  if (
    digits.length >= 7 && digits.length <= 15 &&
    !digits.startsWith('91') &&
    !digits.startsWith('0')
  ) {
    return '+' + digits;
  }

  return '';
}

/**
 * Extract all distinct phone numbers from a text string.
 *
 * Three passes:
 *   1. RE_INDIAN  – Indian numbers in all formats (with/without +91, spaces/dashes)
 *   2. RE_INTL_PLUS – International numbers that start with an explicit '+'
 *   3. RE_INTL_BARE – Bare international digit runs of 11-15 digits
 *
 * No sliding window anywhere → zero phantom numbers.
 */
function phonesFromText(text) {
  // Conservative OCR digit-context fixes only
  const t = text
    .replace(/(?<=\d\s*)[oO](?=\s*\d)/g, '0')  // O between digits → 0
    .replace(/[lI|](?=\d)/g, '1')               // l/I/| before digit → 1
    .replace(/(?<=\d)[lI|]/g, '1');             // l/I/| after digit → 1

  const seen   = new Set();
  const result = [];

  const tryAdd = (raw) => {
    const c = canonicalPhone(raw);
    if (c && !seen.has(c)) { seen.add(c); result.push(c); }
  };

  // Pass 1 – Indian: optional (+91 / 91 / 0) then MUST start [6-9] then 9 more digits
  // Separators (space, dot, dash, brackets) allowed between every digit
  const RE_INDIAN =
    /(?<!\d)(?:\+\s*91[\s.\-()]*|91[\s.\-()]*|0[\s.\-()]*)?[6-9](?:[\s.\-()]*\d){9}(?!\d)/g;

  // Pass 2 – International with explicit '+' sign, NOT +91
  // Country code 1-3 digits, then 6-12 more digits (separators allowed)
  const RE_INTL_PLUS =
    /\+(?!91(?:\s|$|\D))(?!0)[1-9]\d{0,2}[\s.\-()]*(?:\d[\s.\-()]*){6,12}\d(?!\d)/g;

  // Pass 3 – Bare international: 11-15 consecutive digits, not starting 91/0
  // Must be isolated (no adjacent digit). Avoids timestamps, IDs etc.
  const RE_INTL_BARE =
    /(?<!\d)(?!91\d)(?!0)[2-9]\d{10,14}(?!\d)/g;

  let m;
  while ((m = RE_INDIAN.exec(t))    !== null) tryAdd(m[0]);
  while ((m = RE_INTL_PLUS.exec(t)) !== null) tryAdd(m[0]);
  while ((m = RE_INTL_BARE.exec(t)) !== null) tryAdd(m[0]);

  return result;
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 2 – NAME / EMAIL / UPI UTILITIES
   ════════════════════════════════════════════════════════════════════ */

function cleanStr(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function extractEmail(text) {
  // Standard email: local@domain.tld
  const m = text.match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i);
  return m ? cleanStr(m[0]) : '';
}

function extractUPI(text) {
  // UPI IDs: handle@bankhandle (no dot-TLD, 2-9 char bank code)
  // e.g.  name@ybl  name@oksbi  name@paytm  9876543210@upi
  // Must NOT look like a standard email (no dot in domain part)
  const m = text.match(/\b[\w.\-]{2,256}@[a-zA-Z]{2,9}\b/);
  if (!m) return '';
  const val = cleanStr(m[0]);
  // Reject if it's a standard email (domain contains a dot, meaning it's a TLD)
  if (/\.[a-zA-Z]{2,}$/.test(val.split('@')[1] || '')) return '';
  return val;
}

/** Remove WhatsApp "~ " prefix and other decorators */
function stripDecorators(s) {
  return s
    .replace(/^[\s~\u2022\u00b7*\-_]+/, '')
    .replace(/[\s~\u2022\u00b7*\-_]+$/, '')
    .trim();
}

/**
 * Is this string plausibly a human name?
 * Deliberately strict to avoid numbers, UI labels, etc. being treated as names.
 */
function isLikelyName(raw) {
  if (!raw) return false;
  const val = stripDecorators(raw);
  if (val.length < 2 || val.length > 60) return false;
  if (/[@:/\\]/.test(val)) return false;           // email/URL chars
  if (/\bupi\b/i.test(val)) return false;
  if (/\bmobile\b/i.test(val)) return false;
  if (/\bsearch\b/i.test(val)) return false;       // "Search..." OCR artefact
  if (/^[\d\s.\-+()]+$/.test(val)) return false;   // purely numeric
  const letters = (val.match(/[a-zA-Z]/g) || []).length;
  const digits  = (val.match(/\d/g) || []).length;
  if (letters < 2) return false;
  if (digits > letters) return false;               // more digits than letters → ID/code
  if (!val.includes(' ') && val.length > 25) return false; // single very-long token
  return true;
}

/**
 * Convert a raw OCR line into a clean name candidate
 * (strips UI noise words, normalises whitespace, strips decorators).
 */
function toNameCandidate(line) {
  const cleaned = line
    .replace(/\bmobile\b/gi, '')
    .replace(/\badd\b/gi, '')
    .replace(/\bview contacts\b/gi, '')
    .replace(/\bsearch\b/gi, '')
    .replace(/[^a-zA-Z0-9\s.'\-]/g, ' ');   // keep only safe name chars
  return stripDecorators(cleaned).replace(/\s{2,}/g, ' ').trim();
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 3 – STRUCTURED LINE-PAIR PARSING
   ════════════════════════════════════════════════════════════════════
   WhatsApp contact lists always have:
     Line N  :  "~ Name"
     Line N+1:  "+91 XXXXX XXXXX"
   We exploit this structure for reliable name ↔ number pairing.
   ════════════════════════════════════════════════════════════════════ */

function parseContactsFromText(text, globalEmail, globalUPI) {
  const rawLines   = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const linePhones = rawLines.map(l => phonesFromText(l));

  const assignedPhones = new Set();
  const records        = [];

  for (let i = 0; i < rawLines.length; i++) {
    const phones = linePhones[i];
    if (!phones.length) continue;

    for (const phone of phones) {
      if (assignedPhones.has(phone)) continue;
      assignedPhones.add(phone);

      let name = '';

      // ── Strategy 1: look BACKWARD up to 4 lines for a name-like line
      //    Stop immediately if we cross another phone-number line (boundary).
      for (let off = 1; off <= 4 && !name; off++) {
        const idx = i - off;
        if (idx < 0) break;
        if (linePhones[idx].length > 0) break;   // hit another phone line → stop
        const cand = toNameCandidate(rawLines[idx]);
        if (isLikelyName(cand)) name = cand;
      }

      // ── Strategy 2: same line — strip the number(s) and check remainder
      if (!name) {
        const stripped = rawLines[i]
          // remove Indian-style phone patterns
          .replace(/(?:\+\s*\d{1,3}[\s.\-()]*)?[6-9](?:[\s.\-()]*\d){9}/g, '')
          // remove any remaining +intl patterns
          .replace(/\+[\d\s.\-()]{6,}/g, '');
        const cand = toNameCandidate(stripped);
        if (isLikelyName(cand)) name = cand;
      }

      // ── Strategy 3: look FORWARD up to 2 lines (last resort)
      if (!name) {
        for (let off = 1; off <= 2 && !name; off++) {
          const idx = i + off;
          if (idx >= rawLines.length) break;
          if (linePhones[idx].length > 0) break;
          const cand = toNameCandidate(rawLines[idx]);
          if (isLikelyName(cand)) name = cand;
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
   SECTION 4 – IMAGE PRE-PROCESSING
   ════════════════════════════════════════════════════════════════════ */

async function preprocessImageVariants(file) {
  const variants = [];
  try {
    const bitmap = await createImageBitmap(file);

    // Helper: in-place black/white threshold on a canvas context
    const binarise = (ctx, w, h, thr) => {
      const id = ctx.getImageData(0, 0, w, h);
      const d  = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        const v = g > thr ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = v;
        // alpha stays 255
      }
      ctx.putImageData(id, 0, 0);
    };

    const toBlob = (c) => new Promise(res => c.toBlob(res, 'image/png'));

    const mkCanvas = (scale) => {
      const c = document.createElement('canvas');
      c.width  = bitmap.width  * scale;
      c.height = bitmap.height * scale;
      return c;
    };

    // v1 – 2× upscale + hard threshold 145 (works well on light backgrounds)
    {
      const c   = mkCanvas(2);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bitmap, 0, 0, c.width, c.height);
      binarise(ctx, c.width, c.height, 145);
      const b = await toBlob(c);
      if (b) variants.push(b);
    }

    // v2 – 2× greyscale + contrast boost (softer, good for coloured / gradient bg)
    {
      const c   = mkCanvas(2);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.filter = 'grayscale(1) contrast(1.5) brightness(1.1)';
      ctx.drawImage(bitmap, 0, 0, c.width, c.height);
      const b = await toBlob(c);
      if (b) variants.push(b);
    }

    // v3 – 3× upscale + threshold 128 (catches small / thin text)
    {
      const c   = mkCanvas(3);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bitmap, 0, 0, c.width, c.height);
      binarise(ctx, c.width, c.height, 128);
      const b = await toBlob(c);
      if (b) variants.push(b);
    }

    // v4 – 2× INVERTED then threshold (handles dark-mode / dark-bg screenshots)
    {
      const c   = mkCanvas(2);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, c.width, c.height);
      const id = ctx.getImageData(0, 0, c.width, c.height);
      const d  = id.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i]     = 255 - d[i];
        d[i + 1] = 255 - d[i + 1];
        d[i + 2] = 255 - d[i + 2];
      }
      ctx.putImageData(id, 0, 0);
      binarise(ctx, c.width, c.height, 128);
      const b = await toBlob(c);
      if (b) variants.push(b);
    }

  } catch (err) {
    console.error('Image preprocessing failed:', err);
  }
  return variants;
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 5 – OCR ORCHESTRATION
   ════════════════════════════════════════════════════════════════════ */

async function ocrBlob(blob) {
  try {
    const { data: { text } } = await Tesseract.recognize(blob, 'eng', {
      tessedit_pageseg_mode: 6,   // uniform block of text
    });
    return text || '';
  } catch (err) {
    console.error('OCR failed for blob:', err);
    return '';
  }
}

async function runOCR(file) {
  // Run on original first
  const origText = await ocrBlob(file);

  // Run on all preprocessed variants in parallel
  const variants     = await preprocessImageVariants(file);
  const variantTexts = await Promise.all(variants.map(v => ocrBlob(v)));

  const allTexts = [origText, ...variantTexts].filter(t => t.trim().length > 0);

  if (!allTexts.length) {
    return [{ file: file.name, name: '', mobile: '', email: '', upi: '' }];
  }

  // Score each OCR result by phone count, pick the best two for structured parsing
  // (using top-2 avoids over-merging which scrambles line order)
  const scored = allTexts
    .map(t => ({ text: t, score: phonesFromText(t).length }))
    .sort((a, b) => b.score - a.score);

  const primaryText   = scored[0]?.text || '';
  const secondaryText = scored[1]?.text || '';

  // Email + UPI: scan all texts combined (they are single-value global fields,
  // not per-line, so merging here is safe and maximises detection)
  const allMerged  = allTexts.join('\n');
  const globalEmail = extractEmail(allMerged);
  const globalUPI   = extractUPI(allMerged);

  // Parse structured contacts from the two best OCR texts
  const primaryRecords   = parseContactsFromText(primaryText,   globalEmail, globalUPI);
  const secondaryRecords = parseContactsFromText(secondaryText, globalEmail, globalUPI);

  // Merge: primary wins; secondary only adds phones not already found
  const seenPhones = new Set(primaryRecords.map(r => r.mobile));
  const merged     = [...primaryRecords];
  for (const r of secondaryRecords) {
    if (!seenPhones.has(r.mobile)) {
      seenPhones.add(r.mobile);
      merged.push(r);
    }
  }

  if (!merged.length) {
    return [{ file: file.name, name: '', mobile: '', email: globalEmail, upi: globalUPI }];
  }

  return merged.map(r => ({ file: file.name, ...r }));
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 6 – TABLE / EXPORT / UI HELPERS
   ════════════════════════════════════════════════════════════════════ */

function selectedFields() {
  return Array.from(document.querySelectorAll('.field-checkbox:checked')).map(el => el.value);
}

function objectToOrderedRow(data) {
  return {
    File:     cleanStr(data.file),
    Name:     cleanStr(data.name),
    Mobile:   cleanStr(data.mobile),
    Email:    cleanStr(data.email),
    'UPI ID': cleanStr(data.upi),
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

function getOrderedRows() {
  return extractedRows.map(objectToOrderedRow);
}

function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b91c1c' : '#334155';
}

function getDuplicateMobiles(rows) {
  const count = {};
  rows.forEach(row => {
    if (row.Mobile) count[row.Mobile] = (count[row.Mobile] || 0) + 1;
  });
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
  return [
    HEADERS.join('\t'),
    ...rows.map(r => HEADERS.map(k => esc(r[k])).join('\t')),
  ].join('\n');
}

function toCSV(rows) {
  const esc = v => {
    const s = (v ?? '').toString();
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    HEADERS.join(','),
    ...rows.map(r => HEADERS.map(k => esc(r[k])).join(',')),
  ].join('\n');
}

function downloadFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function enableActions(enabled) {
  [copyBtn, copyNameBtn, copyMobileBtn, copyEmailBtn, copyUpiBtn,
   downloadCsvBtn, downloadXlsxBtn, checkDupBtn].forEach(btn => {
    btn.disabled = !enabled;
  });
}

function copyColumn(headerKey, label) {
  const values = getOrderedRows().map(row => row[headerKey] || '').join('\n');
  navigator.clipboard.writeText(values)
    .then(() => showStatus(`Copied ${label} column.`))
    .catch(err => { console.error(err); showStatus('Copy failed.', true); });
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 7 – FILE SELECTION & IMAGE PREVIEWS
   ════════════════════════════════════════════════════════════════════ */

function fileKey(file) {
  return `${file.name}__${file.size}__${file.lastModified}`;
}

function updateSelectedCount() {
  selectedCountEl.textContent = selectedFiles.length
    ? `${selectedFiles.length} file(s) selected.`
    : 'No files selected yet.';
}

function addSelectedFiles(newFiles) {
  const seen = new Set(selectedFiles.map(fileKey));
  newFiles.forEach(f => {
    const k = fileKey(f);
    if (!seen.has(k)) { selectedFiles.push(f); seen.add(k); }
  });
}

function removeSelectedFile(targetFile) {
  selectedFiles = selectedFiles.filter(f => fileKey(f) !== fileKey(targetFile));
  renderPreviews(selectedFiles);
  updateSelectedCount();
}

function clearPreviews() {
  previewUrls.forEach(url => URL.revokeObjectURL(url));
  previewUrls = [];
  previewGrid.innerHTML = '';
}

function renderPreviews(files) {
  clearPreviews();
  files.forEach(file => {
    const url = URL.createObjectURL(file);
    previewUrls.push(url);

    const card       = document.createElement('div');
    card.className   = 'preview-card';

    const removeBtn  = document.createElement('button');
    removeBtn.type   = 'button';
    removeBtn.className = 'preview-remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', `Remove ${file.name}`);
    removeBtn.addEventListener('click', e => {
      e.stopPropagation();
      removeSelectedFile(file);
    });

    const previewBtn = document.createElement('button');
    previewBtn.type  = 'button';
    previewBtn.className = 'preview-open-btn';
    previewBtn.addEventListener('click', () => {
      modalImage.src = url;
      modalCaption.textContent = file.name;
      imageModal.hidden = false;
    });

    const img      = document.createElement('img');
    img.src        = url;
    img.alt        = file.name;

    const nameSpan = document.createElement('span');
    nameSpan.className   = 'preview-name';
    nameSpan.textContent = file.name;

    previewBtn.appendChild(img);
    previewBtn.appendChild(nameSpan);
    card.appendChild(removeBtn);
    card.appendChild(previewBtn);
    previewGrid.appendChild(card);
  });
}

function closePreviewModal() {
  imageModal.hidden = true;
  modalImage.removeAttribute('src');
  modalCaption.textContent = '';
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 8 – DUPLICATE DETECTION MODAL
   ════════════════════════════════════════════════════════════════════ */

function showDuplicates() {
  const rows   = getOrderedRows();
  const dupSet = getDuplicateMobiles(rows);

  if (!dupSet.size) {
    dupModalBody.innerHTML = '<p class="no-dup">✅ No duplicate mobile numbers found.</p>';
  } else {
    let html = `<p class="dup-count">${dupSet.size} duplicate number(s) found:</p>
      <table class="dup-table">
        <thead><tr><th>Mobile</th><th>Count</th><th>Names</th></tr></thead>
        <tbody>`;
    dupSet.forEach(mobile => {
      const matching = rows.filter(r => r.Mobile === mobile);
      const names    = [...new Set(matching.map(r => r.Name).filter(Boolean))].join(', ');
      html += `<tr>
        <td>${mobile}</td>
        <td>${matching.length}</td>
        <td>${names || '—'}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    dupModalBody.innerHTML = html;
  }

  dupModal.hidden = false;
}

function closeDupModal() {
  dupModal.hidden = true;
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 9 – EVENT LISTENERS
   ════════════════════════════════════════════════════════════════════ */

imageInput.addEventListener('change', () => {
  addSelectedFiles(Array.from(imageInput.files || []));
  renderPreviews(selectedFiles);
  updateSelectedCount();
  imageInput.value = '';
});

closeModalBtn.addEventListener('click', closePreviewModal);

imageModal.addEventListener('click', e => {
  if (e.target === imageModal) closePreviewModal();
});

closeDupModalBtn.addEventListener('click', closeDupModal);

dupModal.addEventListener('click', e => {
  if (e.target === dupModal) closeDupModal();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!imageModal.hidden) closePreviewModal();
    if (!dupModal.hidden)   closeDupModal();
  }
});

extractBtn.addEventListener('click', async () => {
  const files  = selectedFiles;
  const fields = selectedFields();

  if (!files.length) {
    showStatus('Please upload at least one screenshot.', true);
    return;
  }
  if (!fields.length) {
    showStatus('Please select at least one field to extract.', true);
    return;
  }

  extractBtn.disabled = true;
  enableActions(false);
  extractedRows = [];
  renderTable([]);

  try {
    for (let i = 0; i < files.length; i++) {
      showStatus(`Processing ${i + 1}/${files.length}: ${files[i].name} …`);
      const results = await runOCR(files[i]);
      results
        .filter(r => !fields.includes('mobile') || r.mobile)
        .forEach(r => extractedRows.push(applyFieldSelection(r, fields)));
    }

    const orderedRows = getOrderedRows();
    renderTable(orderedRows);
    enableActions(orderedRows.length > 0);

    const mobileCount = orderedRows.filter(r => r.Mobile).length;
    const dupSet      = getDuplicateMobiles(orderedRows);
    const dupMsg      = dupSet.size ? `  ⚠️ ${dupSet.size} duplicate(s) detected.` : '';
    showStatus(`Done. ${orderedRows.length} row(s) · ${mobileCount} mobile number(s).${dupMsg}`);
  } catch (err) {
    console.error(err);
    showStatus('Extraction failed. Please try with a clearer screenshot.', true);
  } finally {
    extractBtn.disabled = false;
  }
});

copyBtn.addEventListener('click', async () => {
  const rows = getOrderedRows();
  if (!rows.length) return;
  try {
    await navigator.clipboard.writeText(toTSV(rows));
    showStatus('Copied all columns. Paste into Google Sheets or Excel.');
  } catch (err) {
    console.error(err);
    showStatus('Copy failed.', true);
  }
});

copyNameBtn.addEventListener('click',   () => copyColumn('Name',   'Name'));
copyMobileBtn.addEventListener('click', () => copyColumn('Mobile', 'Mobile'));
copyEmailBtn.addEventListener('click',  () => copyColumn('Email',  'Email'));
copyUpiBtn.addEventListener('click',    () => copyColumn('UPI ID', 'UPI ID'));

downloadCsvBtn.addEventListener('click', () => {
  const rows = getOrderedRows();
  if (!rows.length) return;
  downloadFile(toCSV(rows), 'extracted_data.csv', 'text/csv;charset=utf-8');
});

downloadXlsxBtn.addEventListener('click', () => {
  const rows = getOrderedRows();
  if (!rows.length) return;
  const ws = XLSX.utils.json_to_sheet(rows, { header: HEADERS });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ExtractedData');
  XLSX.writeFile(wb, 'extracted_data.xlsx');
});

checkDupBtn.addEventListener('click', showDuplicates);
