const imageInput = document.getElementById('imageInput');
const extractBtn = document.getElementById('extractBtn');
const copyBtn = document.getElementById('copyBtn');
const copyNameBtn = document.getElementById('copyNameBtn');
const copyMobileBtn = document.getElementById('copyMobileBtn');
const copyEmailBtn = document.getElementById('copyEmailBtn');
const copyUpiBtn = document.getElementById('copyUpiBtn');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');
const downloadXlsxBtn = document.getElementById('downloadXlsxBtn');
const checkDupBtn = document.getElementById('checkDupBtn');
const statusEl = document.getElementById('status');
const tableBody = document.querySelector('#resultsTable tbody');
const previewGrid = document.getElementById('previewGrid');
const imageModal = document.getElementById('imageModal');
const modalImage = document.getElementById('modalImage');
const modalCaption = document.getElementById('modalCaption');
const closeModalBtn = document.getElementById('closeModalBtn');
const selectedCountEl = document.getElementById('selectedCount');
const dupModal = document.getElementById('dupModal');
const dupModalBody = document.getElementById('dupModalBody');
const closeDupModalBtn = document.getElementById('closeDupModalBtn');

const headers = ['File', 'Name', 'Mobile', 'Email', 'UPI ID'];
let extractedRows = [];
let previewUrls = [];
let selectedFiles = [];

/* ─── helpers ─────────────────────────────────────────────────── */

function selectedFields() {
  return Array.from(document.querySelectorAll('.field-checkbox:checked')).map((el) => el.value);
}

function cleanText(value) {
  return value ? value.replace(/\s+/g, ' ').trim() : '';
}

function extractEmail(text) {
  return cleanText((text.match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i) || [])[0]);
}

/* ─── Mobile extraction (robust) ──────────────────────────────── */

/**
 * Normalise a raw digit string to a plain 10-digit Indian mobile.
 * Handles +91 / 91 prefix, leading 0, spaces, dashes, dots, brackets.
 */
function normalizeIndianMobile(raw) {
  // strip all non-digit characters first
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return '';
}

function extractMobiles(text) {
  // OCR character substitutions
  const normalizedText = text
    .replace(/[oO]/g, '0')
    .replace(/[lI|]/g, '1')
    .replace(/[sS]/g, '5')
    .replace(/[bB]/g, '8');

  const uniqueNumbers = new Set();

  const addMobile = (raw) => {
    const n = normalizeIndianMobile(raw);
    if (/^[6-9]\d{9}$/.test(n)) uniqueNumbers.add(n);
  };

  // ── Pattern 1: full phone tokens including optional +91, separators, spaces
  // e.g. "+91 98765 43210", "91-9876543210", "9876543210"
  const phonePattern =
    /(?:\+\s*91[\s.\-()]*)(?:[6-9][\s.\-()]*(?:\d[\s.\-()]*){9})|(?:91[\s.\-()]*)(?:[6-9][\s.\-()]*(?:\d[\s.\-()]*){9})|(?:0[\s.\-()]*)(?:[6-9][\s.\-()]*(?:\d[\s.\-()]*){9})|[6-9][\s.\-()]*(?:\d[\s.\-()]*){9}/g;

  const matches = normalizedText.match(phonePattern) || [];
  matches.forEach((m) => addMobile(m));

  // ── Pattern 2: compact digit blocks – slide a 10-digit window
  const digitTokens = normalizedText.replace(/[^\d]/g, ' ').split(/\s+/).filter(Boolean);
  digitTokens.forEach((token) => {
    if (token.length < 10) return;
    // try whole token first (handles 10/11/12 digit)
    addMobile(token);
    // sliding window
    for (let i = 0; i <= token.length - 10; i++) {
      const candidate = token.slice(i, i + 10);
      if (/^[6-9]\d{9}$/.test(candidate)) uniqueNumbers.add(candidate);
    }
  });

  return Array.from(uniqueNumbers);
}

/* ─── UPI ──────────────────────────────────────────────────────── */

function extractUPI(text) {
  return cleanText((text.match(/\b[a-zA-Z0-9._\-]{2,}@[a-zA-Z]{2,}\b/) || [])[0]);
}

/* ─── Name extraction ──────────────────────────────────────────── */

function normalizeNameText(value) {
  return cleanText(
    value
      .replace(/[|]/g, 'I')
      .replace(/[0]/g, 'O')
      .replace(/\bmobile\b/gi, '')
      .replace(/\badd\b/gi, '')
      .replace(/\bview contacts\b/gi, '')
      .replace(/[^a-zA-Z0-9\s.''\-]/g, ' ')
  );
}

