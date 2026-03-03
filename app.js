/**
 * APP.JS - TOTAL SYSTEM LOGIC
 * Includes: Pre-processing, Multi-Pass OCR, Intelligent Name Mapping, and UI Control.
 */

// ---------------------------------------------------------
// 1. DOM ELEMENT REFERENCES
// ---------------------------------------------------------
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

// ---------------------------------------------------------
// 2. GLOBAL APPLICATION STATE
// ---------------------------------------------------------
const TABLE_HEADERS = ['Status', 'File', 'Name', 'Mobile', 'Email', 'UPI ID'];
let globalExtractedData = [];
let activePreviewUrls = [];
let userSelectedFiles = [];
let isFilteringDuplicates = false;

// ---------------------------------------------------------
// 3. INTELLIGENT OCR UTILITY FUNCTIONS
// ---------------------------------------------------------

/**
 * Ensures mobile numbers follow a standard format.
 * Handles cases where OCR might miss the "+" or "91".
 */
function standardizePhoneNumber(raw) {
    // Strip everything that isn't a digit or a plus sign
    let digitsOnly = raw.replace(/[^\d+]/g, '');
    let pureNumbers = digitsOnly.replace(/\D/g, '');

    // If it looks like a 12-digit Indian number starting with 91, add the +
    if (pureNumbers.length === 12 && pureNumbers.startsWith('91') && !digitsOnly.startsWith('+')) {
        return '+' + digitsOnly;
    }
    
    return digitsOnly;
}

/**
 * Advanced Regex to find numbers even if they have spaces like "97471 15622".
 */
function findAllMobileNumbers(textContent) {
    // Sanitize common OCR errors (e.g., mistaking 'o' for '0')
    const sanitized = textContent
        .replace(/[oO]/g, '0')
        .replace(/[lI|]/g, '1')
        .replace(/[sS]/g, '5')
        .replace(/[bB]/g, '8');

    const uniqueFound = new Set();
    
    // Pattern: Matches optional +91 and 10 digits with potential spaces/dots/dashes
    const mobilePattern = /(?:\+?91[\s.-]*)?[6-9](?:[\s.-]*\d){9}\b/g;
    const allMatches = sanitized.match(mobilePattern) || [];

    allMatches.forEach((match) => {
        const standard = standardizePhoneNumber(match);
        // Only accept if it has at least 10 digits
        if (standard.replace(/\D/g, '').length >= 10) {
            uniqueFound.add(standard);
        }
    });
    
    return Array.from(uniqueFound);
}

/**
 * Checks if a line of text is a valid name or just system text (like "Search").
 */
function isAValidName(str) {
    if (!str) return false;
    const trimmed = str.trim();
    const low = trimmed.toLowerCase();
    
    // List of words to ignore from the screenshots
    const blacklist = ['search', 'mobile', 'add', 'view', 'contacts', 'today', 'yesterday', 'lte', '5g', 'volte', 'invite'];
    
    if (blacklist.some(word => low.includes(word))) return false;
    if (trimmed.length < 2 || trimmed.length > 60) return false;
    if (/[@:]/.test(trimmed)) return false; 

    const alphaCount = (trimmed.match(/[a-zA-Z]/g) || []).length;
    const digitCount = (trimmed.match(/\d/g) || []).length;
    
    return alphaCount >= 2 && digitCount <= Math.ceil(alphaCount / 1.5);
}

/**
 * Logic to find the name associated with a specific mobile number line.
 */
function findNameForLine(allLines, currentIndex) {
    // Step A: Check the line where the number was found (names sometimes share a line)
    const currentLineClean = allLines[currentIndex].replace(/(?:\+?91[\s.-]*)?[6-9](?:[\s.-]*\d){9}/g, '').trim();
    if (isAValidName(currentLineClean)) return currentLineClean;

    // Step B: Look at the 3 lines directly ABOVE the phone number
    for (let offset = 1; offset <= 3; offset++) {
        const previousLine = allLines[currentIndex - offset];
        if (previousLine && isAValidName(previousLine)) {
            return previousLine.trim();
        }
    }
    
    return 'Unknown Contact';
}

// ---------------------------------------------------------
// 4. IMAGE ENHANCEMENT & MULTI-PASS OCR
// ---------------------------------------------------------

/**
 * Prepares the screenshot for better digit recognition (High Contrast).
 */
