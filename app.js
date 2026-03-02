const imageInput = document.getElementById('imageInput');
const extractBtn = document.getElementById('extractBtn');
const copyBtn = document.getElementById('copyBtn');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');
const downloadXlsxBtn = document.getElementById('downloadXlsxBtn');
const statusEl = document.getElementById('status');
const tableBody = document.querySelector('#resultsTable tbody');

const headers = ['File', 'Name', 'Mobile', 'Email', 'UPI ID'];
let extractedRows = [];

function selectedFields() {
  return Array.from(document.querySelectorAll('.field-checkbox:checked')).map((item) => item.value);
}

function cleanText(value) {
  return value ? value.replace(/\s+/g, ' ').trim() : '';
}

function extractEmail(text) {
  return cleanText((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [])[0]);
}

function extractMobile(text) {
  const match = text.match(/(?:\+?91[-\s]?)?[6-9]\d{9}/);
  if (!match) return '';
  return match[0].replace(/[^\d+]/g, '');
}

function extractUPI(text) {
  return cleanText((text.match(/\b[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}\b/) || [])[0]);
}

function extractName(text, foundValues) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.length < 3 || line.length > 60) continue;
    if (/\d/.test(line)) continue;
    if (/[@:]/.test(line)) continue;
    if (line.toLowerCase().includes('upi')) continue;
    if (Object.values(foundValues).some((value) => value && line.includes(value))) continue;
    return cleanText(line);
  }
  return '';
}

function objectToOrderedRow(data) {
  return {
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
  for (const row of rows) {
    const tr = document.createElement('tr');
    headers.forEach((key) => {
      const td = document.createElement('td');
      td.textContent = row[key] || '';
      tr.appendChild(td);
    });
    tableBody.appendChild(tr);
  }
}

function toTSV(rows) {
  const escaped = (value) => (value ?? '').toString().replace(/\t/g, ' ').replace(/\n/g, ' ');
  const lines = [headers.join('\t')];
  rows.forEach((row) => {
    lines.push(headers.map((key) => escaped(row[key])).join('\t'));
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
    lines.push(headers.map((key) => escapeCsv(row[key])).join(','));
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

function enableActions(enabled) {
  copyBtn.disabled = !enabled;
  downloadCsvBtn.disabled = !enabled;
  downloadXlsxBtn.disabled = !enabled;
}

function applyFieldSelection(record, fields) {
  return {
    file: record.file,
    name: fields.includes('name') ? record.name : '',
    mobile: fields.includes('mobile') ? record.mobile : '',
    email: fields.includes('email') ? record.email : '',
    upi: fields.includes('upi') ? record.upi : '',
  };
}

async function runOCR(file) {
  const {
    data: { text },
  } = await Tesseract.recognize(file, 'eng');

  const email = extractEmail(text);
  const mobile = extractMobile(text);
  const upi = extractUPI(text);
  const name = extractName(text, { email, mobile, upi });

  return {
    file: file.name,
    name,
    mobile,
    email,
    upi,
  };
}

extractBtn.addEventListener('click', async () => {
  const files = Array.from(imageInput.files || []);
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
    for (let i = 0; i < files.length; i += 1) {
      showStatus(`Processing ${i + 1}/${files.length}: ${files[i].name}`);
      const result = await runOCR(files[i]);
      extractedRows.push(applyFieldSelection(result, fields));
    }

    const orderedRows = extractedRows.map(objectToOrderedRow);
    renderTable(orderedRows);
    enableActions(orderedRows.length > 0);
    showStatus(`Done. Extracted data from ${orderedRows.length} screenshot(s).`);
  } catch (error) {
    console.error(error);
    showStatus('Extraction failed. Please try with clearer screenshots.', true);
  } finally {
    extractBtn.disabled = false;
  }
});

copyBtn.addEventListener('click', async () => {
  const orderedRows = extractedRows.map(objectToOrderedRow);
  if (!orderedRows.length) return;

  try {
    await navigator.clipboard.writeText(toTSV(orderedRows));
    showStatus('Copied tabular data. Paste directly into Google Sheets or Excel.');
  } catch (error) {
    console.error(error);
    showStatus('Copy failed. Your browser may block clipboard permission.', true);
  }
});

downloadCsvBtn.addEventListener('click', () => {
  const orderedRows = extractedRows.map(objectToOrderedRow);
  if (!orderedRows.length) return;
  downloadFile(toCSV(orderedRows), 'extracted_data.csv', 'text/csv;charset=utf-8');
});

downloadXlsxBtn.addEventListener('click', () => {
  const orderedRows = extractedRows.map(objectToOrderedRow);
  if (!orderedRows.length) return;

  const worksheet = XLSX.utils.json_to_sheet(orderedRows, { header: headers });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'ExtractedData');
  XLSX.writeFile(workbook, 'extracted_data.xlsx');
});
