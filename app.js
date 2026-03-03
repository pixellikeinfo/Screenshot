/* ═══════════════════════════════════════════════════════════════════
   Screenshot Data Extractor – app.js
   Uses Google Gemini 1.5 Flash Vision API (1500 free/day)
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
const apiKeyInput      = document.getElementById('apiKeyInput');
const saveKeyBtn       = document.getElementById('saveKeyBtn');
const clearKeyBtn      = document.getElementById('clearKeyBtn');
const apiKeyStatus     = document.getElementById('apiKeyStatus');

const HEADERS = ['File', 'Name', 'Mobile', 'Email', 'UPI ID'];
let extractedRows = [];
let previewUrls   = [];
let selectedFiles = [];

/* ════════════════════════════════════════════════════════════════════
   SECTION 1 – API KEY MANAGEMENT
   Key stored in browser localStorage only — never in any file
   ════════════════════════════════════════════════════════════════════ */

function getApiKey() {
  return localStorage.getItem('gemini_api_key') || apiKeyInput.value.trim();
}

// Load saved key on page open
(function loadSavedKey() {
  const saved = localStorage.getItem('gemini_api_key');
  if (saved) {
    apiKeyInput.value = saved;
    apiKeyStatus.textContent = '✅ API key loaded.';
    apiKeyStatus.style.color = 'green';
  }
})();

saveKeyBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (!key.startsWith('AIza')) {
    apiKeyStatus.textContent = '❌ Invalid key — Gemini keys start with "AIza"';
    apiKeyStatus.style.color = '#b91c1c';
    return;
  }
  localStorage.setItem('gemini_api_key', key);
  apiKeyStatus.textContent = '✅ Key saved in your browser only. Never shared.';
  apiKeyStatus.style.color = 'green';
});

clearKeyBtn.addEventListener('click', () => {
  localStorage.removeItem('gemini_api_key');
  apiKeyInput.value = '';
  apiKeyStatus.textContent = 'Key cleared.';
  apiKeyStatus.style.color = '#64748b';
});

/* ════════════════════════════════════════════════════════════════════
   SECTION 2 – GEMINI VISION API
   Model: gemini-1.5-flash  →  1,500 requests/day FREE
   ════════════════════════════════════════════════════════════════════ */

function cleanStr(v) { return (v || '').replace(/\s+/g, ' ').trim(); }

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

async function runOCR(file) {
  const apiKey = getApiKey();
  if (!apiKey) {
    showStatus('⚠️ Please enter your Gemini API key above and click Save.', true);
    return [{ file: file.name, name: '', mobile: '', email: '', upi: '' }];
  }

  let base64, mimeType;
  try {
    base64   = await fileToBase64(file);
    mimeType = file.type || 'image/jpeg';
  } catch (e) {
    console.error('File read error:', e);
    return [{ file: file.name, name: '', mobile: '', email: '', upi: '' }];
  }

  const prompt = `Look at this screenshot carefully. It shows a list of contacts or phone numbers.

Your job:
1. Find EVERY phone number visible — read each digit EXACTLY as shown on screen.
2. For each number, find its associated name (shown just above or beside the number). If no name, leave it blank.
3. Also extract any email address or UPI ID if visible.

Return ONLY a raw JSON array — no explanation, no markdown, no code fences. Example:
[
  {"name": "Jeevan bose33", "mobile": "+917907425814", "email": "", "upi": ""},
  {"name": "", "mobile": "+919746768963", "email": "", "upi": ""}
]

Rules:
- Copy each number EXACTLY as shown including country code (e.g. +91, +971)
- Remove spaces within the number but keep the + sign
- If no country code shown, write the number as-is
- Do NOT change or guess any digit
- Copy the name exactly as shown
- If nothing found, return []`;

  try {
    // CORRECT model name: gemini-1.5-flash (NOT gemini-1.5-flash-latest)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: prompt }
          ]
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 2048 }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const msg = data.error?.message || 'Gemini API error';
      throw new Error(msg);
    }

    const raw   = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const clean = raw.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      console.error('JSON parse failed:', clean);
      throw new Error('Gemini returned unexpected response format');
    }

    if (!Array.isArray(parsed) || !parsed.length) {
      return [{ file: file.name, name: '', mobile: '', email: '', upi: '' }];
    }

    return parsed.map(r => ({
      file:   file.name,
      name:   cleanStr(r.name   || ''),
      mobile: cleanStr(r.mobile || ''),
      email:  cleanStr(r.email  || ''),
      upi:    cleanStr(r.upi    || ''),
    }));

  } catch (err) {
    console.error('Gemini API error:', err);
    showStatus(`❌ Gemini error: ${err.message}`, true);
    return [{ file: file.name, name: '', mobile: '', email: '', upi: '' }];
  }
}

/* ════════════════════════════════════════════════════════════════════
   SECTION 3 – TABLE / EXPORT HELPERS
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
   SECTION 4 – FILE SELECTION & PREVIEWS
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
   SECTION 5 – DUPLICATE MODAL
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
   SECTION 6 – EVENT LISTENERS
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