async function getEnhancedImageBlob(file) {
    try {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        
        // Boost the scale to make small numbers clearer
        canvas.width = bitmap.width * 2;
        canvas.height = bitmap.height * 2;
        
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        
        const imgData = context.getImageData(0, 0, canvas.width, canvas.height);
        const buffer = imgData.data;

        // Binarization: Convert pixels to pure black or pure white
        for (let i = 0; i < buffer.length; i += 4) {
            const luma = 0.2126 * buffer[i] + 0.7152 * buffer[i+1] + 0.0722 * buffer[i+2];
            const thresholdValue = luma > 150 ? 255 : 0;
            buffer[i] = buffer[i+1] = buffer[i+2] = thresholdValue;
        }
        
        context.putImageData(imgData, 0, 0);
        return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    } catch (err) {
        console.error("Enhancement module failed", err);
        return null;
    }
}

/**
 * Executes a two-pass OCR process to ensure no data is missed.
 */
async function executeDualPassOCR(imageFile) {
    // PASS 1: Recognition on the raw image
    const rawResult = await Tesseract.recognize(imageFile, 'eng');
    const textPass1 = rawResult.data.text;
    
    // PASS 2: Recognition on the high-contrast enhanced image
    const enhancedBlob = await getEnhancedImageBlob(imageFile);
    let textPass2 = '';
    if (enhancedBlob) {
        const enhancedResult = await Tesseract.recognize(enhancedBlob, 'eng');
        textPass2 = enhancedResult.data.text;
    }

    const mergedText = textPass1 + '\n' + textPass2;
    const detectedMobiles = findAllMobileNumbers(mergedText);
    const splitLines = mergedText.split(/\r?\n/).filter(line => line.trim().length > 0);

    return detectedMobiles.map(mobile => {
        const cleanMobileStr = mobile.replace(/[^\d+]/g, '');
        // Locate the line index where the number appeared
        const linePos = splitLines.findIndex(ln => ln.replace(/[^\d+]/g, '').includes(cleanMobileStr));
        
        return {
            status: '',
            file: imageFile.name,
            name: linePos >= 0 ? findNameForLine(splitLines, linePos) : 'Not found',
            mobile: mobile,
            email: (mergedText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [''])[0],
            upi: (mergedText.match(/\b[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}\b/) || [''])[0]
        };
    });
}

// ---------------------------------------------------------
// 5. UI INTERACTION & FILE MANAGEMENT
// ---------------------------------------------------------

imageInput.addEventListener('change', () => {
    const newlySelected = Array.from(imageInput.files);
    newlySelected.forEach(file => {
        const uniqueKey = `${file.name}-${file.size}`;
        if (!userSelectedFiles.some(existing => `${existing.name}-${existing.size}` === uniqueKey)) {
            userSelectedFiles.push(file);
        }
    });
    
    refreshImagePreviews();
    selectedCountEl.textContent = `${userSelectedFiles.length} files selected for processing.`;
    imageInput.value = ''; // Reset input to allow re-upload of same files
});

function refreshImagePreviews() {
    activePreviewUrls.forEach(URL.revokeObjectURL);
    activePreviewUrls = [];
    previewGrid.innerHTML = '';

    userSelectedFiles.forEach(file => {
        const objectUrl = URL.createObjectURL(file);
        activePreviewUrls.push(objectUrl);
        
        const card = document.createElement('div');
        card.className = 'preview-card';
        card.innerHTML = `
            <button class="remove-trigger" title="Remove image">&times;</button>
            <div class="card-inner">
                <img src="${objectUrl}">
                <span class="filename-tag">${file.name}</span>
            </div>
        `;
        
        card.onclick = () => {
            modalImage.src = objectUrl;
            modalCaption.textContent = file.name;
            imageModal.hidden = false;
        };

        card.querySelector('.remove-trigger').onclick = (event) => {
            event.stopPropagation();
            userSelectedFiles = userSelectedFiles.filter(f => f !== file);
            refreshImagePreviews();
            selectedCountEl.textContent = `${userSelectedFiles.length} files selected.`;
        };

        previewGrid.appendChild(card);
    });
}

closeModalBtn.onclick = () => {
    imageModal.hidden = true;
};

// ---------------------------------------------------------
// 6. PROCESSING & TABLE RENDERING
// ---------------------------------------------------------