function isLikelyName(value) {
  if (!value) return false;
  if (value.length < 3 || value.length > 60) return false;
  if (/[@:]/.test(value)) return false;
  if (/\bupi\b/i.test(value)) return false;

  const letters = (value.match(/[a-zA-Z]/g) || []).length;
  const digits  = (value.match(/\d/g) || []).length;
  if (letters < 2) return false;
  if (digits > 0 && digits > Math.ceil(letters / 2)) return false;

  const words = value.trim().split(/\s+/);
  // reject lines that are purely one long token with no spaces AND look like IDs
  if (words.length === 1 && value.length > 30) return false;

  return true;
}

function extractName(text, foundValues) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeNameText(line))
    .filter(Boolean);

  for (const line of lines) {
    if (!isLikelyName(line)) continue;
    if (Object.values(foundValues).some((v) => v && line.includes(v))) continue;
    return line;
  }
  return '';
}

/**
 * Given the line that contains a mobile number, find the best associated name.
 * Strategy:
 *  1. Strip the number from the same line – if rest looks like a name, use it.
 *  2. Look at up to 3 lines ABOVE and BELOW for a name-like line.
 */
function extractNameForMobileLine(lines, lineIndex) {
  const currentLine = lines[lineIndex] || '';

  // Remove the mobile-ish part from the current line
  const withoutNumber = normalizeNameText(
    currentLine.replace(/(?:\+?\s*91[\s.\-()]*)?[6-9][\s.\-()]*(?:\d[\s.\-()]*){9}/g, '')
  );
  if (isLikelyName(withoutNumber)) return withoutNumber;

  // Search surrounding lines (prefer lines immediately above)
  for (let offset = 1; offset <= 3; offset++) {
    const prev = normalizeNameText(lines[lineIndex - offset] || '');
    if (isLikelyName(prev)) return prev;
  }
  for (let offset = 1; offset <= 2; offset++) {
    const next = normalizeNameText(lines[lineIndex + offset] || '');
    if (isLikelyName(next)) return next;
  }

  return '';
}

/* ─── Data ordering ────────────────────────────────────────────── */

function objectToOrderedRow(data) {
  return {
    File: data.file,
    Name: data.name,
    Mobile: data.mobile,
    Email: data.email,
    'UPI ID': data.upi,
  };
}

function applyFieldSelection(record, fields) {
  return {
    file: record.file,
    name: fields.includes('name')   ? record.name   : '',
    mobile: fields.includes('mobile') ? record.mobile : '',
    email: fields.includes('email')  ? record.email  : '',
    upi: fields.includes('upi')    ? record.upi    : '',
  };
}

function getOrderedRows() {
  return extractedRows.map(objectToOrderedRow);
}

/* ─── Status / UI helpers ──────────────────────────────────────── */

function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b91c1c' : '#334155';
}

function renderTable(rows) {
  tableBody.innerHTML = '';
  const dupMobiles = getDuplicateMobiles(rows);

  for (const row of rows) {
    const tr = document.createElement('tr');
    if (row.Mobile && dupMobiles.has(row.Mobile)) {
      tr.classList.add('dup-row');
    }
    headers.forEach((key) => {
      const td = document.createElement('td');
      td.textContent = row[key] || '';
      tr.appendChild(td);
    });
    tableBody.appendChild(tr);
  }
}

function toTSV(rows) {
  const esc = (v) => (v ?? '').toString().replace(/\t/g, ' ').replace(/\n/g, ' ');
  const lines = [headers.join('\t')];
  rows.forEach((row) => lines.push(headers.map((k) => esc(row[k])).join('\t')));
  return lines.join('\n');
}

function toCSV(rows) {
  const escCsv = (v) => {
    const raw = (v ?? '').toString();
    return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
  };
  const lines = [headers.join(',')];
  rows.forEach((row) => lines.push(headers.map((k) => escCsv(row[k])).join(',')));
  return lines.join('\n');
}

function downloadFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function enableActions(enabled) {
  [copyBtn, copyNameBtn, copyMobileBtn, copyEmailBtn, copyUpiBtn,
   downloadCsvBtn, downloadXlsxBtn, checkDupBtn].forEach((btn) => {
    btn.disabled = !enabled;
  });
}

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
  newFiles.forEach((file) => {
    const key = fileKey(file);
    if (!seen.has(key)) { selectedFiles.push(file); seen.add(key); }
  });
}

function removeSelectedFile(targetFile) {
  selectedFiles = selectedFiles.filter((f) => fileKey(f) !== fileKey(targetFile));
  renderPreviews(selectedFiles);
  updateSelectedCount();
}

