/* ═══════════════════════════════════════════════════════════════════
   Screenshot Data Extractor – app.js
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
   SECTION 1 – PHONE NUMBER UTILITIES
   ════════════════════════════════════════════════════════════════════ */

function cleanStr(v) { return (v || '').replace(/\s+/g, ' ').trim(); }

/**
 * Apply conservative OCR character fixes ONLY in digit context.
 * We do NOT replace 9→9, 7→7 etc. — only clearly wrong substitutions.
 */
function fixOCRDigits(text) {
  return text
    .replace(/(?<=\d\s*)[oO](?=\s*\d)/g, '0')   // O between digits → 0
    .replace(/[lI|](?=\d)/g, '1')                 // l/I/| before digit → 1
    .replace(/(?<=\d)[lI|]/g, '1');               // l/I/| after digit → 1
}

/**
 * Given a raw matched phone string, return a canonical phone:
 *   Indian (+91/91/0 or bare 10-digit [6-9]xxx) → plain 10 digits
 *   True international (explicit + with non-91 code) → "+<digits>"
 *   Invalid → ""
 *
 * KEY RULE: We ONLY store international numbers when the input actually
 * had a '+' sign in it. This prevents OCR misreads like "+97" (should be
 * "+91") from generating fake international numbers.
 */
function canonicalPhone(raw, hadPlusSign) {
  const digits = raw.replace(/\D/g, '');

  // ── Indian: +91 or 91 prefix (12 digits)
  if (digits.length === 12 && digits.startsWith('91')) {
    const n = digits.slice(2);
    if (/^[6-9]\d{9}$/.test(n)) return n;
  }
  // ── Indian: leading 0 (11 digits)
  if (digits.length === 11 && digits.startsWith('0')) {
    const n = digits.slice(1);
    if (/^[6-9]\d{9}$/.test(n)) return n;
  }
  // ── Indian: bare 10 digits starting 6–9
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) return digits;

  // ── OCR noise recovery: 11 digits, no Indian prefix
  //    Try dropping first or last digit to recover a valid Indian number
  if (digits.length === 11 && !digits.startsWith('91') && !digits.startsWith('0')) {
    const d1 = digits.slice(1);
    const d2 = digits.slice(0, 10);
    if (/^[6-9]\d{9}$/.test(d1)) return d1;
    if (/^[6-9]\d{9}$/.test(d2)) return d2;
  }

  // ── International: ONLY accept if the original text had a literal '+' sign
  //    AND the digits don't look like a mangled Indian number (starting 91)
  //    AND total digits are 7–15
  if (
    hadPlusSign &&
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
 * Pass 1 – RE_INDIAN: Indian numbers in every format
 * Pass 2 – RE_INTL_PLUS: True international with explicit '+' (NOT +91)
 *
 * NO bare-international pass — too many false positives from OCR noise.
 * NO sliding window — zero phantom numbers.
 */
function phonesFromText(text) {
  const t = fixOCRDigits(text);

  const seen   = new Set();
  const result = [];

  const tryAdd = (raw, hadPlus) => {
    const c = canonicalPhone(raw, hadPlus);
    if (c && !seen.has(c)) { seen.add(c); result.push(c); }
  };

  // Pass 1: Indian numbers (+91 / 91 / 0 prefix, or bare 10-digit [6-9]start)
  // Separators (space, dash, dot, brackets) allowed between every digit.
  const RE_INDIAN =
    /(?<!\d)(?:\+\s*91[\s.\-()]*|91[\s.\-()]*|0[\s.\-()]*)?[6-9](?:[\s.\-()]*\d){9}(?!\d)/g;

  // Pass 2: True international – must have literal '+', must NOT be +91
  // Country code 1-3 digits, then enough digits to make 7-15 total.
  // The (?!91) ensures +91 numbers are handled by Pass 1 only.
  const RE_INTL_PLUS =
    /\+(?!91[\s.\-()])(?!0)[1-9]\d{0,2}[\s.\-()]*(?:\d[\s.\-()]*){5,12}\d(?!\d)/g;

  let m;
  while ((m = RE_INDIAN.exec(t))    !== null) tryAdd(m[0], false);
  while ((m = RE_INTL_PLUS.exec(t)) !== null) tryAdd(m[0], true);

  return result;
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 2 – NAME / EMAIL / UPI UTILITIES
   ════════════════════════════════════════════════════════════════════ */

function extractEmail(text) {
  const m = text.match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i);
  return m ? cleanStr(m[0]) : '';
}

function extractUPI(text) {
  const m = text.match(/\b[\w.\-]{2,256}@[a-zA-Z]{2,9}\b/);
  if (!m) return '';
  const val = cleanStr(m[0]);
  // Reject plain emails (domain has a dot-TLD)
  if (/\.[a-zA-Z]{2,}$/.test(val.split('@')[1] || '')) return '';
  return val;
}

/** Strip WhatsApp "~ " and other decorators from start/end */
function stripDecorators(s) {
  return s
    .replace(/^[\s~\u2022\u00b7*\-_]+/, '')
    .replace(/[\s~\u2022\u00b7*\-_]+$/, '')
    .trim();
}

/**
 * Strip leading noise tokens from a name candidate.
 * Handles cases like:
 *   "1 Jeevan bose33"  → "Jeevan bose33"   (list number prefix)
 *   "TTA Krishnasree"  → "Krishnasree"      (short OCR noise prefix)
 *   "ws Naveen Bethany"→ "Naveen Bethany"   (2-char noise prefix)
 *   "7 Jeswin"         → "Jeswin"           (single digit prefix)
 */
function stripLeadingNoise(s) {
  // Remove a leading 1-3 char token that is NOT a real name word:
  // a token is "noise" if it is: purely digits, OR purely 2-3 uppercase letters
  // that don't form a real word (common OCR artefacts from buttons/icons)
  return s.replace(/^(?:\d{1,3}|[A-Z]{1,3})\s+/, '').trim();
}

/**
 * Full list of UI strings that should NEVER be treated as names.
 * These come from WhatsApp's own UI chrome that OCR picks up.
 */
const UI_NOISE = [
  'search', 'mobile', 'add', 'view contacts', 'view', 'contacts',
  'lte', 'tte', 'tta', 'tts', 'ttk',   // OCR misreads of "Add" button area
  'ws', 'wss',                            // OCR misreads of "View contacts"
  'ok', 'no',
];

function isUINoiseToken(s) {
  const lower = s.toLowerCase().trim();
  return UI_NOISE.includes(lower);
}

/**
 * Is this string plausibly a human name?
 */
function isLikelyName(raw) {
  if (!raw) return false;
  const val = stripDecorators(raw);
  if (val.length < 2 || val.length > 60) return false;
  if (/[@:/\\]/.test(val)) return false;
  if (/^[\d\s.\-+()]+$/.test(val)) return false;       // purely numeric
  if (isUINoiseToken(val)) return false;                // pure UI noise word

  const letters = (val.match(/[a-zA-Z]/g) || []).length;
  const digits  = (val.match(/\d/g) || []).length;
  if (letters < 2) return false;
  if (digits > letters) return false;
  if (!val.includes(' ') && val.length > 25) return false;
  return true;
}

/**
 * Convert a raw OCR line to a clean name candidate:
 *  - Remove all known UI noise words
 *  - Strip decorators and leading noise tokens
 *  - Normalise whitespace
 */
function toNameCandidate(line) {
  let s = line;
  // Remove known UI noise words (whole word, case-insensitive)
  s = s.replace(/\bmobile\b/gi, '');
  s = s.replace(/\badd\b/gi, '');
  s = s.replace(/\bview\s*contacts\b/gi, '');
  s = s.replace(/\bsearch\b/gi, '');
  // Keep only safe name characters
  s = s.replace(/[^a-zA-Z0-9\s.'\-]/g, ' ');
  // Strip decorators
  s = stripDecorators(s);
  // Normalise spaces
  s = s.replace(/\s{2,}/g, ' ').trim();
  // Strip leading noise token (digit or short-caps OCR artefact)
  s = stripLeadingNoise(s);
  return s;
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 3 – STRUCTURED LINE-PAIR PARSING
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

      // ── 1. Look BACKWARD up to 4 lines; stop at another phone line
      for (let off = 1; off <= 4 && !name; off++) {
        const idx = i - off;
        if (idx < 0) break;
        if (linePhones[idx].length > 0) break;
        const cand = toNameCandidate(rawLines[idx]);
        if (isLikelyName(cand)) name = cand;
      }

      // ── 2. Same-line remainder (strip phone digits and check what's left)
      if (!name) {
        const stripped = rawLines[i]
          .replace(/(?:\+\s*\d{1,3}[\s.\-()]*)?[6-9](?:[\s.\-()]*\d){9}/g, '')
          .replace(/\+[\d\s.\-()]{6,}/g, '');
        const cand = toNameCandidate(stripped);
        if (isLikelyName(cand)) name = cand;
      }

      // ── 3. Look FORWARD up to 2 lines (last resort)
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
    {
      const c = mkC(2), ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bitmap, 0, 0, c.width, c.height);
      binarise(ctx, c.width, c.height, 145);
      const b = await toBlob(c); if (b) variants.push(b);
    }

    // v2 – 2× greyscale + contrast (coloured / gradient backgrounds)
    {
      const c = mkC(2), ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.filter = 'grayscale(1) contrast(1.5) brightness(1.1)';
      ctx.drawImage(bitmap, 0, 0, c.width, c.height);
      const b = await toBlob(c); if (b) variants.push(b);
    }

    // v3 – 3× + threshold 128 (small / thin text)
    {
      const c = mkC(3), ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bitmap, 0, 0, c.width, c.height);
      binarise(ctx, c.width, c.height, 128);
      const b = await toBlob(c); if (b) variants.push(b);
    }

    // v4 – 2× INVERTED + threshold (dark-mode / dark-background screenshots)
    {
      const c = mkC(2), ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, c.width, c.height);
      const id = ctx.getImageData(0, 0, c.width, c.height);
      const d  = id.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2];
      }
      ctx.putImageData(id, 0, 0);
      binarise(ctx, c.width, c.height, 128);
      const b = await toBlob(c); if (b) variants.push(b);
    }

  } catch (err) { console.error('Preprocessing failed:', err); }
  return variants;
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 5 – OCR ORCHESTRATION
   ════════════════════════════════════════════════════════════════════ */