extractBtn.onclick = async () => {
    const activeFields = Array.from(document.querySelectorAll('.field-checkbox:checked')).map(cb => cb.value);
    
    if (userSelectedFiles.length === 0) {
        alert("Please upload at least one screenshot.");
        return;
    }

    extractBtn.disabled = true;
    globalExtractedData = [];
    statusEl.textContent = "Booting OCR Engine...";

    for (let i = 0; i < userSelectedFiles.length; i++) {
        const currentFile = userSelectedFiles[i];
        statusEl.textContent = `Processing image ${i + 1} of ${userSelectedFiles.length}...`;
        
        try {
            const extractionResults = await executeDualPassOCR(currentFile);
            extractionResults.forEach(item => {
                // Filter the data based on what checkboxes were checked
                const finalRowObject = { status: '', file: item.file };
                finalRowObject.name = activeFields.includes('name') ? item.name : '';
                finalRowObject.mobile = activeFields.includes('mobile') ? item.mobile : '';
                finalRowObject.email = activeFields.includes('email') ? item.email : '';
                finalRowObject.upi = activeFields.includes('upi') ? item.upi : '';
                globalExtractedData.push(finalRowObject);
            });
        } catch (error) {
            console.error("OCR cycle failed for " + currentFile.name, error);
        }
    }

    statusEl.textContent = "All images processed successfully.";
    renderMainResultsTable();
    
    // Enable export and copy buttons
    [copyBtn, toggleDupesBtn, copyNameBtn, copyMobileBtn, copyEmailBtn, copyUpiBtn, downloadCsvBtn, downloadXlsxBtn].forEach(btn => btn.disabled = false);
    extractBtn.disabled = false;
};

function renderMainResultsTable() {
    tableBody.innerHTML = '';
    const mobileRegistry = new Set();
    
    // Mark duplicates globally
    globalExtractedData.forEach(entry => {
        const coreMobile = entry.mobile.replace(/\D/g, '').slice(-10);
        if (coreMobile && mobileRegistry.has(coreMobile)) {
            entry.status = 'Duplicate';
        } else if (coreMobile) {
            entry.status = 'Unique';
            mobileRegistry.add(coreMobile);
        }
    });

    const rowsToDraw = isFilteringDuplicates 
        ? globalExtractedData.filter(e => e.status !== 'Duplicate') 
        : globalExtractedData;

    rowsToDraw.forEach(dataRow => {
        const tr = document.createElement('tr');
        if (dataRow.status === 'Duplicate') tr.className = 'duplicate-row';
        
        TABLE_HEADERS.forEach(header => {
            const td = document.createElement('td');
            const dataMapKey = header === 'UPI ID' ? 'upi' : header.toLowerCase();
            td.textContent = dataRow[dataMapKey] || '';
            tr.appendChild(td);
        });
        tableBody.appendChild(tr);
    });
}

// ---------------------------------------------------------
// 7. EXPORT & UTILITY HANDLERS
// ---------------------------------------------------------

toggleDupesBtn.onclick = () => {
    isFilteringDuplicates = !isFilteringDuplicates;
    toggleDupesBtn.textContent = isFilteringDuplicates ? "Showing Unique Only" : "Hide Duplicates";
    renderMainResultsTable();
};

copyBtn.onclick = () => {
    const tableText = globalExtractedData.map(r => Object.values(r).join('\t')).join('\n');
    navigator.clipboard.writeText(tableText).then(() => {
        statusEl.textContent = "Complete table copied to clipboard!";
    });
};

copyNameBtn.onclick = () => {
    const names = globalExtractedData.map(r => r.name).join('\n');
    navigator.clipboard.writeText(names).then(() => {
        statusEl.textContent = "Names copied to clipboard!";
    });
};

copyMobileBtn.onclick = () => {
    const mobiles = globalExtractedData.map(r => r.mobile).join('\n');
    navigator.clipboard.writeText(mobiles).then(() => {
        statusEl.textContent = "Mobiles copied to clipboard!";
    });
};

downloadCsvBtn.onclick = () => {
    const csvRows = [TABLE_HEADERS.join(','), ...globalExtractedData.map(r => Object.values(r).join(','))];
    const csvBlob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const blobUrl = URL.createObjectURL(csvBlob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = 'extracted_contacts_data.csv';
    link.click();
    URL.revokeObjectURL(blobUrl);
};

downloadXlsxBtn.onclick = () => {
    const worksheet = XLSX.utils.json_to_sheet(globalExtractedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Extracted Contacts");
    XLSX.writeFile(workbook, "extracted_contact_list.xlsx");
};