/* ─── Previews ─────────────────────────────────────────────────── */

function clearPreviews() {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
  previewGrid.innerHTML = '';
}

function renderPreviews(files) {
  clearPreviews();
  files.forEach((file) => {
    const url = URL.createObjectURL(file);
    previewUrls.push(url);

    const card = document.createElement('div');
    card.className = 'preview-card';

    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'preview-open-btn';

    const img = document.createElement('img');
    img.src = url;
    img.alt = file.name;

    const name = document.createElement('span');
    name.className = 'preview-name';
    name.textContent = file.name;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'preview-remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', `Remove ${file.name}`);
    removeBtn.addEventListener('click', (e) => { e.stopPropagation(); removeSelectedFile(file); });

    previewBtn.appendChild(img);
    previewBtn.appendChild(name);
    previewBtn.addEventListener('click', () => {
      modalImage.src = url;
      modalCaption.textContent = file.name;
      imageModal.hidden = false;
    });

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

/* ─── Image pre-processing for better OCR ─────────────────────── */

/**
 * Returns multiple processed versions of the image so Tesseract
 * has the best chance of reading every number.
 *
 * Version 1: 2× upscale + adaptive threshold (original approach)
 * Version 2: 2× upscale, greyscale only (no harsh binarisation)
 *            – good for low-contrast or coloured backgrounds
 * Version 3: 3× upscale + slight contrast boost before threshold
 */
async function preprocessImageVariants(file) {
  const variants = [];

  try {
    const bitmap = await createImageBitmap(file);

    // ── variant 1: 2× + hard threshold ──
    {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width * 2;
      canvas.height = bitmap.height * 2;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d  = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const gray = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        const v = gray > 145 ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(id, 0, 0);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (blob) variants.push(blob);
    }

    // ── variant 2: 2× greyscale (soft) ──
    {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width * 2;
      canvas.height = bitmap.height * 2;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.filter = 'grayscale(1) contrast(1.4)';
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (blob) variants.push(blob);
    }

    // ── variant 3: 3× + higher threshold ──
    {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width * 3;
      canvas.height = bitmap.height * 3;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d  = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const gray = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        const v = gray > 128 ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(id, 0, 0);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (blob) variants.push(blob);
    }
  } catch (err) {
    console.error('Image preprocessing failed:', err);
  }

  return variants;
}

/* ─── OCR ──────────────────────────────────────────────────────── */

async function runOCR(file) {
  // Run OCR on original + all preprocessed variants, merge all text
  const textParts = [];

  const { data: { text: origText } } = await Tesseract.recognize(file, 'eng+hin', {
    tessedit_pageseg_mode: 6,   // assume a single uniform block of text
  });
  textParts.push(origText);

  const variants = await preprocessImageVariants(file);
  for (const variant of variants) {
    try {
      const { data: { text } } = await Tesseract.recognize(variant, 'eng', {
        tessedit_pageseg_mode: 6,
      });
      textParts.push(text);
    } catch (e) {
      console.error('Variant OCR failed:', e);
    }
  }

  const mergedText = textParts.join('\n');

  const email = extractEmail(mergedText);
  const upi   = extractUPI(mergedText);

  // Build a deduplicated ordered line pool from all variants
  const seenLines = new Set();
  const linePool  = [];
  mergedText.split(/\r?\n/).forEach((l) => {
    const t = l.trim();
    if (t && !seenLines.has(t)) { seenLines.add(t); linePool.push(t); }
  });

  const mobiles     = extractMobiles(mergedText);
  const fallbackName = extractName(mergedText, { email, upi });

  if (!mobiles.length) {
    return [{
      file: file.name,
      name: fallbackName || 'Name not found',
      mobile: '',
      email,
      upi,
    }];
  }

  return mobiles.map((mobile) => {
    // Find the line that best contains this mobile number
    const lineIndex = linePool.findIndex((line) => extractMobiles(line).includes(mobile));
    const mappedName = lineIndex >= 0 ? extractNameForMobileLine(linePool, lineIndex) : '';

    return {
      file: file.name,
      name: mappedName || fallbackName || 'Name not found',
      mobile,
      email,
      upi,
    };
  });
}

/* ─── Duplicate detection ──────────────────────────────────────── */

function getDuplicateMobiles(rows) {
  const count = {};
  rows.forEach((row) => {
    if (row.Mobile) count[row.Mobile] = (count[row.Mobile] || 0) + 1;
  });
  return new Set(Object.keys(count).filter((k) => count[k] > 1));
}

function showDuplicates() {
  const rows = getOrderedRows();
  const dupSet = getDuplicateMobiles(rows);

  if (!dupSet.size) {
    dupModalBody.innerHTML = '<p class="no-dup">✅ No duplicate mobile numbers found.</p>';
  } else {
    let html = `<p class="dup-count">${dupSet.size} duplicate mobile number(s) found:</p><table class="dup-table"><thead><tr><th>Mobile</th><th>Occurrences</th><th>Names</th></tr></thead><tbody>`;
    dupSet.forEach((mobile) => {
      const matching = rows.filter((r) => r.Mobile === mobile);
      const names    = [...new Set(matching.map((r) => r.Name).filter(Boolean))].join(', ');
      html += `<tr><td>${mobile}</td><td>${matching.length}</td><td>${names || '—'}</td></tr>`;
    });
    html += '</tbody></table>';
    dupModalBody.innerHTML = html;
  }

  dupModal.hidden = false;
}

function closeDupModal() {
  dupModal.hidden = true;
}

/* ─── Column copy helper ───────────────────────────────────────── */

function copyColumn(headerKey, label) {
  const values = getOrderedRows().map((row) => row[headerKey] || '').join('\n');
  navigator.clipboard.writeText(values)
    .then(() => showStatus(`Copied ${label} column.`))
    .catch((err) => {
      console.error(err);
      showStatus('Copy failed. Your browser may block clipboard permission.', true);
    });
}

/* ─── Event listeners ──────────────────────────────────────────── */

imageInput.addEventListener('change', () => {
  const files = Array.from(imageInput.files || []);
  addSelectedFiles(files);
  renderPreviews(selectedFiles);
  updateSelectedCount();
  imageInput.value = '';
});

closeModalBtn.addEventListener('click', closePreviewModal);

imageModal.addEventListener('click', (e) => {
  if (e.target === imageModal) closePreviewModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!imageModal.hidden) closePreviewModal();
    if (!dupModal.hidden)   closeDupModal();
  }
});

