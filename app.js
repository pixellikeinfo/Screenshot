/**
 * APP.JS - COMPLETE RESTORATION
 */

// --- 1. ELEMENT SELECTORS ---
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

// --- 2. GLOBAL STATE ---
const HEADERS = ['Status', 'File', 'Name', 'Mobile', 'Email', 'UPI ID'];
let extractionList = []; // Array of File objects
let processedResults = []; // Array of extracted row objects
let isUniqueMode = false;

// --- 3. HELPER FUNCTIONS (ZERO CUTS) ---

function standardizeMobile(raw) {
    let fixed = raw.replace(/[oO]/g, '0').replace(/[lI|]/g, '1');
    let digits = fixed.replace(/[^\d+]/g, '');
    if (digits.length === 12 && digits.startsWith('91') && !fixed.startsWith('+')) {
        return '+' + digits;
    }
    return digits;
}

function isValidName(text) {
    if (!text) return false;
    const t = text.trim();
    const tLow = t.toLowerCase();
    const noise = ['search', 'lte', 'volte', '5g', 'today', 'yesterday', 'contacts', 'invite', 'add', 'view'];
    if (noise.some(word => tLow.includes(word))) return false;
    if (t.length < 2 || t.length > 50 || /[@:]/.test(t)) return false;
    const alpha = (t.match(/[a-zA-Z]/g) || []).length;
    const nums = (t.match(/\d/g) || []).length;
    return alpha >= 2 && nums <= (alpha / 1.5);
}

function findNameAbove(lines, index) {
    // Check line where number is, then 3 lines above
    for (let i = 0; i <= 3; i++) {
        let currentIdx = index - i;
        if (currentIdx < 0) continue;
        let line = lines[currentIdx].replace(/(?:\+?91[\s.-]*)?[6-9](?:[\s.-]*\d){9}/g, '').trim();
        if (isValidName(line)) return line;
    }
    return 'Unknown Contact';
}

async function enhanceImage(file) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width * 2;
    canvas.height = bitmap.height * 2;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
        const avg = 0.2126 * data[i] + 0.7152 * data[i+1] + 0.0722 * data[i+2];
        const val = avg > 140 ? 255 : 0;
        data[i] = data[i+1] = data[i+2] = val;
    }
    ctx.putImageData(imgData, 0, 0);
    return new Promise(res => canvas.toBlob(res, 'image/png'));
}

// --- 4. CORE OCR ENGINE ---

async function runOCR(file) {
    // Two-pass OCR for accuracy
    const { data: { text: t1 } } = await Tesseract.recognize(file, 'eng');
    const blob = await enhanceImage(file);
    let t2 = '';
    if (blob) {
        const { data: { text } } = await Tesseract.recognize(blob, 'eng');
        t2 = text;
    }

    const fullText = t1 + '\n' + t2;
    const lines = fullText.split(/\r?\n/).filter(l => l.trim() !== "");
    const mobileRegex = /(?:\+?91[\s.-]*)?[6-9](?:[\s.-]*\d){9}\b/g;
    
    const mobilesFound = fullText.match(mobileRegex) || [];
    const uniqueInFile = new Set();
    const finalRows = [];

    mobilesFound.forEach(m => {
        const clean = standardizeMobile(m);
        const core = clean.slice(-10);
        if (!uniqueInFile.has(core)) {
            uniqueInFile.add(core);
            const lineIdx = lines.findIndex(l => standardizeMobile(l).includes(core));
            finalRows.push({
                file: file.name,
                name: lineIdx >= 0 ? findNameAbove(lines, lineIdx) : 'Unknown',
                mobile: m,
                email: (fullText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/) || [""])[0],
                upi: (fullText.match(/[a-zA-Z0-9._-]+@[a-zA-Z]{3,}/) || [""])[0]
            });
        }
    });
    return finalRows;
}

// --- 5. UI & EVENT HANDLERS ---

imageInput.onchange = () => {
    const files = Array.from(imageInput.files);
    files.forEach(f => {
        if (!extractionList.some(ef => ef.name === f.name && ef.size === f.size)) {
            extractionList.push(f);
        }
    });
    renderPreviews();
    selectedCountEl.textContent = `${extractionList.length} files selected.`;
    imageInput.value = '';
};

