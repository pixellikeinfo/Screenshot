const imageInput = document.getElementById('imageInput');
const extractBtn = document.getElementById('extractBtn');
const toggleDupesBtn = document.getElementById('toggleDupesBtn'); // New button
const copyBtn = document.getElementById('copyBtn');
const copyNameBtn = document.getElementById('copyNameBtn');
const copyMobileBtn = document.getElementById('copyMobileBtn');
const copyEmailBtn = document.getElementById('copyEmailBtn');
const copyUpiBtn = document.getElementById('copyUpiBtn');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');
const downloadXlsxBtn = document.getElementById('downloadXlsxBtn');
const statusEl = document.getElementById('status');
const tableBody = document.querySelector('#resultsTable tbody');
const previewGrid = document.getElementById('previewGrid');
const imageModal = document.getElementById('imageModal');
const modalImage = document.getElementById('modalImage');
const modalCaption = document.getElementById('modalCaption');
const closeModalBtn = document.getElementById('closeModalBtn');
const selectedCountEl = document.getElementById('selectedCount');

const headers = ['Status', 'File', 'Name', 'Mobile', 'Email', 'UPI ID'];
let extractedRows = [];
let previewUrls = [];
let selectedFiles = [];
let showOnlyUnique = false;

// --- Helper Functions (Restored) ---

function selectedFields() {
  return Array.from(document.querySelectorAll('.field-checkbox:checked')).map((item) => item.value);
}

function cleanText(value) {
  return value ? value.replace(/\s+/g, ' ').trim() : '';
}

function extractEmail(text) {
  return cleanText((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [])[0]);
}

function normalizeIndianMobile(rawValue) {
  // Clean but preserve the '+' if it's there
  const cleaned = rawValue.replace(/[^\d+]/g, '');
  const digits = cleaned.replace(/\D/g, '');
  
  if (digits.length === 12 && digits.startsWith('91')) {
      return cleaned.startsWith('+') ? cleaned : '+' + cleaned;
  }
  if (digits.length === 10) {
      // Keep it as is, or optionally add +91 here. We will keep as extracted.
      return cleaned;
  }
  return cleaned;
}

function extractMobiles(text) {
  const normalizedText = text
    .replace(/[oO]/g, '0')
    .replace(/[lI|]/g, '1')
    .replace(/[sS]/g, '5')
    .replace(/[bB]/g, '8');
    
  const uniqueNumbers = new Set();
  // Regex captures optional +91 and 10 digits starting with 6-9
  const pattern = /(?:\+91|91)?[6-9]\d{9}\b/g;
  const matches = normalizedText.match(pattern) || [];

  matches.forEach((value) => {
    const normalized = normalizeIndianMobile(value);
    // Ensure it's a valid length (at least 10 digits)
    if (normalized.replace(/\D/g, '').length >= 10) {
        uniqueNumbers.add(normalized);
    }
  });

  return Array.from(uniqueNumbers);
}

function normalizeNameText(value) {
  return cleanText(
    value
      .replace(/[|]/g, 'I')
      .replace(/[0]/g, 'O')
      .replace(/\bmobile\b/gi, '')
      .replace(/\badd\b/gi, '')
      .replace(/\bview contacts\b/gi, '')
      .replace(/[^a-zA-Z0-9\s.'-]/g, ' ')
  );
}

function isLikelyName(value) {
  if (!value) return false;
  if (value.length < 3 || value.length > 60) return false;
  if (/[@:]/.test(value)) return false;
  if (value.toLowerCase().includes('upi')) return false;

  const letters = (value.match(/[a-zA-Z]/g) || []).length;
  const digits = (value.match(/\d/g) || []).length;

  if (letters < 2) return false;
  if (digits > 0 && digits > Math.ceil(letters / 2)) return false;

  return true;
}

function extractUPI(text) {
  return cleanText((text.match(/\b[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}\b/) || [])[0]);
}

function extractName(text, foundValues) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeNameText(line))
    .filter(Boolean);

  for (const line of lines) {
    if (!isLikelyName(line)) continue;
    if (Object.values(foundValues).some((value) => value && line.includes(value))) continue;
    return line;
  }
  return '';
}

