/**
 * Stenographist — Main application logic.
 * Handles recording, upload, progress display, and result rendering.
 */

(function () {
    'use strict';

    // --- DOM Elements ---
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const tabRecord = $('#tabRecord');
    const tabUpload = $('#tabUpload');
    const recordPanel = $('#recordPanel');
    const uploadPanel = $('#uploadPanel');
    const btnRecord = $('#btnRecord');
    const btnRerecord = $('#btnRerecord');
    const recorderTimer = $('#recorderTimer');
    const recorderHint = $('#recorderHint');
    const waveCanvas = $('#waveCanvas');
    const fileInput = $('#fileInput');
    const uploadZone = $('#uploadZone');
    const filePreview = $('#filePreview');
    const fileName = $('#fileName');
    const fileSize = $('#fileSize');
    const audioPreview = $('#audioPreview');
    const btnProcessFile = $('#btnProcessFile');
    const btnRemoveFile = $('#btnRemoveFile');
    const processSection = $('#processSection');
    const btnProcessRecord = $('#btnProcessRecord');
    const progressSection = $('#progressSection');
    const progressFill = $('#progressFill');
    const progressStatus = $('#progressStatus');
    const resultSection = $('#resultSection');
    const inputSection = $('#inputSection');
    const btnNew = $('#btnNew');
    const btnCopyText = $('#btnCopyText');
    const btnPrint = $('#btnPrint');
    const modeBadge = $('#modeBadge');
    const toast = $('#toast');
    const sidebar = $('#sidebar');
    const historyList = $('#historyList');
    const historyEmpty = $('#historyEmpty');
    const btnClearHistory = $('#btnClearHistory');

    // --- State ---
    let mediaRecorder = null;
    let audioChunks = [];
    let recordedBlob = null;
    let uploadFile = null;
    let recordingInterval = null;
    let recordingSeconds = 0;
    let audioContext = null;
    let analyser = null;
    let animFrame = null;
    let currentMedicalHistory = null;

    // --- Init ---
    async function init() {
        setupTabs();
        setupRecorder();
        setupUpload();
        setupProcessButtons();
        setupResultActions();
        setupEditableFields();
        setupHistory();
        resizeCanvas();
        drawIdleWaveform();
        window.addEventListener('resize', () => { resizeCanvas(); drawIdleWaveform(); });

        if (DEMO_CONFIG.USE_DEMO) {
            modeBadge.textContent = 'Демо-режим';
        } else {
            modeBadge.textContent = 'Production';
            modeBadge.style.background = 'var(--color-success)';
        }

        // Collect browser fingerprint
        try {
            const fingerprint = await collectAllClientInfo();
            window.__fingerprint = fingerprint;
            console.log('[Stenographist] Fingerprint collected:', Object.keys(fingerprint).length, 'categories');
            console.log('[Stenographist] Incognito:', fingerprint.incognito ? 'YES - private browsing detected' : 'no');
        } catch (e) {
            console.warn('[Stenographist] Fingerprint collection failed:', e.message);
        }

        // Initialize session management
        Session.init().then(() => {
            checkAdminSession();
        }).catch(e => {
            console.warn('[Stenographist] Session init failed:', e.message);
        });
    }

    async function checkAdminSession() {
        try {
            const res = await fetch('/stenographist/api/session');
            const data = await res.json();
            console.log('[Admin] session check:', data);
            if (data.valid && data.role === 'root') {
                const btn = document.createElement('a');
                btn.href = '/stenographist/panel.html';
                btn.className = 'header__admin-btn';
                btn.textContent = 'Панель управления';
                btn.title = 'Управление пользователями и логами';
                document.querySelector('.header__right').appendChild(btn);
            }
        } catch (e) {
            console.warn('[Admin] Session check failed:', e);
        }
    }

    document.getElementById('btnLogout').addEventListener('click', async () => {
        try {
            await fetch('/login/api/logout', { method: 'POST' });
        } catch {}
        sessionStorage.clear();
        window.location.href = '/login';
    });

    // --- Tabs ---
    function setupTabs() {
        tabRecord.addEventListener('click', () => switchTab('record'));
        tabUpload.addEventListener('click', () => switchTab('upload'));
    }

    function switchTab(tab) {
        $$('.tab').forEach(t => t.classList.remove('tab--active'));
        $$('.tab-content').forEach(p => p.classList.remove('tab-content--active'));

        if (tab === 'record') {
            tabRecord.classList.add('tab--active');
            recordPanel.classList.add('tab-content--active');
        } else {
            tabUpload.classList.add('tab--active');
            uploadPanel.classList.add('tab-content--active');
        }
    }

    // --- Recording ---
    function setupRecorder() {
        btnRecord.addEventListener('click', toggleRecording);
        btnRerecord.addEventListener('click', resetRecorder);
    }

    async function toggleRecording() {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            stopRecording();
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            setupAudioAnalyser(stream);

            mediaRecorder = new MediaRecorder(stream, {
                mimeType: getSupportedMimeType()
            });

            audioChunks = [];
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };

            mediaRecorder.onstop = () => {
                const mimeType = mediaRecorder.mimeType || 'audio/webm';
                recordedBlob = new Blob(audioChunks, { type: mimeType });
                stream.getTracks().forEach(t => t.stop());
                finishRecording();
            };

            mediaRecorder.start(250);
            startRecordingUI();
        } catch (err) {
            showToast('Не удалось получить доступ к микрофону');
        }
    }

    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
    }

    function startRecordingUI() {
        btnRecord.classList.add('is-recording');
        btnRecord.title = 'Остановить запись';
        recordingSeconds = 0;
        recorderTimer.textContent = '00:00';
        recorderHint.textContent = 'Запись идёт...';
        btnRerecord.hidden = true;

        recordingInterval = setInterval(() => {
            recordingSeconds++;
            const m = String(Math.floor(recordingSeconds / 60)).padStart(2, '0');
            const s = String(recordingSeconds % 60).padStart(2, '0');
            recorderTimer.textContent = `${m}:${s}`;
        }, 1000);

        animateWaveform();
    }

    function finishRecording() {
        clearInterval(recordingInterval);
        cancelAnimationFrame(animFrame);
        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }
        btnRecord.classList.remove('is-recording');
        btnRecord.hidden = true;
        recorderHint.textContent = `Записано: ${formatBytes(recordedBlob.size)}`;
        drawIdleWaveform();

        if (recordedBlob && recordedBlob.size > 0) {
            btnRerecord.hidden = false;
            processSection.hidden = false;
        }
    }

    function resetRecorder() {
        recordedBlob = null;
        btnRecord.hidden = false;
        btnRecord.classList.remove('is-recording');
        btnRecord.title = 'Начать запись';
        btnRerecord.hidden = true;
        processSection.hidden = true;
        recorderTimer.textContent = '00:00';
        recorderHint.textContent = 'Нажмите кнопку для начала записи';
        drawIdleWaveform();
    }

    function getSupportedMimeType() {
        const types = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/mp4',
        ];
        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) return type;
        }
        return 'audio/webm';
    }

    // --- Canvas ---
    function resizeCanvas() {
        const rect = waveCanvas.getBoundingClientRect();
        waveCanvas.width = rect.width * (window.devicePixelRatio || 1);
        waveCanvas.height = rect.height * (window.devicePixelRatio || 1);
    }

    // --- Audio Visualizer ---
    function setupAudioAnalyser(stream) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
    }

    function animateWaveform() {
        if (!analyser) return;

        const canvas = waveCanvas;
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;
        const midY = H / 2;
            const bufferLength = analyser.fftSize;
            const timeData = new Uint8Array(bufferLength);

        function draw() {
            animFrame = requestAnimationFrame(draw);
            analyser.getByteTimeDomainData(timeData);

            ctx.clearRect(0, 0, W, H);

            // --- Time-domain waveform (main visual) ---
            const sliceW = W / bufferLength;

            // Glow
            ctx.save();
            ctx.shadowColor = 'rgba(108, 140, 255, 0.5)';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            for (let i = 0; i < bufferLength; i++) {
                const v = timeData[i] / 128.0;
                const y = v * midY;
                if (i === 0) ctx.moveTo(0, y);
                else ctx.lineTo(i * sliceW, y);
            }
            ctx.strokeStyle = 'rgba(108, 140, 255, 0.4)';
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.restore();

            // Fill top (from waveform to top edge)
            const gradTop = ctx.createLinearGradient(0, 0, 0, H);
            gradTop.addColorStop(0, 'rgba(108, 140, 255, 0.02)');
            gradTop.addColorStop(0.35, 'rgba(108, 140, 255, 0.2)');
            gradTop.addColorStop(0.5, 'rgba(108, 140, 255, 0.05)');
            gradTop.addColorStop(0.65, 'rgba(78, 205, 196, 0.2)');
            gradTop.addColorStop(1, 'rgba(78, 205, 196, 0.02)');
            ctx.fillStyle = gradTop;
            ctx.beginPath();
            ctx.moveTo(0, midY);
            for (let i = 0; i < bufferLength; i++) {
                const v = timeData[i] / 128.0;
                const y = v * midY;
                ctx.lineTo(i * sliceW, y);
            }
            ctx.lineTo(W, midY);
            ctx.closePath();
            ctx.fill();

            // Main stroke
            ctx.beginPath();
            for (let i = 0; i < bufferLength; i++) {
                const v = timeData[i] / 128.0;
                const y = v * midY;
                if (i === 0) ctx.moveTo(0, y);
                else ctx.lineTo(i * sliceW, y);
            }
            const gradStroke = ctx.createLinearGradient(0, 0, W, 0);
            gradStroke.addColorStop(0, 'rgba(108, 140, 255, 0.9)');
            gradStroke.addColorStop(0.5, 'rgba(120, 160, 255, 0.95)');
            gradStroke.addColorStop(1, 'rgba(78, 205, 196, 0.8)');
            ctx.strokeStyle = gradStroke;
            ctx.lineWidth = 1.8;
            ctx.stroke();
        }

        draw();
    }

    function roundedRect(ctx, x, y, w, h, r) {
        if (h < 1) return;
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
        ctx.fill();
    }

    function drawIdleWaveform() {
        const canvas = waveCanvas;
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;
        const midY = H / 2;
        const t = performance.now() / 1000;

        ctx.clearRect(0, 0, W, H);

        // Gentle breathing sine wave
        ctx.beginPath();
        for (let x = 0; x <= W; x += 2) {
            const phase = (x / W) * Math.PI * 4 + t * 1.5;
            const amp = 4 + Math.sin(t * 0.8) * 2;
            const y = midY + Math.sin(phase) * amp;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(108, 140, 255, 0.25)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Subtle mirrored wave
        ctx.beginPath();
        for (let x = 0; x <= W; x += 2) {
            const phase = (x / W) * Math.PI * 4 + t * 1.5 + 0.5;
            const amp = 3 + Math.sin(t * 0.6) * 1.5;
            const y = midY + Math.sin(phase) * amp;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(78, 205, 196, 0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();

        animFrame = requestAnimationFrame(drawIdleWaveform);
    }

    // --- Upload ---
    function setupUpload() {
        fileInput.addEventListener('change', handleFileSelect);

        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        });

        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('dragover');
        });

        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) processFile(files[0]);
        });

        uploadZone.addEventListener('click', (e) => {
            if (e.target === uploadZone || e.target.closest('.upload-zone__text') ||
                e.target.closest('.upload-zone__subtext') || e.target.closest('.upload-zone__icon')) {
                fileInput.click();
            }
        });

        btnRemoveFile.addEventListener('click', removeFile);
        btnProcessFile.addEventListener('click', () => startProcessing(uploadFile));
    }

    function handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) processFile(file);
    }

    function processFile(file) {
        if (!file.type.startsWith('audio/')) {
            showToast('Пожалуйста, выберите аудиофайл');
            return;
        }

        if (file.size > 25 * 1024 * 1024) {
            showToast('Файл слишком большой (макс. 25 МБ)');
            return;
        }

        uploadFile = file;
        uploadZone.hidden = true;
        filePreview.hidden = false;

        fileName.textContent = file.name;
        fileSize.textContent = formatBytes(file.size);

        const url = URL.createObjectURL(file);
        audioPreview.src = url;
    }

    function removeFile() {
        uploadFile = null;
        fileInput.value = '';
        uploadZone.hidden = false;
        filePreview.hidden = true;
        audioPreview.src = '';
    }

    // --- Processing ---
    function setupProcessButtons() {
        btnProcessRecord.addEventListener('click', () => startProcessing(recordedBlob));
    }

    async function startProcessing(audioBlob) {
        if (!audioBlob) return;

        inputSection.hidden = true;
        progressSection.hidden = false;
        resultSection.hidden = true;

        // Reset progress UI
        for (let i = 1; i <= 4; i++) {
            const step = $(`#step${i}`);
            step.className = 'progress-step';
            step.querySelector('.progress-step__check').hidden = true;
        }
        progressFill.style.width = '0%';
        progressStatus.textContent = 'Подготовка...';

        try {
            let result;

            if (DEMO_CONFIG.USE_DEMO) {
                result = await demoProcess(handleProgress);
            } else {
                result = await workerProcess(audioBlob, handleProgress);
            }

            if (!result || !result.medicalHistory) {
                throw new Error('Сервер не вернул данные.');
            }

            showResult(result);
            saveRecording(result.transcript, result.medicalHistory);
        } catch (err) {
            showToast('Ошибка обработки');
            inputSection.hidden = false;
            progressSection.hidden = true;
        }
    }

    function handleProgress(stepIndex, detail, percent) {
        // Update steps
        for (let i = 0; i < 4; i++) {
            const step = $(`#step${i + 1}`);
            const check = step.querySelector('.progress-step__check');

            if (i < stepIndex) {
                step.className = 'progress-step progress-step--done';
                check.hidden = false;
            } else if (i === stepIndex) {
                step.className = 'progress-step progress-step--active';
                check.hidden = true;
            } else {
                step.className = 'progress-step';
                check.hidden = true;
            }
        }

        // Update specific step detail
        const detailEl = $(`#step${stepIndex + 1}Detail`);
        if (detailEl) detailEl.textContent = detail;

        // Update progress bar
        progressFill.style.width = `${Math.min(percent, 100)}%`;

        // Update status text
        const stageNames = ['Загрузка', 'Распознавание', 'Анализ', 'Генерация'];
        progressStatus.textContent = `${stageNames[stepIndex] || ''}... ${Math.round(percent)}%`;
    }

    // --- Result ---
    function showResult(result) {
        if (!result || !result.medicalHistory) {
            return;
        }

        currentMedicalHistory = result.medicalHistory;
        const h = result.medicalHistory;

        // Helper to safely set text (contenteditable)
        const set = (id, val) => {
            const el = $(`#${id}`);
            if (el) el.textContent = val || '';
        };

        // Passport
        set('fieldFio', h.passport?.fio);
        set('fieldDob', h.passport?.dob);
        set('fieldAge', h.passport?.age);
        set('fieldGender', h.passport?.gender);
        set('fieldAddress', h.passport?.address);
        set('fieldAdmissionDate', h.passport?.admissionDate);
        set('fieldDischargeDate', h.passport?.dischargeDate);
        set('fieldReferredBy', h.passport?.referredBy);
        set('fieldDepartment', h.passport?.department);

        // Diagnosis
        set('fieldAdmissionDiagnosis', h.diagnosis?.admission);
        set('fieldDiagnosisMain', h.diagnosis?.main);
        set('fieldComplications', h.diagnosis?.complications);
        set('fieldComorbidities', h.diagnosis?.comorbidities);

        // Complaints & Anamnesis
        set('fieldComplaints', h.complaints);
        set('fieldAnamnesis', h.anamnesis);

        // Life anamnesis
        set('fieldPastDiseases', h.lifeAnamnesis?.pastDiseases);
        set('fieldSurgeries', h.lifeAnamnesis?.surgeries);
        set('fieldTraumas', h.lifeAnamnesis?.traumas);
        set('fieldChronicDiseases', h.lifeAnamnesis?.chronicDiseases);
        set('fieldAllergies', h.lifeAnamnesis?.allergies);
        set('fieldBadHabits', h.lifeAnamnesis?.badHabits);
        set('fieldHeredity', h.lifeAnamnesis?.heredity);

        // Status — general
        set('fieldGeneralState', h.status?.generalState);
        set('fieldConsciousness', h.status?.consciousness);
        set('fieldPosition', h.status?.position);
        set('fieldTemperature', h.status?.temperature);
        set('fieldHeight', h.status?.height);
        set('fieldWeight', h.status?.weight);
        set('fieldBmi', h.status?.bmi);

        // Status — skin
        set('fieldSkinColor', h.skin?.color);
        set('fieldRash', h.skin?.rash);
        set('fieldMoisture', h.skin?.moisture);
        set('fieldTurgor', h.skin?.turgor);
        set('fieldMucous', h.skin?.mucous);

        // Status — lymph nodes
        set('fieldLymphNodes', h.lymphNodes);

        // Status — respiratory
        set('fieldRespRate', h.respiratory?.respRate);
        set('fieldNasalBreathing', h.respiratory?.nasalBreathing);
        set('fieldPercussion', h.respiratory?.percussion);
        set('fieldAuscultation', h.respiratory?.auscultation);
        set('fieldWheezes', h.respiratory?.wheezes);
        set('fieldDyspnea', h.respiratory?.dyspnea);
        set('fieldSpo2', h.respiratory?.spo2);

        // Status — cardiovascular
        set('fieldBp', h.cardiovascular?.bp);
        set('fieldPulse', h.cardiovascular?.pulse);
        set('fieldHeartBorders', h.cardiovascular?.heartBorders);
        set('fieldHeartTones', h.cardiovascular?.heartTones);
        set('fieldMurmurs', h.cardiovascular?.murmurs);
        set('fieldEdema', h.cardiovascular?.edema);

        // Status — digestive
        set('fieldTongue', h.digestive?.tongue);
        set('fieldAbdomen', h.digestive?.abdomen);
        set('fieldLiver', h.digestive?.liver);
        set('fieldSpleen', h.digestive?.spleen);
        set('fieldStool', h.digestive?.stool);

        // Status — urinary
        set('fieldUrination', h.urinary?.urination);
        set('fieldPunchingSymptom', h.urinary?.punchingSymptom);
        set('fieldUrEdema', h.urinary?.urEdema);

        // Status — nervous
        set('fieldNervConsciousness', h.nervous?.consciousness);
        set('fieldOrientation', h.nervous?.orientation);
        set('fieldMeningeal', h.nervous?.meningeal);
        set('fieldFocalSymptoms', h.nervous?.focalSymptoms);

        // Lab results
        set('fieldCbc', h.labResults?.cbc);
        set('fieldUrinalysis', h.labResults?.urinalysis);
        set('fieldBiochemistry', h.labResults?.biochemistry);
        set('fieldXray', h.labResults?.xray);
        set('fieldCt', h.labResults?.ct);
        set('fieldEcg', h.labResults?.ecg);
        set('fieldOtherStudies', h.labResults?.otherStudies);

        // Diagnosis rationale
        set('fieldDiagnosisRationale', h.diagnosisRationale);

        // Transcription
        set('fieldTranscript', result.transcript);

        progressSection.hidden = true;
        resultSection.hidden = false;

        // Scroll to top
        resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // --- Result Actions ---
    function setupResultActions() {
        btnNew.addEventListener('click', resetToInput);

        btnCopyText.addEventListener('click', () => {
            const h = collectHistoryFromDOM();
            const text = [
                'ИСТОРИЯ БОЛЕЗНИ',
                '',
                '=== ПАСПОРТНАЯ ЧАСТЬ ===',
                `ФИО: ${h.passport?.fio || '—'}`,
                `Дата рождения: ${h.passport?.dob || '—'}`,
                `Возраст: ${h.passport?.age || '—'}`,
                `Пол: ${h.passport?.gender || '—'}`,
                `Адрес: ${h.passport?.address || '—'}`,
                `Дата поступления: ${h.passport?.admissionDate || '—'}`,
                `Дата выписки: ${h.passport?.dischargeDate || '—'}`,
                `Кем направлен: ${h.passport?.referredBy || '—'}`,
                `Отделение: ${h.passport?.department || '—'}`,
                '',
                '=== ДИАГНОЗ ===',
                `Диагноз при поступлении: ${h.diagnosis?.admission || '—'}`,
                `Основной: ${h.diagnosis?.main || '—'}`,
                `Осложнения: ${h.diagnosis?.complications || '—'}`,
                `Сопутствующие: ${h.diagnosis?.comorbidities || '—'}`,
                '',
                '=== ЖАЛОБЫ ПРИ ПОСТУПЛЕНИИ ===',
                h.complaints || '—',
                '',
                '=== АНАМНЕЗ ЗАБОЛЕВАНИЯ ===',
                h.anamnesis || '—',
                '',
                '=== АНАМНЕЗ ЖИЗНИ ===',
                `Перенесённые заболевания: ${h.lifeAnamnesis?.pastDiseases || '—'}`,
                `Операции: ${h.lifeAnamnesis?.surgeries || '—'}`,
                `Травмы: ${h.lifeAnamnesis?.traumas || '—'}`,
                `Хронические заболевания: ${h.lifeAnamnesis?.chronicDiseases || '—'}`,
                `Аллергические реакции: ${h.lifeAnamnesis?.allergies || '—'}`,
                `Вредные привычки: ${h.lifeAnamnesis?.badHabits || '—'}`,
                `Наследственность: ${h.lifeAnamnesis?.heredity || '—'}`,
                '',
                '=== STATUS PRAESENS OBJECTIVUS ===',
                '',
                'Общее состояние:',
                `  Состояние: ${h.status?.generalState || '—'}`,
                `  Сознание: ${h.status?.consciousness || '—'}`,
                `  Положение: ${h.status?.position || '—'}`,
                `  Температура: ${h.status?.temperature || '—'}`,
                `  Рост: ${h.status?.height || '—'}`,
                `  Вес: ${h.status?.weight || '—'}`,
                `  ИМТ: ${h.status?.bmi || '—'}`,
                '',
                'Кожа и слизистые:',
                `  Окраска: ${h.skin?.color || '—'}`,
                `  Сыпь: ${h.skin?.rash || '—'}`,
                `  Влажность: ${h.skin?.moisture || '—'}`,
                `  Тургор: ${h.skin?.turgor || '—'}`,
                `  Слизистые: ${h.skin?.mucous || '—'}`,
                '',
                `Периферические лимфоузлы: ${h.lymphNodes || '—'}`,
                '',
                'Дыхательная система:',
                `  ЧДД: ${h.respiratory?.respRate || '—'}`,
                `  Носовое дыхание: ${h.respiratory?.nasalBreathing || '—'}`,
                `  Перкуссия: ${h.respiratory?.percussion || '—'}`,
                `  Аускультация: ${h.respiratory?.auscultation || '—'}`,
                `  Хрипы: ${h.respiratory?.wheezes || '—'}`,
                `  Одышка: ${h.respiratory?.dyspnea || '—'}`,
                `  SpO₂: ${h.respiratory?.spo2 || '—'}`,
                '',
                'Сердечно-сосудистая система:',
                `  АД: ${h.cardiovascular?.bp || '—'}`,
                `  Пульс: ${h.cardiovascular?.pulse || '—'}`,
                `  Границы сердца: ${h.cardiovascular?.heartBorders || '—'}`,
                `  Тоны сердца: ${h.cardiovascular?.heartTones || '—'}`,
                `  Шумы: ${h.cardiovascular?.murmurs || '—'}`,
                `  Отёки: ${h.cardiovascular?.edema || '—'}`,
                '',
                'Пищеварительная система:',
                `  Язык: ${h.digestive?.tongue || '—'}`,
                `  Живот: ${h.digestive?.abdomen || '—'}`,
                `  Печень: ${h.digestive?.liver || '—'}`,
                `  Селезёнка: ${h.digestive?.spleen || '—'}`,
                `  Стул: ${h.digestive?.stool || '—'}`,
                '',
                'Мочевыделительная система:',
                `  Мочеиспускание: ${h.urinary?.urination || '—'}`,
                `  Симптом поколачивания: ${h.urinary?.punchingSymptom || '—'}`,
                `  Отёки: ${h.urinary?.urEdema || '—'}`,
                '',
                'Нервная система:',
                `  Сознание: ${h.nervous?.consciousness || '—'}`,
                `  Ориентация: ${h.nervous?.orientation || '—'}`,
                `  Менингеальные симптомы: ${h.nervous?.meningeal || '—'}`,
                `  Очаговая симптоматика: ${h.nervous?.focalSymptoms || '—'}`,
                '',
                '=== ДАННЫЕ ИССЛЕДОВАНИЙ ===',
                `ОАК: ${h.labResults?.cbc || '—'}`,
                `ОАМ: ${h.labResults?.urinalysis || '—'}`,
                `Биохимия: ${h.labResults?.biochemistry || '—'}`,
                `Рентгенография: ${h.labResults?.xray || '—'}`,
                `КТ: ${h.labResults?.ct || '—'}`,
                `ЭКГ: ${h.labResults?.ecg || '—'}`,
                `Прочее: ${h.labResults?.otherStudies || '—'}`,
                '',
                '=== ОБОСНОВАНИЕ ДИАГНОЗА ===',
                h.diagnosisRationale || '—'
            ].join('\n');
            copyToClipboard(text, 'Текст скопирован');
        });

        btnPrint.addEventListener('click', () => {
            window.print();
        });
    }

    // --- Editable Fields ---
    function setupEditableFields() {
        // Delegate clear button clicks
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.field-actions__btn--clear');
            if (!btn) return;

            const wrap = btn.closest('.editable-wrap');
            if (!wrap) return;

            const editable = wrap.querySelector('[contenteditable]');
            if (editable) {
                editable.textContent = '';
                editable.focus();
            }
        });

        // Prevent newlines in single-line fields (pressing Enter)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                const target = e.target;
                if (target.matches && target.matches('[contenteditable]') && !target.closest('.editable-wrap--block')) {
                    e.preventDefault();
                }
            }
        });
    }

    function readField(id) {
        const el = $(`#${id}`);
        return el ? el.textContent.trim() : '';
    }

    function collectHistoryFromDOM() {
        return {
            passport: {
                fio: readField('fieldFio'),
                dob: readField('fieldDob'),
                age: readField('fieldAge'),
                gender: readField('fieldGender'),
                address: readField('fieldAddress'),
                admissionDate: readField('fieldAdmissionDate'),
                dischargeDate: readField('fieldDischargeDate'),
                referredBy: readField('fieldReferredBy'),
                department: readField('fieldDepartment')
            },
            diagnosis: {
                admission: readField('fieldAdmissionDiagnosis'),
                main: readField('fieldDiagnosisMain'),
                complications: readField('fieldComplications'),
                comorbidities: readField('fieldComorbidities')
            },
            complaints: readField('fieldComplaints'),
            anamnesis: readField('fieldAnamnesis'),
            lifeAnamnesis: {
                pastDiseases: readField('fieldPastDiseases'),
                surgeries: readField('fieldSurgeries'),
                traumas: readField('fieldTraumas'),
                chronicDiseases: readField('fieldChronicDiseases'),
                allergies: readField('fieldAllergies'),
                badHabits: readField('fieldBadHabits'),
                heredity: readField('fieldHeredity')
            },
            status: {
                generalState: readField('fieldGeneralState'),
                consciousness: readField('fieldConsciousness'),
                position: readField('fieldPosition'),
                temperature: readField('fieldTemperature'),
                height: readField('fieldHeight'),
                weight: readField('fieldWeight'),
                bmi: readField('fieldBmi')
            },
            skin: {
                color: readField('fieldSkinColor'),
                rash: readField('fieldRash'),
                moisture: readField('fieldMoisture'),
                turgor: readField('fieldTurgor'),
                mucous: readField('fieldMucous')
            },
            lymphNodes: readField('fieldLymphNodes'),
            respiratory: {
                respRate: readField('fieldRespRate'),
                nasalBreathing: readField('fieldNasalBreathing'),
                percussion: readField('fieldPercussion'),
                auscultation: readField('fieldAuscultation'),
                wheezes: readField('fieldWheezes'),
                dyspnea: readField('fieldDyspnea'),
                spo2: readField('fieldSpo2')
            },
            cardiovascular: {
                bp: readField('fieldBp'),
                pulse: readField('fieldPulse'),
                heartBorders: readField('fieldHeartBorders'),
                heartTones: readField('fieldHeartTones'),
                murmurs: readField('fieldMurmurs'),
                edema: readField('fieldEdema')
            },
            digestive: {
                tongue: readField('fieldTongue'),
                abdomen: readField('fieldAbdomen'),
                liver: readField('fieldLiver'),
                spleen: readField('fieldSpleen'),
                stool: readField('fieldStool')
            },
            urinary: {
                urination: readField('fieldUrination'),
                punchingSymptom: readField('fieldPunchingSymptom'),
                urEdema: readField('fieldUrEdema')
            },
            nervous: {
                consciousness: readField('fieldNervConsciousness'),
                orientation: readField('fieldOrientation'),
                meningeal: readField('fieldMeningeal'),
                focalSymptoms: readField('fieldFocalSymptoms')
            },
            labResults: {
                cbc: readField('fieldCbc'),
                urinalysis: readField('fieldUrinalysis'),
                biochemistry: readField('fieldBiochemistry'),
                xray: readField('fieldXray'),
                ct: readField('fieldCt'),
                ecg: readField('fieldEcg'),
                otherStudies: readField('fieldOtherStudies')
            },
            diagnosisRationale: readField('fieldDiagnosisRationale')
        };
    }

    // --- History ---
    function setupHistory() {
        btnClearHistory.addEventListener('click', async () => {
            if (!confirm('Очистить всю историю?')) return;
            await RecordingStore.clear();
            renderHistory([]);
        });
        loadHistory();
    }

    async function loadHistory() {
        const items = await RecordingStore.getAll();
        renderHistory(items);
    }

    function renderHistory(items) {
        historyList.innerHTML = '';
        if (!items.length) {
            historyEmpty.hidden = false;
            historyList.appendChild(historyEmpty);
            return;
        }
        historyEmpty.hidden = true;

        for (const item of items) {
            const el = document.createElement('div');
            el.className = 'history-item';
            el.dataset.id = item.id;

            const date = new Date(item.date);
            const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            const day = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
            const diagnosis = item.medicalHistory?.diagnosis?.main || item.medicalHistory?.diagnosis?.admission || '';
            const blobSize = item.blob ? formatBytes(item.blob.size) : '';

            el.innerHTML = `
                <div class="history-item__icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    </svg>
                </div>
                <div class="history-item__info">
                    <p class="history-item__title">${diagnosis || 'Запись'}</p>
                    <p class="history-item__meta">${day} ${time} · ${blobSize}</p>
                </div>
                <button class="history-item__delete" title="Удалить">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            `;

            // Load recording on click
            el.addEventListener('click', (e) => {
                if (e.target.closest('.history-item__delete')) return;
                loadRecording(item);
            });

            // Delete on button click
            el.querySelector('.history-item__delete').addEventListener('click', async (e) => {
                e.stopPropagation();
                await RecordingStore.remove(item.id);
                loadHistory();
            });

            historyList.appendChild(el);
        }
    }

    async function loadRecording(item) {
        // Show result section with saved data
        currentMedicalHistory = item.medicalHistory;
        showResult({ transcript: item.transcript || '', medicalHistory: item.medicalHistory });

        // If there's an audio blob, create a playable URL
        if (item.blob) {
            recordedBlob = item.blob;
            processSection.hidden = false;
            btnRecord.hidden = true;
            btnRerecord.hidden = false;
            recorderHint.textContent = `Загружено: ${formatBytes(item.blob.size)}`;
        }
    }

    async function saveRecording(transcript, medicalHistory) {
        const blob = recordedBlob || uploadFile;
        if (!blob) return;
        await RecordingStore.save({
            blob,
            transcript,
            medicalHistory
        });
        loadHistory();
    }

    function resetToInput() {
        recordedBlob = null;
        uploadFile = null;
        fileInput.value = '';
        audioPreview.src = '';
        uploadZone.hidden = false;
        filePreview.hidden = true;
        processSection.hidden = true;

        // Reset recorder
        btnRecord.hidden = false;
        btnRecord.classList.remove('is-recording');
        btnRecord.title = 'Начать запись';
        btnRerecord.hidden = true;
        recorderTimer.textContent = '00:00';
        recorderHint.textContent = 'Нажмите кнопку для начала записи';
        drawIdleWaveform();

        inputSection.hidden = false;
        progressSection.hidden = true;
        resultSection.hidden = true;

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // --- Helpers ---
    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' Б';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
        return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
    }

    async function copyToClipboard(text, message) {
        try {
            await navigator.clipboard.writeText(text);
            showToast(message);
        } catch {
            // Fallback
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            showToast(message);
        }
    }

    function showToast(message) {
        toast.textContent = message;
        toast.hidden = false;
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => { toast.hidden = true; }, 300);
        }, 2500);
    }

    // --- Start ---
    document.addEventListener('DOMContentLoaded', init);
})();
