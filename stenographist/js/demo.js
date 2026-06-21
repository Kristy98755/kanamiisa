/**
 * Demo mode: mock data and simulated processing stages.
 * Replace with real Cloudflare Worker calls in production.
 */

const DEMO_CONFIG = {
    WORKER_URL: 'https://stenographist.itismynickname9.workers.dev',
    USE_DEMO: false,
};

// Simulated transcription text (as if Whisper recognized it)
const DEMO_TRANSCRIPTION = `Доктор, меня беспокоит боль в горле уже третий день. Началось с першения, потом появилась боль при глотании. Температура поднималась до 37.8, сбивалась парацетамолом. Кашля нет, насморк небольшой. Горло красное, на миндалинах белый налёт. Принимаю амоксициллин по 500 миллиграмм три раза в день, уже второй день. Аллергии на антибиотики нет. Ранее болел ангиной примерно два года назад, тогда тоже назначали антибиотики. Хронических заболеваний нет, давление нормальное. Работаю в офисе, контактировал с болеющими коллегами на прошлой неделе.`;

// Structured medical history JSON
const DEMO_MEDICAL_HISTORY = {
    passport: {
        fio: 'Иванов Иван Иванович',
        dob: '15.03.1965',
        age: '61 год',
        gender: 'Мужской',
        address: 'г. Москва, ул. Пушкина, д. 10, кв. 25',
        admissionDate: '21.06.2026, 14:30',
        dischargeDate: '',
        referredBy: 'Поликлиника №4, терапевт Сидорова А.В.',
        department: 'Терапевтическое'
    },
    diagnosis: {
        admission: 'Острый бронхит (J20.9)',
        main: 'Острый бронхит (J20.9)',
        complications: 'Не осложнён',
        comorbidities: 'Артериальная гипертензия II ст. (риск 2), хронический гастрит'
    },
    complaints: 'Жалуется на повышение температуры тела до 38,5°C, кашель с трудноотделяемой мокротой, общую слабость, снижение аппетита. Одышка при физической нагрузке.',
    anamnesis: 'Считает себя больным в течение 3 суток. Заболевание началось с появления сухого кашля и повышения температуры тела до 38,2°C. Получал амбулаторное лечение: амоксициллин 500 мг 3 р/д, ацетилцистеин 600 мг 1 р/д — без выраженного эффекта. В связи с сохранением и нарастанием симптомов (температура до 38,5°C, появление мокроты) госпитализирован в терапевтическое отделение.',
    lifeAnamnesis: {
        pastDiseases: 'Пневмония (2018), острый бронхит (2023)',
        surgeries: 'Аппендэктомия (1992)',
        traumas: 'Перелом лучевой кости правой кисти (2005)',
        chronicDiseases: 'Артериальная гипертензия II ст. с 2015 г., хронический гастрит с 2010 г.',
        allergies: 'Пенициллин — крапивница',
        badHabits: 'Курение 10 лет (бросил в 2020), алкоголь умеренно',
        heredity: 'Отец — ИБС, инфаркт миокарда в 68 лет. Мать — сахарный диабет 2 типа.'
    },
    status: {
        generalState: 'Средней тяжести',
        consciousness: 'Ясное',
        position: 'Активное',
        temperature: '38,4°C',
        height: '178 см',
        weight: '85 кг',
        bmi: '26,8'
    },
    skin: {
        color: 'Нормальная, бледноватая',
        rash: 'Нет',
        moisture: 'Нормальная',
        turgor: 'Сохранён',
        mucous: 'Слизистая ротоглотки гиперемирована, зев гиперемирован'
    },
    lymphNodes: 'Подчелюстные лимфоузлы увеличены до 1,5 см, безболезненные, подвижные. Шейные, подмышечные, паховые — не увеличены.',
    respiratory: {
        respRate: '22 в мин',
        nasalBreathing: 'Затруднено',
        percussion: 'Ясный лёгочный звук',
        auscultation: 'Жёсткое дыхание, хрипы в нижних отделах с обеих сторон',
        wheezes: 'Среднепищевидные влажные хрипы с обеих сторон, больше справа',
        dyspnea: 'При физической нагрузке',
        spo2: '94%'
    },
    cardiovascular: {
        bp: '145/90 мм рт.ст.',
        pulse: '92 уд/мин, ритмичный',
        heartBorders: 'Не расширены',
        heartTones: ' Приглушены, акцент II тона на аорте',
        murmurs: 'Нет',
        edema: 'Нет'
    },
    digestive: {
        tongue: 'Обложен белым налётом',
        abdomen: 'Мягкий, безболезненный',
        liver: 'Не увеличена',
        spleen: 'Не увеличена',
        stool: 'Нормальной консистенции, 1 р/д'
    },
    urinary: {
        urination: 'Свободное, безболезненное',
        punchingSymptom: 'Отрицательный с обеих сторон',
        urEdema: 'Нет'
    },
    nervous: {
        consciousness: 'Ясное',
        orientation: 'Ориентирован в пространстве, времени, собственной личности',
        meningeal: 'Негативные',
        focalSymptoms: 'Не выявлены'
    },
    labResults: {
        cbc: 'Лейкоциты 12,4×10⁹/л (↑), СОЭ 28 мм/ч (↑), нейтрофилы 78% (↑), гемоглобин 138 г/л',
        urinalysis: 'Без патологии',
        biochemistry: 'Глюкоза 5,8 ммоль/л, креатинин 92 мкмоль/л, мочевина 7,2 ммоль/л, АЛТ 35 Ед/л, АСТ 28 Ед/л',
        xray: 'Усиление лёгочного рисунка в нижних отделах с обеих сторон, без очаговых и инфильтративных теней',
        ct: 'Не проводилась',
        ecg: 'Синусовая тахикардия, ЧСС 92 уд/мин. Гипертрофия миокарда левого желудочка.',
        otherStudies: 'Спирометрия: ОФВ1/ФЖЕЛ — 72% (снижено). ФВД: restrictive pattern.'
    },
    diagnosisRationale: 'Клиническая картина острого бронхита (кашель с мокротой, повышение температуры, жёсткое дыхание с хрипами) подтверждается данными ОАК (лейкоцитоз, нейтрофилёз, повышение СОЭ) и рентгенологическими данными (усиление лёгочного рисунка). Дифференциальная диагностика с пневмонией: отсутствие очаговых теней на рентгене, ОФВ1/ФЖЕЛ снижено незначительно — данные за бронхит. Сопутствующая артериальная гипертензия учитывается при выборе тактики лечения.'
};