function extractNameForMobileLine(lines, lineIndex) {
  const currentLine = normalizeNameText(lines[lineIndex] || '');
  const withoutNumbers = normalizeNameText(currentLine.replace(/(?:\+?91)?[6-9]\d{9}/g, ''));

  if (isLikelyName(withoutNumbers)) {
    return withoutNumbers;
  }

  for (let offset = 1; offset <= 3; offset += 1) {
    const prev = normalizeNameText(lines[lineIndex - offset] || '');
    if (!isLikelyName(prev)) continue;
    return prev;
  }

  return '';
}

function objectToOrderedRow(data) {
  return {
    Status: data.status || 'Unique',
    File: data.file,
    Name: data.name,
    Mobile: data.mobile,
    Email: data.email,
    'UPI ID': data.upi,
  };
}

function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b91c1c' : '#334155';
}

function renderTable(rows) {
  tableBody.innerHTML = '';
  
  // Logic to flag duplicates based on 10-digit core
  const seen = new Set();
  rows.forEach(row => {
      const core = row.mobile.replace(/\D/g, '').slice(-10);
      if (core && seen.has(core)) {
          row.status = 'Duplicate';
      } else if (core) {
          row.status = 'Unique';
          seen.add(core);
      } else {
          row.status = 'N/A';
      }
  });

  const displayRows = showOnlyUnique ? rows.filter(r => r.status !== 'Duplicate') : rows;

  for (const row of displayRows) {
    const tr = document.createElement('tr');
    if (row.status === 'Duplicate') tr.style.backgroundColor = '#fffbeb';
    
    headers.forEach((key) => {
      const td = document.createElement('td');
      const dataKey = key === 'UPI ID' ? 'upi' : key.toLowerCase();
      td.textContent = row[dataKey] || '';
      tr.appendChild(td);
    });
    tableBody.appendChild(tr);
  }
}

function toTSV(rows) {
  const escaped = (value) => (value ?? '').toString().replace(/\t/g, ' ').replace(/\n/g, ' ');
  const lines = [headers.join('\t')];
  rows.forEach((row) => {
    lines.push(headers.map((key) => escaped(row[key === 'UPI ID' ? 'upi' : key.toLowerCase()])).join('\t'));
  });
  return lines.join('\n');
}

function toCSV(rows) {
  const escapeCsv = (value) => {
    const raw = (value ?? '').toString();
    if (/[",\n]/.test(raw)) {
      return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
  };

  const lines = [headers.join(',')];
  rows.forEach((row) => {
    lines.push(headers.map((key) => escapeCsv(row[key === 'UPI ID' ? 'upi' : key.toLowerCase()])).join(','));
  });
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

function getOrderedRows() {
  return extractedRows; // Status is handled in renderTable
}

function enableActions(enabled) {
  const actionBtns = [copyBtn, toggleDupesBtn, copyNameBtn, copyMobileBtn, copyEmailBtn, copyUpiBtn, downloadCsvBtn, downloadXlsxBtn];
  actionBtns.forEach(btn => btn.disabled = !enabled);
}

function applyFieldSelection(record, fields) {
  return {
    status: record.status,
    file: record.file,
    name: fields.includes('name') ? record.name : '',
    mobile: fields.includes('mobile') ? record.mobile : '',
    email: fields.includes('email') ? record.email : '',
    upi: fields.includes('upi') ? record.upi : '',
  };
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
  const seen = new Set(selectedFiles.map((file) => fileKey(file)));
  newFiles.forEach((file) => {
    const key = fileKey(file);
    if (!seen.has(key)) {
      selectedFiles.push(file);
      seen.add(key);
    }
  });
}

function removeSelectedFile(targetFile) {
  selectedFiles = selectedFiles.filter((file) => fileKey(file) !== fileKey(targetFile));
  renderPreviews(selectedFiles);
  updateSelectedCount();
}

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
    removeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      removeSelectedFile(file);
    });

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

async function preprocessImageForOCR(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width * 2;
    canvas.height = bitmap.height * 2;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      const value = gray > 145 ? 255 : 0;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
    }

    ctx.putImageData(imageData, 0, 0);

    return await new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  } catch (error) {
    console.error('Image preprocessing failed:', error);
    return null;
  }
}

