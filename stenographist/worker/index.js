export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders() });
        }

        if (request.method === 'GET' && url.pathname === '/health') {
            return jsonResponse({ ok: true }, 200);
        }

        if (request.method === 'POST' && url.pathname === '/process') {
            return handleProcess(request, env);
        }

        return jsonResponse({ error: 'Not found' }, 404);
    }
};

async function handleProcess(request, env) {
    const url = new URL(request.url);
    const mode = url.searchParams.get('mode') || 'full';

    try {
        const formData = await request.formData();
        const audioFile = formData.get('audio');
        const transcriptText = formData.get('transcript');

        const accept = request.headers.get('accept') || '';
        const useSSE = accept.includes('text/event-stream');

        if (mode === 'transcribe') {
            if (!audioFile) return jsonResponse({ error: 'No audio file provided' }, 400);
            const transcript = await transcribeAudio(audioFile, env);
            return jsonResponse({ transcript }, 200);
        }

        if (mode === 'generate') {
            if (!transcriptText) return jsonResponse({ error: 'No transcript provided' }, 400);
            const medicalHistory = await generateMedicalHistory(transcriptText, env);
            return jsonResponse({ transcript: transcriptText, medicalHistory }, 200);
        }

        if (!audioFile) return jsonResponse({ error: 'No audio file provided' }, 400);

        if (useSSE) return handleProcessSSE(audioFile, env);

        return await processFull(audioFile, env);
    } catch (err) {
        return jsonResponse({ error: err.message }, 500);
    }
}

function handleProcessSSE(audioFile, env) {
    const encoder = new TextEncoder();
    const headers = corsHeaders();
    const stream = new ReadableStream({
        async start(controller) {
            function sendEvent(data) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            }

            try {
                sendEvent({ type: 'progress', step: 0, detail: 'Отправка аудио...', percent: 5 });
                const transcript = await transcribeAudio(audioFile, env);
                sendEvent({ type: 'progress', step: 1, detail: 'Речь распознана', percent: 35, transcript });

                sendEvent({ type: 'progress', step: 2, detail: 'Анализ текста...', percent: 45 });
                const medicalHistory = await generateMedicalHistory(transcript, env);
                sendEvent({ type: 'progress', step: 3, detail: 'История болезни сформирована', percent: 95 });

                sendEvent({ type: 'progress', step: 3, detail: 'Готово', percent: 100 });
                sendEvent({ type: 'result', data: { transcript, medicalHistory } });
            } catch (err) {
                sendEvent({ type: 'error', message: err.message });
            }

            controller.close();
        }
    });

    return new Response(stream, {
        headers: { ...headers, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }
    });
}

async function processFull(audioFile, env) {
    const transcript = await transcribeAudio(audioFile, env);
    const medicalHistory = await generateMedicalHistory(transcript, env);
    return jsonResponse({ transcript, medicalHistory }, 200);
}

async function transcribeAudio(audioFile, env) {
    if (!env.AI) throw new Error('Workers AI binding not available');

    const audioBuffer = await audioFile.arrayBuffer();
    const bytes = new Uint8Array(audioBuffer);

    if (!validateAudioBytes(bytes)) {
        throw new Error('Файл не является аудио.');
    }

    let base64 = '';
    for (let i = 0; i < bytes.length; i += 8192) {
        base64 += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    base64 = btoa(base64);

    const result = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
        audio: base64,
        language: 'ru'
    });

    if (result && result.text) return result.text;
    throw new Error('Распознавание не вернуло результат.');
}

function validateAudioBytes(bytes) {
    if (bytes.length < 12) return false;
    if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) return true;
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
    if (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) return true;
    if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return true;
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return true;
    if (bytes.length > 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return true;
    if (bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43) return true;
    return false;
}

