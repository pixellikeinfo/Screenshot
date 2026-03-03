// --- DOM Elements ---
const imageInput = document.getElementById('imageInput');
const extractBtn = document.getElementById('extractBtn');
const toggleDupesBtn = document.getElementById('toggleDupesBtn');
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

// --- State Variables ---
const headers = ['Status', 'File', 'Name', 'Mobile', 'Email', 'UPI ID'];
let extractedRows = [];
let previewUrls = [];
let selectedFiles = [];
let showOnlyUnique = false;

// --- 1. Intelligent Extraction Logic ---

function normalizeIndianMobile(rawValue) {
    // Keep digits and '+'
    let cleaned = rawValue.replace(/[^\d+]/g, '');
    let digits = cleaned.replace(/\D/g, '');

    // If it's a 12-digit number starting with 91 but missing the '+', add it.
    if (digits.length === 12 && digits.startsWith('91') && !cleaned.startsWith('+')) {
        return '+' + digits;
    }
    return cleaned; 
}

function extractMobiles(text) {
    // Correct common OCR digit misreads
    const normalizedText = text
        .replace(/[oO]/g, '0')
        .replace(/[lI|]/g, '1')
        .replace(/[sS]/g, '5')
        .replace(/[bB]/g, '8');

    const uniqueNumbers = new Set();
    // Captures numbers with any number of spaces, dots, or dashes, with optional +91
    const pattern = /(?:\+?91[\s.-]*)?[6-9](?:[\s.-]*\d){9}\b/g;
    const matches = normalizedText.match(pattern) || [];

    matches.forEach((val) => {
        const norm = normalizeIndianMobile(val);
        if (norm.replace(/\D/g, '').length >= 10) {
            uniqueNumbers.add(norm);
        }
    });
    return Array.from(uniqueNumbers);
}

function isLikelyName(val) {
    if (!val) return false;
    const v = val.trim();
    const vLower = v.toLowerCase();
    
    // UI Noise Filters specific to your screenshots
    const blacklist = ['search', 'mobile', 'add', 'view contacts', 'contacts', 'today', 'yesterday', 'lte', '5g'];
    if (blacklist.includes(vLower) || v.length < 2 || v.length > 50 || /[@:]/.test(v)) return false;

    const letters = (v.match(/[a-zA-Z]/g) || []).length;
    const digits = (v.match(/\d/g) || []).length;
    
    // A name should have more letters than digits
    return letters >= 2 && digits <= Math.ceil(letters / 2);
}

function extractNameForMobileLine(lines, lineIndex) {
    // Check the line containing the number (sometimes names share the line)
    const currentLine = lines[lineIndex].replace(/(?:\+?91[\s.-]*)?[6-9](?:[\s.-]*\d){9}/g, '').trim();
    if (isLikelyName(currentLine)) return currentLine;

    // Slide window UP: Look at the 3 lines directly above the mobile number
    for (let i = 1; i <= 3; i++) {
        const prevLine = lines[lineIndex - i];
        if (prevLine && isLikelyName(prevLine)) return prevLine.trim();
    }
    return 'Unknown Name';
}

// --- 2. Image Preprocessing (High Accuracy) ---

async function preprocessImageForOCR(file) {
    try {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        // Increase scale for better digit recognition
        canvas.width = bitmap.width * 2; 
        canvas.height = bitmap.height * 2;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Binarization (Thresholding) to make text pop
        for (let i = 0; i < data.length; i += 4) {
            const gray = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
            const value = gray > 145 ? 255 : 0;
            data[i] = data[i+1] = data[i+2] = value;
        }
        ctx.putImageData(imageData, 0, 0);

        return new Promise(res => canvas.toBlob(res, 'image/png'));
    } catch (e) {
        console.error("Preprocessing Error:", e);
        return null;
    }
}

// --- 3. UI and Modal Management ---

function fileKey(file) {
    return `${file.name}__${file.size}__${file.lastModified}`;
}

function updateSelectedCount() {
    selectedCountEl.textContent = selectedFiles.length 
        ? `${selectedFiles.length} file(s) selected.` 
        : 'No files selected.';
}

function removeSelectedFile(targetFile) {
    selectedFiles = selectedFiles.filter(f => fileKey(f) !== fileKey(targetFile));
    renderPreviews();
    updateSelectedCount();
}

function renderPreviews() {
    previewUrls.forEach(URL.revokeObjectURL);
    previewUrls = [];
    previewGrid.innerHTML = '';

    selectedFiles.forEach((file) => {
        const url = URL.createObjectURL(file);
        previewUrls.push(url);
        
        const card = document.createElement('div');
        card.className = 'preview-card';
        card.innerHTML = `
            <button type="button" class="preview-remove-btn">✕</button>
            <button type="button" class="preview-open-btn">
                <img src="${url}" />
                <span class="preview-name">${file.name}</span>
            </button>
        `;
        
        card.querySelector('.preview-remove-btn').onclick = () => removeSelectedFile(file);
        card.querySelector('.preview-open-btn').onclick = () => {
            modalImage.src = url;
            modalCaption.textContent = file.name;
            imageModal.hidden = false;
        };
        previewGrid.appendChild(card);
    });
}

function closePreviewModal() {
    imageModal.hidden = true;
    modalImage.src = '';
}

// --- 4. Table and Export Functions ---