const DEMO_STAGES = [
    {
        step: 1,
        title: 'Загрузка аудио',
        detail: 'Отправка аудиофайла на сервер...',
        duration: 1200,
        finalDetail: 'Файл загружен (124 КБ)'
    },
    {
        step: 2,
        title: 'Распознавание речи',
        detail: 'Модель Whisper анализирует аудио...',
        duration: 2500,
        finalDetail: 'Речь распознана (187 слов, 14 сек)'
    },
    {
        step: 3,
        title: 'Анализ текста',
        detail: 'Извлечение медицинских данных из текста...',
        duration: 1500,
        finalDetail: 'Извлечены ключевые медицинские данные'
    },
    {
        step: 4,
        title: 'Формирование истории болезни',
        detail: 'Языковая модель формирует структурированный документ...',
        duration: 3000,
        finalDetail: 'История болезни сформирована'
    }
];

/**
 * Simulate processing with progress callbacks.
 * Returns a Promise that resolves with { transcript, medicalHistory }.
 *
 * @param {function} onProgress - Called with (stepIndex, detail, percent)
 */
function demoProcess(onProgress) {
    console.log('[Demo] Starting demo process');
    return new Promise((resolve) => {
        let currentStep = 0;
        let totalPercent = 0;

        function runStep() {
            if (currentStep >= DEMO_STAGES.length) {
                resolve({
                    transcript: DEMO_TRANSCRIPTION,
                    medicalHistory: DEMO_MEDICAL_HISTORY
                });
                return;
            }

            const stage = DEMO_STAGES[currentStep];
            const stepWeight = 100 / DEMO_STAGES.length;

            // Start step
            onProgress(currentStep, stage.detail, totalPercent);

            // Simulate detail updates during the step
            const interval = stage.duration / 4;
            for (let i = 1; i <= 4; i++) {
                setTimeout(() => {
                    const pct = totalPercent + (stepWeight * i / 4);
                    const detail = i < 4
                        ? `${stage.detail} (${i * 25}%)`
                        : stage.finalDetail;
                    onProgress(currentStep, detail, pct);
                }, interval * i);
            }

            setTimeout(() => {
                totalPercent += stepWeight;
                currentStep++;
                runStep();
            }, stage.duration);
        }

        runStep();
    });
}

/**
 * Process audio through the real Cloudflare Worker.
 * Uses Server-Sent Events for progress if supported.
 *
 * @param {File|Blob} audioBlob
 * @param {function} onProgress
 * @returns {Promise<{transcript: string, medicalHistory: object}>}
 */