closeDupModalBtn.addEventListener('click', closeDupModal);

dupModal.addEventListener('click', (e) => {
  if (e.target === dupModal) closeDupModal();
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
      showStatus(`Processing ${i + 1}/${files.length}: ${files[i].name}`);
      const results = await runOCR(files[i]);
      results
        .filter((r) => !fields.includes('mobile') || r.mobile)
        .forEach((r) => extractedRows.push(applyFieldSelection(r, fields)));
    }

    const orderedRows = getOrderedRows();
    renderTable(orderedRows);
    enableActions(orderedRows.length > 0);

    const mobileCount = orderedRows.filter((r) => r.Mobile).length;
    const dupMobiles  = getDuplicateMobiles(orderedRows);
    const dupMsg      = dupMobiles.size ? ` | ⚠️ ${dupMobiles.size} duplicate(s) detected.` : '';
    showStatus(`Done. Extracted ${orderedRows.length} row(s) with ${mobileCount} mobile number(s).${dupMsg}`);
  } catch (err) {
    console.error(err);
    showStatus('Extraction failed. Please try with clearer screenshots.', true);
  } finally {
    extractBtn.disabled = false;
  }
});

copyBtn.addEventListener('click', async () => {
  const orderedRows = getOrderedRows();
  if (!orderedRows.length) return;
  try {
    await navigator.clipboard.writeText(toTSV(orderedRows));
    showStatus('Copied all columns in sheet-friendly format. Paste into Google Sheets or Excel.');
  } catch (err) {
    console.error(err);
    showStatus('Copy failed. Your browser may block clipboard permission.', true);
  }
});

copyNameBtn.addEventListener('click', ()   => copyColumn('Name',   'Name'));
copyMobileBtn.addEventListener('click', ()  => copyColumn('Mobile', 'Mobile'));
copyEmailBtn.addEventListener('click', ()   => copyColumn('Email',  'Email'));
copyUpiBtn.addEventListener('click', ()     => copyColumn('UPI ID', 'UPI ID'));

downloadCsvBtn.addEventListener('click', () => {
  const orderedRows = getOrderedRows();
  if (!orderedRows.length) return;
  downloadFile(toCSV(orderedRows), 'extracted_data.csv', 'text/csv;charset=utf-8');
});

downloadXlsxBtn.addEventListener('click', () => {
  const orderedRows = getOrderedRows();
  if (!orderedRows.length) return;
  const worksheet = XLSX.utils.json_to_sheet(orderedRows, { header: headers });
  const workbook  = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'ExtractedData');
  XLSX.writeFile(workbook, 'extracted_data.xlsx');
});

checkDupBtn.addEventListener('click', showDuplicates);