function copyColumn(headerKey, label) {
  const rows = getOrderedRows();
  const values = rows.map((row) => row[headerKey] || '').join('\n');
  navigator.clipboard
    .writeText(values)
    .then(() => showStatus(`Copied ${label} column.`))
    .catch((error) => {
      console.error(error);
      showStatus('Copy failed.', true);
    });
}

async function runOCR(file) {
  const { data: { text: primaryText } } = await Tesseract.recognize(file, 'eng');

  let processedText = '';
  const processedBlob = await preprocessImageForOCR(file);
  if (processedBlob) {
    try {
      const { data: { text } } = await Tesseract.recognize(processedBlob, 'eng');
      processedText = text;
    } catch (error) { console.error('Second OCR failed'); }
  }

  const combinedText = primaryText + '\n' + processedText;
  const mobiles = extractMobiles(combinedText);
  const email = extractEmail(combinedText);
  const upi = extractUPI(combinedText);
  const linePool = combinedText.split(/\r?\n/).filter(Boolean);
  const fallbackName = extractName(combinedText, { email, upi });

  if (!mobiles.length) {
    return [{ status: '', file: file.name, name: fallbackName || 'Name not found', mobile: '', email, upi }];
  }

  return mobiles.map((mobile) => {
    const lineIndex = linePool.findIndex((line) => line.includes(mobile));
    const mappedName = lineIndex >= 0 ? extractNameForMobileLine(linePool, lineIndex) : '';

    return {
      status: '',
      file: file.name,
      name: mappedName || fallbackName || 'Name not found',
      mobile,
      email,
      upi,
    };
  });
}

// --- Event Listeners (Restored) ---

imageInput.addEventListener('change', () => {
  const files = Array.from(imageInput.files || []);
  addSelectedFiles(files);
  renderPreviews(selectedFiles);
  updateSelectedCount();
  imageInput.value = '';
});

closeModalBtn.addEventListener('click', () => {
  closePreviewModal();
});

imageModal.addEventListener('click', (event) => {
  if (event.target === imageModal) {
    closePreviewModal();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !imageModal.hidden) {
    closePreviewModal();
  }
});

extractBtn.addEventListener('click', async () => {
  const files = selectedFiles;
  const fields = selectedFields();

  if (!files.length) return showStatus('Please upload screenshots.', true);
  if (!fields.length) return showStatus('Please select fields.', true);

  extractBtn.disabled = true;
  enableActions(false);
  extractedRows = [];
  renderTable([]);

  try {
    for (let i = 0; i < files.length; i += 1) {
      showStatus(`Processing ${i + 1}/${files.length}: ${files[i].name}`);
      const results = await runOCR(files[i]);
      results.forEach((result) => extractedRows.push(applyFieldSelection(result, fields)));
    }
    renderTable(extractedRows);
    enableActions(extractedRows.length > 0);
    showStatus(`Done. Extracted ${extractedRows.length} rows.`);
  } catch (error) {
    showStatus('Extraction failed.', true);
  } finally {
    extractBtn.disabled = false;
  }
});

toggleDupesBtn.addEventListener('click', () => {
    showOnlyUnique = !showOnlyUnique;
    toggleDupesBtn.textContent = showOnlyUnique ? 'Show All' : 'Hide Duplicates';
    renderTable(extractedRows);
});

copyBtn.addEventListener('click', async () => {
  if (!extractedRows.length) return;
  await navigator.clipboard.writeText(toTSV(extractedRows));
  showStatus('Copied all columns.');
});

copyNameBtn.addEventListener('click', () => copyColumn('name', 'Name'));
copyMobileBtn.addEventListener('click', () => copyColumn('mobile', 'Mobile'));
copyEmailBtn.addEventListener('click', () => copyColumn('email', 'Email'));
copyUpiBtn.addEventListener('click', () => copyColumn('upi', 'UPI ID'));

downloadCsvBtn.addEventListener('click', () => {
  if (!extractedRows.length) return;
  downloadFile(toCSV(extractedRows), 'extracted_data.csv', 'text/csv');
});

downloadXlsxBtn.addEventListener('click', () => {
  if (!extractedRows.length) return;
  const worksheet = XLSX.utils.json_to_sheet(extractedRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'ExtractedData');
  XLSX.writeFile(workbook, 'extracted_data.xlsx');
});