function renderTable(rows) {
    tableBody.innerHTML = '';
    const seenMobiles = new Set();
    
    // Duplicate check logic based on the core 10 digits
    rows.forEach(row => {
        const core = row.mobile.replace(/\D/g, '').slice(-10);
        if (core && seenMobiles.has(core)) {
            row.status = 'Duplicate';
        } else if (core) {
            row.status = 'Unique';
            seenMobiles.add(core);
        } else {
            row.status = 'N/A';
        }
    });

    const displayRows = showOnlyUnique ? rows.filter(r => r.status !== 'Duplicate') : rows;

    displayRows.forEach(row => {
        const tr = document.createElement('tr');
        if (row.status === 'Duplicate') tr.style.backgroundColor = '#fffbeb';
        
        headers.forEach(key => {
            const td = document.createElement('td');
            const dataKey = key === 'UPI ID' ? 'upi' : key.toLowerCase();
            td.textContent = row[dataKey] || '';
            tr.appendChild(td);
        });
        tableBody.appendChild(tr);
    });
}

function toCSV(rows) {
    const esc = (v) => {
        const r = (v ?? '').toString();
        return /[",\n]/.test(r) ? `"${r.replace(/"/g, '""')}"` : r;
    };
    const lines = [headers.join(',')];
    rows.forEach(r => {
        lines.push(headers.map(k => esc(r[k === 'UPI ID' ? 'upi' : k.toLowerCase()])).join(','));
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

// --- 5. Main Execution ---

async function runOCR(file) {
    const { data: { text: rawText } } = await Tesseract.recognize(file, 'eng');
    
    // Process a second time with filters for better digit recovery
    const preppedBlob = await preprocessImageForOCR(file);
    let filteredText = '';
    if (preppedBlob) {
        const { data: { text } } = await Tesseract.recognize(preppedBlob, 'eng');
        filteredText = text;
    }

    const combined = rawText + '\n' + filteredText;
    const mobiles = extractMobiles(combined);
    const lines = combined.split(/\r?\n/).filter(l => l.trim().length > 0);

    return mobiles.map(mobile => {
        // Find line index of the number to extract the name nearby
        const cleanMobile = mobile.replace(/[^\d+]/g, '');
        const idx = lines.findIndex(l => l.replace(/[^\d+]/g, '').includes(cleanMobile));
        
        return {
            status: '',
            file: file.name,
            name: idx >= 0 ? extractNameForMobileLine(lines, idx) : 'Unknown Name',
            mobile: mobile,
            email: (combined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [''])[0],
            upi: (combined.match(/\b[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}\b/) || [''])[0]
        };
    });
}

imageInput.addEventListener('change', () => {
    const files = Array.from(imageInput.files || []);
    files.forEach(f => {
        if (!selectedFiles.some(sf => fileKey(sf) === fileKey(f))) {
            selectedFiles.push(f);
        }
    });
    renderPreviews();
    updateSelectedCount();
    imageInput.value = '';
});

extractBtn.onclick = async () => {
    const fields = Array.from(document.querySelectorAll('.field-checkbox:checked')).map(i => i.value);
    if (!selectedFiles.length || !fields.length) {
        statusEl.textContent = "Error: Select files and fields first.";
        return;
    }

    extractBtn.disabled = true;
    extractedRows = [];
    statusEl.textContent = "Initializing OCR Engine...";

    for (let i = 0; i < selectedFiles.length; i++) {
        statusEl.textContent = `Processing image ${i+1} of ${selectedFiles.length}...`;
        try {
            const results = await runOCR(selectedFiles[i]);
            results.forEach(res => {
                // Apply selection filters
                const row = { status: '', file: res.file };
                row.name = fields.includes('name') ? res.name : '';
                row.mobile = fields.includes('mobile') ? res.mobile : '';
                row.email = fields.includes('email') ? res.email : '';
                row.upi = fields.includes('upi') ? res.upi : '';
                extractedRows.push(row);
            });
        } catch (e) {
            console.error(e);
        }
    }

    statusEl.textContent = `Complete! Extracted ${extractedRows.length} entries.`;
    renderTable(extractedRows);
    
    // Enable Actions
    [copyBtn, toggleDupesBtn, copyNameBtn, copyMobileBtn, copyEmailBtn, copyUpiBtn, downloadCsvBtn, downloadXlsxBtn].forEach(b => b.disabled = false);
    extractBtn.disabled = false;
};

toggleDupesBtn.onclick = () => {
    showOnlyUnique = !showOnlyUnique;
    toggleDupesBtn.textContent = showOnlyUnique ? 'Show All' : 'Hide Duplicates';
    renderTable(extractedRows);
};

// --- Copy & Export Event Listeners ---
copyBtn.onclick = () => {
    const text = extractedRows.map(r => Object.values(r).join('\t')).join('\n');
    navigator.clipboard.writeText(text);
    statusEl.textContent = "Copied table to clipboard.";
};

copyNameBtn.onclick = () => {
    const text = extractedRows.map(r => r.name).join('\n');
    navigator.clipboard.writeText(text);
    statusEl.textContent = "Names copied.";
};

copyMobileBtn.onclick = () => {
    const text = extractedRows.map(r => r.mobile).join('\n');
    navigator.clipboard.writeText(text);
    statusEl.textContent = "Mobiles copied.";
};

downloadCsvBtn.onclick = () => {
    downloadFile(toCSV(extractedRows), 'contacts.csv', 'text/csv');
};

downloadXlsxBtn.onclick = () => {
    const ws = XLSX.utils.json_to_sheet(extractedRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Contacts");
    XLSX.writeFile(wb, "contacts_data.xlsx");
};

closeModalBtn.onclick = closePreviewModal;
