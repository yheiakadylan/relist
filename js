// ==UserScript==
// @name         Etsy Auto Lister v2.3 (Fixed Title + CSV Space)
// @namespace    http://tampermonkey.net/
// @version      2.3
// @description  Fix lỗi tách Title có dấu cách, điền Title ổn định, Auto Upload ảnh.
// @author       Gemini Expert
// @match        https://www.etsy.com/your/shops/*/tools/listings*
// @match        https://www.etsy.com/your/shops/*/listing-editor/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // --- CẤU HÌNH ---
    const CONFIG = {
        delay: {
            step: 800,         // Tốc độ thao tác
            load: 4000,        // Chờ trang copy load (Tăng lên để chắc ăn)
            tag: 800,          // Delay giữa các tag
            uploadWait: 15000, // Thời gian chờ ảnh upload
        },
        selectors: {
            titleInput: '#listing-title-input',
            tagInput: '#listing-tags-input',
            tagAddBtn: '#listing-tags-button',
            tagContainer: '#field-tags ul.wt-action-group',
            tagDeleteBtn: 'button[aria-label^="Delete"]',
            fileInput: 'input[name="listing-media-upload"]',
            //publishBtn: 'button[data-testid="publish"]',
            //confirmModalBtn: '.wt-overlay button.wt-btn--primary'
        }
    };

    // --- STATE ---
    const STATE = {
        get isRunning() { return GM_getValue('isRunning', false); },
        set isRunning(val) { GM_setValue('isRunning', val); },
        get currentIndex() { return GM_getValue('currentIndex', 0); },
        set currentIndex(val) { GM_setValue('currentIndex', val); },
        get templateId() { return GM_getValue('templateId', ''); },
        set templateId(val) { GM_setValue('templateId', val); },
        get csvData() { return JSON.parse(localStorage.getItem('etsy_csv_rows') || '[]'); },
        set csvData(val) { localStorage.setItem('etsy_csv_rows', JSON.stringify(val)); }
    };

    // --- UI PANEL ---
    function createPanel() {
        if (document.getElementById('etsy-auto-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'etsy-auto-panel';
        panel.innerHTML = `
            <div class="header">Etsy Auto v2.3 (Final Fix)</div>
            <div class="section">
                <label>Template ID:</label>
                <input type="text" id="ea-template-id" value="${STATE.templateId}" placeholder="VD: 123456789">
            </div>
            <div class="section">
                <label>CSV Data (No Header):</label>
                <input type="file" id="ea-csv-file" accept=".csv">
            </div>
            <div class="controls">
                <button id="ea-load-btn" class="btn-blue">Load CSV</button>
                <button id="ea-start-btn" class="btn-green">Start</button>
                <button id="ea-stop-btn" class="btn-red">Stop</button>
            </div>
            <div class="controls">
                <button id="ea-clear-btn" class="btn-gray">🗑️ Clear Data</button>
            </div>
            <div class="status-box">
                Row: <span id="ea-row-info">${STATE.currentIndex + 1} / ${STATE.csvData.length}</span>
                <div id="ea-status">Ready...</div>
            </div>
            <div class="section">
                <label>Logs:</label>
                <textarea id="ea-logs" readonly></textarea>
            </div>
        `;
        document.body.appendChild(panel);

        GM_addStyle(`
            #etsy-auto-panel { position: fixed; top: 10px; right: 10px; width: 300px; background: #fff; border: 2px solid #333; z-index: 999999; font-family: sans-serif; font-size: 12px; box-shadow: 0 5px 15px rgba(0,0,0,0.3); border-radius: 8px; }
            #etsy-auto-panel .header { background: #222; color: #fff; padding: 8px; font-weight: bold; text-align: center; }
            #etsy-auto-panel .section { padding: 8px 10px; border-bottom: 1px solid #eee; }
            #etsy-auto-panel label { display: block; font-weight: bold; margin-bottom: 4px; }
            #etsy-auto-panel input, #etsy-auto-panel textarea { width: 100%; box-sizing: border-box; padding: 5px; border: 1px solid #ccc; }
            #etsy-auto-panel textarea { height: 80px; font-size: 10px; font-family: monospace; }
            #etsy-auto-panel .controls { display: flex; gap: 5px; padding: 5px 10px; }
            #etsy-auto-panel button { flex: 1; padding: 8px; color: white; border: none; cursor: pointer; border-radius: 4px; font-weight: bold; }
            .btn-blue { background: #007bff; } .btn-green { background: #28a745; } .btn-red { background: #dc3545; } .btn-gray { background: #6c757d; }
            .status-box { background: #f8f9fa; padding: 8px; text-align: center; border-bottom: 1px solid #eee; }
            #ea-status { color: #007bff; margin-top: 4px; font-weight: bold; }
        `);

        document.getElementById('ea-template-id').addEventListener('change', (e) => STATE.templateId = e.target.value.trim());
        document.getElementById('ea-load-btn').addEventListener('click', loadCSV);
        document.getElementById('ea-start-btn').addEventListener('click', startProcess);
        document.getElementById('ea-stop-btn').addEventListener('click', stopProcess);
        document.getElementById('ea-clear-btn').addEventListener('click', clearData);
        updateUI();
    }

    function log(msg) {
        const el = document.getElementById('ea-status');
        const area = document.getElementById('ea-logs');
        if (el) el.innerText = msg;
        if (area) area.value = `> ${msg}\n` + area.value;
        console.log(`[EtsyAuto] ${msg}`);
    }

    function updateUI() {
        const el = document.getElementById('ea-row-info');
        if (el) el.innerText = `${STATE.currentIndex + 1} / ${STATE.csvData.length}`;
    }

    // --- DATA MANAGEMENT ---
    function loadCSV() {
        const fileInput = document.getElementById('ea-csv-file');
        if (!fileInput.files.length) return alert('Chưa chọn file CSV!');
        const reader = new FileReader();
        reader.onload = function(e) {
            const rows = parseCSV(e.target.result);
            STATE.csvData = rows;
            STATE.currentIndex = 0;
            updateUI();
            log(`Đã load ${rows.length} dòng.`);
        };
        reader.readAsText(fileInput.files[0]);
    }

    // --- FIX: CSV PARSER CHUẨN ---
    function parseCSV(text) {
        const lines = text.split(/\r\n|\n/);
        const result = [];
        for (let line of lines) {
            if (!line.trim()) continue;

            // Regex mới: Chỉ tách dấu phẩy, KHÔNG tách dấu cách
            // Group 1: Chuỗi trong ngoặc kép "..."
            // Group 2: Chuỗi không chứa dấu phẩy
            const regex = /(?:^|,)(\s*"([^"]*(?:""[^"]*)*)"|\s*([^,]*))/g;

            let matches = [];
            let match;
            while (match = regex.exec(line)) {
                // Lấy group 2 (có ngoặc) hoặc group 3 (không ngoặc)
                let val = match[2] ? match[2].replace(/""/g, '"') : match[3];
                matches.push(val ? val.trim() : '');
            }

            if (matches.length > 0 && matches[0]) {
                result.push({
                    title: matches[0],
                    tags: matches[1] || '',
                    images: matches.slice(2).filter(u => u.startsWith('http'))
                });
            }
        }
        return result;
    }

    function clearData() {
        if(confirm('Xóa toàn bộ dữ liệu và reset?')) {
            STATE.csvData = [];
            STATE.currentIndex = 0;
            STATE.isRunning = false;
            updateUI();
            log('Đã xóa dữ liệu.');
        }
    }

    // --- LOGIC CHÍNH ---
    function startProcess() {
        if (!STATE.templateId) return alert('Thiếu Template ID!');
        if (STATE.csvData.length === 0) return alert('Thiếu dữ liệu CSV!');
        STATE.isRunning = true;
        processNext();
    }

    function stopProcess() {
        STATE.isRunning = false;
        log('Đã dừng.');
    }

    function processNext() {
        if (!STATE.isRunning) return;
        const rows = STATE.csvData;
        if (STATE.currentIndex >= rows.length) {
            STATE.isRunning = false;
            log('HOÀN TẤT TOÀN BỘ!');
            return alert('Xong hết file CSV!');
        }

        const row = rows[STATE.currentIndex];
        updateUI();

        const copyUrl = `https://www.etsy.com/your/shops/me/listing-editor/copy/${STATE.templateId}`;
        if (window.location.href.includes(copyUrl) || window.location.href.includes('/listing-editor/edit/')) {
            runFilling(row);
        } else {
            log('Đang mở trang Copy...');
            window.location.href = copyUrl;
        }
    }

    async function runFilling(row) {
        try {
            log('Đang xử lý dòng ' + (STATE.currentIndex + 1));

            // --- 1. TITLE ---
            log('Chờ input hiển thị...');
            const titleInput = await waitForSelector(CONFIG.selectors.titleInput);
            if (!titleInput) throw new Error('Không thấy ô Title');
            await sleep(CONFIG.delay.load);

            // Focus vào ô title cho giống người
            titleInput.focus();
            await sleep(500);

            log('Điền Title...');
            // Sử dụng changeValue an toàn (Full text update)
            // changeValue(titleInput, row.title); // <-- CŨ (Bỏ)
            await simulateTyping(titleInput, row.title); // <-- MỚI (Thêm)
            await sleep(CONFIG.delay.step);

            titleInput.blur(); // Bỏ focus

            // --- 2. TAGS ---
            log('Xử lý tags cũ...');
            const tagList = document.querySelector(CONFIG.selectors.tagContainer);
            if (tagList) {
                const deleteBtns = tagList.querySelectorAll(CONFIG.selectors.tagDeleteBtn);
                for (const btn of deleteBtns) { btn.click(); await sleep(200); }
            }
            await sleep(500);

            log('Thêm tags mới...');
            const tagInput = document.querySelector(CONFIG.selectors.tagInput);
            const tagAddBtn = document.querySelector(CONFIG.selectors.tagAddBtn);
            if (row.tags && tagInput && tagAddBtn) {
                const tags = row.tags.split(',').map(t => t.trim()).filter(t => t).slice(0, 13);
                for (const tag of tags) {
                    changeValue(tagInput, tag);
                    await sleep(300);
                    tagAddBtn.click();
                    await sleep(CONFIG.delay.tag);
                }
            }

            // --- 3. IMAGES ---
            if (row.images && row.images.length > 0) {
                log(`Đang tải ${row.images.length} ảnh...`);
                const files = await fetchImagesAsFiles(row.images);
                if (files.length > 0) {
                    log('Upload ảnh...');
                    await uploadFilesToEtsy(files);
                    log(`⏳ Đợi ${CONFIG.delay.uploadWait/1000}s load ảnh...`);
                    await sleep(CONFIG.delay.uploadWait);
                }
            }

            // --- 4. PUBLISH ---
            log('Cuộn xuống...');
            window.scrollTo(0, document.body.scrollHeight);
            await sleep(1500);

            const pubBtn = await waitForSelector(CONFIG.selectors.publishBtn, 5000);
            if (pubBtn) {
                log('Nhấn Publish...');
                pubBtn.click();
                await sleep(2000);
                const confirm = document.querySelector(CONFIG.selectors.confirmModalBtn);
                if (confirm) confirm.click();
                await waitForRedirect();
            } else {
                log('Retry Publish...');
                await sleep(5000);
                const retryBtn = document.querySelector(CONFIG.selectors.publishBtn);
                if (retryBtn) { retryBtn.click(); await waitForRedirect(); }
                else throw new Error('Không thấy nút Publish');
            }

        } catch (e) {
            console.error(e);
            log('Lỗi: ' + e.message);
            STATE.isRunning = false;
        }
    }

    // --- HELPERS ---
    //Gõ từng chữ mô phỏng người thật ---
    async function simulateTyping(input, text) {
        const prototype = (input.tagName === 'TEXTAREA')
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(prototype, "value").set;

        // Vòng lặp gõ từng ký tự
        for (let i = 1; i <= text.length; i++) {
            const currentText = text.substring(0, i);
            nativeSetter.call(input, currentText);

            // Hack để React nhận diện
            const tracker = input._valueTracker;
            if (tracker) tracker.setValue('');

            input.dispatchEvent(new Event('input', { bubbles: true }));

            // Delay ngẫu nhiên từ 20ms đến 60ms giữa mỗi lần gõ (tạo cảm giác tự nhiên)
            const delay = Math.floor(Math.random() * 40) + 20;
            await new Promise(r => setTimeout(r, delay));
        }
        // Gõ xong thì báo sự kiện change
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function changeValue(input, value) {
        // Đây là hàm set giá trị chuẩn cho React Input/Textarea
        const prototype = (input.tagName === 'TEXTAREA')
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(prototype, "value").set;

        nativeSetter.call(input, value);

        const tracker = input._valueTracker;
        if (tracker) tracker.setValue(''); // Hack để React nhận diện thay đổi

        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function waitForSelector(selector, timeout = 10000) {
        return new Promise(resolve => {
            if (document.querySelector(selector)) return resolve(document.querySelector(selector));
            const observer = new MutationObserver(() => {
                if (document.querySelector(selector)) {
                    resolve(document.querySelector(selector));
                    observer.disconnect();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
        });
    }

    async function fetchImagesAsFiles(urls) {
        const filePromises = urls.map((url, index) => {
            return new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: "GET", url: url, responseType: "blob",
                    onload: function(response) {
                        if (response.status === 200) {
                            const blob = response.response;
                            const filename = `img_${Date.now()}_${index}.jpg`;
                            resolve(new File([blob], filename, { type: "image/jpeg" }));
                        } else resolve(null);
                    },
                    onerror: function() { resolve(null); }
                });
            });
        });
        const files = await Promise.all(filePromises);
        return files.filter(f => f !== null);
    }

    async function uploadFilesToEtsy(files) {
        const fileInput = document.querySelector(CONFIG.selectors.fileInput);
        if (!fileInput) return;
        const dataTransfer = new DataTransfer();
        files.forEach(file => dataTransfer.items.add(file));
        fileInput.files = dataTransfer.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
        const uploadArea = document.querySelector('.wt-upload__area') || fileInput;
        uploadArea.scrollIntoView({behavior: "smooth", block: "center"});
    }

    async function waitForRedirect() {
        log('Chờ chuyển hướng...');
        return new Promise(resolve => {
            const check = setInterval(() => {
                if (!window.location.href.includes('listing-editor/copy')) {
                    clearInterval(check);
                    STATE.currentIndex++;
                    setTimeout(processNext, 2500);
                    resolve();
                }
            }, 1000);
        });
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    window.addEventListener('load', () => {
        createPanel();
        if (STATE.isRunning && window.location.href.includes('listing-editor')) {
            const rows = STATE.csvData;
            if (STATE.currentIndex < rows.length) runFilling(rows[STATE.currentIndex]);
        }
    });

})();