async function ocrBlob(blob) {
  try {
    const { data: { text } } = await Tesseract.recognize(blob, 'eng', {
      tessedit_pageseg_mode: 6,
    });
    return text || '';
  } catch (err) {
    console.error('OCR error:', err);
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

  // Pick the two OCR results with the most phone numbers found
  const scored = allTexts
    .map(t => ({ text: t, score: phonesFromText(t).length }))
    .sort((a, b) => b.score - a.score);

  const primaryText   = scored[0]?.text || '';
  const secondaryText = scored[1]?.text || '';

  // Email/UPI: scan all texts combined
  const allMerged  = allTexts.join('\n');
  const globalEmail = extractEmail(allMerged);
  const globalUPI   = extractUPI(allMerged);

  const primaryRecs   = parseContactsFromText(primaryText,   globalEmail, globalUPI);
  const secondaryRecs = parseContactsFromText(secondaryText, globalEmail, globalUPI);

  // Merge: primary wins; secondary fills missing phones only
  const seenPhones = new Set(primaryRecs.map(r => r.mobile));
  const merged     = [...primaryRecs];
  for (const r of secondaryRecs) {
    if (!seenPhones.has(r.mobile)) { seenPhones.add(r.mobile); merged.push(r); }
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
   SECTION 7 – FILE SELECTION & PREVIEWS
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
  previewUrls = [];
  previewGrid.innerHTML = '';
}

function renderPreviews(files) {
  clearPreviews();
  files.forEach(file => {
    const url = URL.createObjectURL(file);
    previewUrls.push(url);

    const card      = document.createElement('div');    card.className = 'preview-card';
    const removeBtn = document.createElement('button'); removeBtn.type = 'button';
    removeBtn.className = 'preview-remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', `Remove ${file.name}`);
    removeBtn.addEventListener('click', e => { e.stopPropagation(); removeSelectedFile(file); });

    const previewBtn = document.createElement('button'); previewBtn.type = 'button';
    previewBtn.className = 'preview-open-btn';
    previewBtn.addEventListener('click', () => {
      modalImage.src = url; modalCaption.textContent = file.name; imageModal.hidden = false;
    });

    const img      = document.createElement('img');  img.src = url; img.alt = file.name;
    const nameSpan = document.createElement('span'); nameSpan.className = 'preview-name';
    nameSpan.textContent = file.name;

    previewBtn.appendChild(img); previewBtn.appendChild(nameSpan);
    card.appendChild(removeBtn); card.appendChild(previewBtn);
    previewGrid.appendChild(card);
  });
}

function closePreviewModal() {
  imageModal.hidden = true;
  modalImage.removeAttribute('src');
  modalCaption.textContent = '';
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 8 – DUPLICATE MODAL
   ════════════════════════════════════════════════════════════════════ */

function showDuplicates() {
  const rows   = getOrderedRows();
  const dupSet = getDuplicateMobiles(rows);

  if (!dupSet.size) {
    dupModalBody.innerHTML = '<p class="no-dup">✅ No duplicate mobile numbers found.</p>';
  } else {
    let html = `<p class="dup-count">${dupSet.size} duplicate number(s) found:</p>
      <table class="dup-table">
        <thead><tr><th>Mobile</th><th>Count</th><th>Names</th></tr></thead><tbody>`;
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
   SECTION 9 – EVENT LISTENERS
   ════════════════════════════════════════════════════════════════════ */

imageInput.addEventListener('change', () => {
  addSelectedFiles(Array.from(imageInput.files || []));
  renderPreviews(selectedFiles);
  updateSelectedCount();
  imageInput.value = '';
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
    showStatus('Copied. Paste into Google Sheets or Excel.');
  } catch (err) { console.error(err); showStatus('Copy failed.', true); }
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