async function generateMedicalHistory(transcript, env) {
    const systemPrompt = `Ты — медицинский ассистент. По givenному тексту записи врача или пациента, создай структурированную историю болезни.

Верни ТОЛЬКО валидный JSON без markdown и комментариев по этой схеме:

{
    "passport": { "fio": "ФИО", "dob": "Дата рождения", "age": "Возраст", "gender": "Пол", "address": "Адрес", "admissionDate": "Дата и время поступления", "dischargeDate": "", "referredBy": "Кем направлен", "department": "Отделение" },
    "diagnosis": { "admission": "Диагноз при поступлении", "main": "Основной диагноз (МКБ если можно)", "complications": "Осложнения", "comorbidities": "Сопутствующие заболевания" },
    "complaints": "Жалобы",
    "anamnesis": "Анамнез заболевания",
    "lifeAnamnesis": { "pastDiseases": "Перенесённые заболевания", "surgeries": "Операции", "traumas": "Травмы", "chronicDiseases": "Хронические заболевания", "allergies": "Аллергические реакции", "badHabits": "Вредные привычки", "heredity": "Наследственность" },
    "status": { "generalState": "", "consciousness": "", "position": "", "temperature": "", "height": "", "weight": "", "bmi": "" },
    "skin": { "color": "", "rash": "", "moisture": "", "turgor": "", "mucous": "" },
    "lymphNodes": "",
    "respiratory": { "respRate": "", "nasalBreathing": "", "percussion": "", "auscultation": "", "wheezes": "", "dyspnea": "", "spo2": "" },
    "cardiovascular": { "bp": "", "pulse": "", "heartBorders": "", "heartTones": "", "murmurs": "", "edema": "" },
    "digestive": { "tongue": "", "abdomen": "", "liver": "", "spleen": "", "stool": "" },
    "urinary": { "urination": "", "punchingSymptom": "", "urEdema": "" },
    "nervous": { "consciousness": "", "orientation": "", "meningeal": "", "focalSymptoms": "" },
    "labResults": { "cbc": "", "urinalysis": "", "biochemistry": "", "xray": "", "ct": "", "ecg": "", "otherStudies": "" },
    "diagnosisRationale": "Обоснование диагноза"
}

Правила:
- Если информации нет — пустая строка ""
- Сохраняй медицинскую терминологию
- Не добавляй информацию, которой нет в записи
- Пиши на русском языке`;

    if (!env.OPENROUTER_API_KEY) throw new Error('Сервис недоступен.');

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://kanamiisa.uk',
            'X-Title': 'Stenographist'
        },
        body: JSON.stringify({
            model: 'nvidia/nemotron-3-super-120b-a12b:free',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Транскрипция:\n\n${transcript}` }
            ],
            max_tokens: 8192,
            temperature: 0.3,
            extra_body: { enable_thinking: false }
        })
    });

    if (!response.ok) throw new Error('Ошибка генерации.');

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning;
    if (!text) throw new Error('Пустой ответ модели.');

    return parseJSON(text);
}

function parseJSON(text) {
    if (!text || typeof text !== 'string') throw new Error('Invalid response');

    let cleaned = text.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    try { return JSON.parse(cleaned); } catch (e) {}

    const firstBrace = cleaned.indexOf('{');
    if (firstBrace > 0) {
        try { return JSON.parse(cleaned.slice(firstBrace)); } catch (e) {}
    }

    let lastBrace = -1, depth = 0, end = -1;
    for (let i = cleaned.length - 1; i >= 0; i--) {
        if (cleaned[i] === '}') { if (end === -1) end = i; depth++; }
        else if (cleaned[i] === '{') { depth--; if (depth === 0 && end !== -1) { lastBrace = i; break; } }
    }
    if (lastBrace !== -1 && end !== -1) {
        try { return JSON.parse(cleaned.slice(lastBrace, end + 1)); } catch (e) {}
    }

    throw new Error('Не удалось обработать ответ модели.');
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': 'https://kanamiisa.uk',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept'
    };
}

function jsonResponse(data, status) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
}