async function workerProcess(audioBlob, onProgress) {
    const workerUrl = DEMO_CONFIG.WORKER_URL;

    console.log(`[Worker] Starting process, audio: ${audioBlob.size} bytes, type: ${audioBlob.type}`);

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const durationSec = audioBuffer.duration;
    audioContext.close();

    console.log(`[Worker] Audio duration: ${durationSec.toFixed(1)}s`);
    onProgress(0, `Длительность: ${durationSec.toFixed(0)}с`, 2);

    const MAX_CHUNK_SEC = 60;
    let fullTranscript = '';

    if (durationSec > MAX_CHUNK_SEC) {
        // Split with ffmpeg.wasm
        let numChunks = 1;
        while (durationSec / numChunks > MAX_CHUNK_SEC) numChunks++;
        const segmentTime = Math.ceil(durationSec / numChunks);
        console.log(`[Worker] Need ${numChunks} chunks, segment_time=${segmentTime}s`);

        onProgress(0, 'Загрузка ffmpeg...', 3);
        const ffmpeg = await loadFFmpeg((p) => {
            onProgress(0, `Загрузка ffmpeg: ${Math.round(p * 100)}%`, 3 + Math.round(p * 12));
        });

        onProgress(0, 'Разбиение аудио...', 15);
        const inputName = 'input.webm';
        const inputData = new Uint8Array(arrayBuffer);
        await ffmpeg.FS('writeFile', inputName, inputData);

        const outPattern = 'chunk_%03d.webm';
        await ffmpeg.run(
            '-i', inputName,
            '-f', 'segment',
            '-segment_time', String(segmentTime),
            '-c', 'copy',
            '-reset_timestamps', '1',
            outPattern
        );

        // Read chunks
        const chunkFiles = [];
        for (let i = 0; i < numChunks + 2; i++) {
            const name = `chunk_${String(i).padStart(3, '0')}.webm`;
            try {
                const data = await ffmpeg.FS('readFile', name);
                if (data.length > 0) {
                    chunkFiles.push({ name, data });
                }
            } catch (e) {
                break;
            }
        }

        console.log(`[Worker] ffmpeg produced ${chunkFiles.length} chunks`);
        onProgress(0, `Получено ${chunkFiles.length} фрагментов`, 18);

        // Cleanup ffmpeg FS
        try { ffmpeg.FS('unlink', inputName); } catch (e) {}
        for (const f of chunkFiles) {
            try { ffmpeg.FS('unlink', f.name); } catch (e) {}
        }

        for (let i = 0; i < chunkFiles.length; i++) {
            const chunkBlob = new Blob([chunkFiles[i].data], { type: 'audio/webm' });
            const pct = 18 + Math.round(((i + 1) / chunkFiles.length) * 52);
            onProgress(0, `Фрагмент ${i + 1}/${chunkFiles.length} (${(chunkBlob.size / 1024).toFixed(0)} КБ) — распознавание...`, pct);

            const formData = new FormData();
            formData.append('audio', chunkBlob, chunkFiles[i].name);

            const response = await fetch(`${workerUrl}/process?mode=transcribe`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Chunk ${i + 1} failed: ${response.status} ${errText}`);
            }

            const result = await response.json();
            console.log(`[Worker] Chunk ${i + 1} transcript:`, result.transcript);
            fullTranscript += (fullTranscript ? ' ' : '') + result.transcript;

            onProgress(1, `Распознано: ${countWords(fullTranscript)} слов (${i + 1}/${chunkFiles.length})`, pct);
        }
    } else {
        // Short audio — send directly
        onProgress(0, 'Распознавание речи...', 10);

        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');

        const response = await fetch(`${workerUrl}/process?mode=transcribe`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Transcribe failed: ${response.status} ${errText}`);
        }

        const result = await response.json();
        fullTranscript = result.transcript;
    }

    console.log(`[Worker] Full transcript (${countWords(fullTranscript)} words):`, fullTranscript);
    onProgress(1, `Речь распознана (${countWords(fullTranscript)} слов)`, 70);
    onProgress(2, 'Генерация истории болезни...', 75);

    const formData = new FormData();
    formData.append('transcript', fullTranscript);

    const response = await fetch(`${workerUrl}/process?mode=generate`, {
        method: 'POST',
        headers: { 'Accept': 'text/event-stream' },
        body: formData
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Generate failed: ${response.status} ${errText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/event-stream')) {
        return await handleSSEResponse(response, onProgress);
    }

    const data = await response.json();
    onProgress(3, 'Готово', 100);
    return data;
}

let _ffmpegInstance = null;

async function loadFFmpeg(onProgress) {
    if (_ffmpegInstance) return _ffmpegInstance;

    const ffmpeg = FFmpeg.createFFmpeg({
        log: false,
        logger: ({ message }) => {
            console.log('[FFmpeg]', message);
        },
        progress: ({ ratio }) => {
            if (onProgress) onProgress(ratio);
        }
    });

    await ffmpeg.load();
    _ffmpegInstance = ffmpeg;
    return ffmpeg;
}

function countWords(text) {
    return text.split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Handle SSE response from worker for progress tracking.
 */
async function handleSSEResponse(response, onProgress) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;
    let sseError = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                try {
                    const event = JSON.parse(line.slice(6));

                    if (event.type === 'progress') {
                        console.log(`[SSE] step=${event.step} ${event.detail} ${event.percent}%`);
                        if (event.transcript) console.log('[SSE] Transcript:', event.transcript);
                        onProgress(event.step, event.detail, event.percent);
                    } else if (event.type === 'result') {
                        console.log('[SSE] Got result:', event.data);
                        result = event.data;
                    } else if (event.type === 'error') {
                        console.error('[SSE] Server error:', event.message);
                        if (event.rawContent) {
                            console.log('[SSE] Raw LLM response:\n', event.rawContent);
                        }
                        sseError = event.message;
                    }
                } catch (e) {
                    if (e.message !== 'Unexpected end of JSON input') {
                        console.warn('[SSE] Parse error:', e, 'line:', line);
                    }
                }
            }
        }
    }

    if (sseError) {
        throw new Error(sseError);
    }

    return result;
}