function renderPreviews() {
    previewGrid.innerHTML = '';
    extractionList.forEach(file => {
        const url = URL.createObjectURL(file);
        const card = document.createElement('div');
        card.className = 'preview-card';
        card.innerHTML = `
            <button class="remove-btn">&times;</button>
            <img src="${url}">
            <span class="file-label">${file.name}</span>
        `;
        card.onclick = () => {
            modalImage.src = url;
            modalCaption.textContent = file.name;
            imageModal.hidden = false;
        };
        card.querySelector('.remove-btn').onclick = (e) => {
            e.stopPropagation();
            extractionList = extractionList.filter(f => f !== file);
            renderPreviews();
            selectedCountEl.textContent = `${extractionList.length} files selected.`;
        };
        previewGrid.appendChild(card);
    });
}

closeModalBtn.onclick = () => imageModal.hidden = true;

extractBtn.onclick = async () => {
    if (!extractionList.length) return alert("Please upload images.");
    const fields = Array.from(document.querySelectorAll('.field-checkbox:checked')).map(cb => cb.value);
    
    extractBtn.disabled = true;
    processedResults = [];
    statusEl.textContent = "Processing...";

    for (let i = 0; i < extractionList.length; i++) {
        statusEl.textContent = `Analyzing ${i+1}/${extractionList.length}...`;
        const results = await runOCR(extractionList[i]);
        results.forEach(res => {
            const final = { status: '', file: res.file };
            final.name = fields.includes('name') ? res.name : '';
            final.mobile = fields.includes('mobile') ? res.mobile : '';
            final.email = fields.includes('email') ? res.email : '';
            final.upi = fields.includes('upi') ? res.upi : '';
            processedResults.push(final);
        });
    }

    statusEl.textContent = "Extraction complete!";
    renderTable();
    [copyBtn, toggleDupesBtn, copyNameBtn, copyMobileBtn, copyEmailBtn, copyUpiBtn, downloadCsvBtn, downloadXlsxBtn].forEach(b => b.disabled = false);
    extractBtn.disabled = false;
};

function renderTable() {
    tableBody.innerHTML = '';
    const seen = new Set();
    processedResults.forEach(r => {
        const core = r.mobile.replace(/\D/g, '').slice(-10);
        if (core && seen.has(core)) r.status = 'Duplicate';
        else if (core) { r.status = 'Unique'; seen.add(core); }
    });

    const display = isUniqueMode ? processedResults.filter(r => r.status !== 'Duplicate') : processedResults;

    display.forEach(row => {
        const tr = document.createElement('tr');
        if (row.status === 'Duplicate') tr.className = 'dupe-row';
        HEADERS.forEach(h => {
            const td = document.createElement('td');
            const k = h === 'UPI ID' ? 'upi' : h.toLowerCase();
            td.textContent = row[k] || '';
            tr.appendChild(td);
        });
        tableBody.appendChild(tr);
    });
}

// --- 6. EXPORT ACTIONS ---

toggleDupesBtn.onclick = () => {
    isUniqueMode = !isUniqueMode;
    toggleDupesBtn.textContent = isUniqueMode ? "Show All" : "Hide Duplicates";
    renderTable();
};

copyBtn.onclick = () => {
    const t = processedResults.map(r => Object.values(r).join('\t')).join('\n');
    navigator.clipboard.writeText(t);
    statusEl.textContent = "Table copied!";
};

copyNameBtn.onclick = () => navigator.clipboard.writeText(processedResults.map(r => r.name).join('\n'));
copyMobileBtn.onclick = () => navigator.clipboard.writeText(processedResults.map(r => r.mobile).join('\n'));

downloadXlsxBtn.onclick = () => {
    const ws = XLSX.utils.json_to_sheet(processedResults);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    XLSX.writeFile(wb, "contacts.xlsx");
};

downloadCsvBtn.onclick = () => {
    const csv = [HEADERS.join(','), ...processedResults.map(r => Object.values(r).join(','))].join('\n');
    const b = new Blob([csv], { type: 'text/csv' });
    const u = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = u; a.download = 'contacts.csv'; a.click();
};
