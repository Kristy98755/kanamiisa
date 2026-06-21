/**
 * Cloudflare Worker — Stenographist Backend
 *
 * Handles:
 * 1. Audio upload → Speech-to-text (Whisper via Cloudflare Workers AI or fallback)
 * 2. Text → AI model (Cloudflare Workers AI LLM) → Medical history JSON
 * 3. SSE progress reporting for real-time updates
 *
 * Deploy with: npx wrangler deploy
 *
 * Environment variables (set via wrangler secret or wrangler.toml):
 *   - No secrets needed for free-tier Cloudflare Workers AI
 *
 * KV Namespace (optional, for caching):
 *   - CACHE (binding name)
 *
 * R2 Bucket (optional, for storing audio files):
 *   - AUDIO_BUCKET (binding name)
 */

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: corsHeaders(env)
            });
        }

        // Health / diagnostics
        if (request.method === 'GET' && url.pathname === '/health') {
            return jsonResponse({
                ok: true,
                hasAI: !!env.AI,
                hasGROQ: !!env.GROQ_API_KEY,
                timestamp: new Date().toISOString()
            }, 200, env);
        }

        // Only POST /process is supported
        if (request.method === 'POST' && url.pathname === '/process') {
            return handleProcess(request, env);
        }

        return jsonResponse({ error: 'Not found' }, 404, env);
    }
};

/**
 * Main processing endpoint.
 * Accepts multipart/form-data with 'audio' field.
 * Returns SSE stream with progress events, or JSON result.
 */
async function handleProcess(request, env) {
    const headers = corsHeaders(env);

    try {
        const formData = await request.formData();
        const audioFile = formData.get('audio');

        if (!audioFile) {
            return jsonResponse({ error: 'No audio file provided' }, 400, env);
        }

        // Check if client accepts SSE
        const accept = request.headers.get('accept') || '';
        const useSSE = accept.includes('text/event-stream');

        if (useSSE) {
            return handleProcessSSE(audioFile, env);
        }

        // Fallback: process without progress streaming
        return await processFull(audioFile, env);
    } catch (err) {
        console.error('Process error:', err);
        return jsonResponse({ error: err.message }, 500, env);
    }
}

/**
 * SSE-based processing with real-time progress.
 */
function handleProcessSSE(audioFile, env) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            function sendEvent(data) {
                const payload = `data: ${JSON.stringify(data)}\n\n`;
                controller.enqueue(encoder.encode(payload));
            }

            try {
                // Step 1: Transcribe
                sendEvent({ type: 'progress', step: 0, detail: 'Отправка аудио...', percent: 5 });
                const transcript = await transcribeAudio(audioFile, env);
                sendEvent({ type: 'progress', step: 1, detail: `Речь распознана (${countWords(transcript)} слов)`, percent: 35 });

                // Step 2: Generate medical history
                sendEvent({ type: 'progress', step: 2, detail: 'Анализ текста...', percent: 45 });
                const medicalHistory = await generateMedicalHistory(transcript, env);
                sendEvent({ type: 'progress', step: 3, detail: 'История болезни сформирована', percent: 95 });

                // Step 3: Send result
                sendEvent({ type: 'progress', step: 3, detail: 'Готово', percent: 100 });
                sendEvent({ type: 'result', data: { transcript, medicalHistory } });

            } catch (err) {
                sendEvent({ type: 'error', message: err.message });
            }

            controller.close();
        }
    });

    return new Response(stream, {
        headers: {
            ...headers,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    });
}

/**
 * Non-SSE processing (returns JSON directly).
 */
async function processFull(audioFile, env) {
    const transcript = await transcribeAudio(audioFile, env);
    const medicalHistory = await generateMedicalHistory(transcript, env);
    return jsonResponse({ transcript, medicalHistory }, 200, env);
}

// ============================================================
// Speech-to-Text
// ============================================================

/**
 * Transcribe audio using Cloudflare Workers AI Whisper model.
 * Falls back to a basic error if the model is not available.
 *
 * Models available via Workers AI:
 *   @cf/openai/whisper (speech-to-text)
 *
 * If this model is not available on your plan, you can replace
 * with an external free API (e.g., Deepgram, AssemblyAI free tier).
 */
async function transcribeAudio(audioFile, env) {
    if (!env.AI) {
        throw new Error('Workers AI binding not available');
    }

    const audioBuffer = await audioFile.arrayBuffer();
    const audioArray = [...new Uint8Array(audioBuffer)];

    console.log(`Transcribing: ${audioArray.length} bytes`);

    const result = await Promise.race([
        env.AI.run('@cf/openai/whisper', { audio: audioArray }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Whisper timeout (30s)')), 30000))
    ]);

    console.log('Whisper result:', JSON.stringify(result).slice(0, 200));

    if (result && result.text) {
        return result.text;
    }

    throw new Error('Whisper returned empty result');
}

// ============================================================
// AI Medical History Generation
// ============================================================

/**
 * Generate structured medical history from transcript text.
 * Uses Cloudflare Workers AI LLM.
 *
 * Models available via Workers AI (free tier):
 *   @cf/meta/llama-3.1-8b-instruct
 *   @cf/mistral/mistral-7b-instruct-v0.1
 */
async function generateMedicalHistory(transcript, env) {
    const systemPrompt = `Ты — медицинский ассистент. По givenному тексту записи врача или пациента, создай структурированную историю болезни.

Верни ТОЛЬКО валидный JSON без markdown и комментариев по этой схеме:

{
    "passport": {
        "fio": "ФИО",
        "dob": "Дата рождения",
        "age": "Возраст",
        "gender": "Пол",
        "address": "Адрес",
        "admissionDate": "Дата и время поступления",
        "dischargeDate": "Дата и время выписки (пустая строка если неизвестно)",
        "referredBy": "Кем направлен",
        "department": "Отделение"
    },
    "diagnosis": {
        "admission": "Диагноз при поступлении",
        "main": "Основной клинический диагноз (МКБ-код если можно определить)",
        "complications": "Осложнения",
        "comorbidities": "Сопутствующие заболевания"
    },
    "complaints": "Жалобы при поступлении (свободный текст)",
    "anamnesis": "Анамнез заболевания — история текущей болезни",
    "lifeAnamnesis": {
        "pastDiseases": "Перенесённые заболевания",
        "surgeries": "Операции",
        "traumas": "Травмы",
        "chronicDiseases": "Хронические заболевания",
        "allergies": "Аллергические реакции",
        "badHabits": "Вредные привычки",
        "heredity": "Наследственность"
    },
    "status": {
        "generalState": "Общее состояние",
        "consciousness": "Сознание",
        "position": "Положение",
        "temperature": "Температура",
        "height": "Рост",
        "weight": "Вес",
        "bmi": "ИМТ"
    },
    "skin": {
        "color": "Окраска кожи",
        "rash": "Сыпь",
        "moisture": "Влажность",
        "turgor": "Тургор",
        "mucous": "Состояние слизистых"
    },
    "lymphNodes": "Периферические лимфоузлы",
    "respiratory": {
        "respRate": "ЧДД",
        "nasalBreathing": "Носовое дыхание",
        "percussion": "Перкуторный звук",
        "auscultation": "Аускультативная картина",
        "wheezes": "Хрипы",
        "dyspnea": "Одышка",
        "spo2": "SpO₂"
    },
    "cardiovascular": {
        "bp": "АД",
        "pulse": "Пульс",
        "heartBorders": "Границы сердца",
        "heartTones": "Тоны сердца",
        "murmurs": "Шумы",
        "edema": "Отеки"
    },
    "digestive": {
        "tongue": "Язык",
        "abdomen": "Живот",
        "liver": "Печень",
        "spleen": "Селезенка",
        "stool": "Стул"
    },
    "urinary": {
        "urination": "Мочеиспускание",
        "punchingSymptom": "Симптом поколачивания",
        "urEdema": "Отёки"
    },
    "nervous": {
        "consciousness": "Сознание",
        "orientation": "Ориентация",
        "meningeal": "Менингеальные симптомы",
        "focalSymptoms": "Очаговая симптоматика"
    },
    "labResults": {
        "cbc": "ОАК",
        "urinalysis": "ОАМ",
        "biochemistry": "Биохимия",
        "xray": "Рентгенография",
        "ct": "КТ",
        "ecg": "ЭКГ",
        "otherStudies": "Прочие исследования"
    },
    "diagnosisRationale": "Обоснование диагноза — краткий текст"
}

Правила:
- Если информации по полю нет, поставь пустую строку "" или "не указано"
- Сохраняй медицинскую терминологию
- Будь точным, не добавляй информацию, которой нет в записи
- Пиши на русском языке
- В diagnosisRationale напиши краткое обоснование диагноза на основе имеющихся данных
- Если в записи упоминаются лабораторные значения, вписывай их в labResults
- Если в записи есть данные осмотра (Status praesens), заполняй секцию status, skin, respiratory и т.д. по информации из записи
- Если какие-то подполя секции status praesens не упоминаются, оставь их пустыми`;

    const userPrompt = `Транскрипция медицинской записи:\n\n${transcript}`;

    // Groq API (free tier, OpenAI-compatible)
    if (env.GROQ_API_KEY) {
        try {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.1-8b-instant',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    max_tokens: 4096,
                    temperature: 0.3
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Groq API error ${response.status}: ${errText}`);
            }

            const data = await response.json();
            if (data.choices && data.choices[0]) {
                return parseJSON(data.choices[0].message.content);
            }
        } catch (err) {
            console.warn('Groq LLM failed:', err.message);
        }
    }

    // Workers AI LLM (free tier)
    if (env.AI) {
        try {
            console.log('Calling Workers AI LLM...');
            const response = await Promise.race([
                env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    max_tokens: 4096,
                    temperature: 0.3
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('LLM timeout (60s)')), 60000))
            ]);

            console.log('LLM response:', JSON.stringify(response).slice(0, 300));

            if (response && response.response) {
                return parseJSON(response.response);
            }
        } catch (err) {
            console.warn('Workers AI LLM failed:', err.message);
        }
    }

    throw new Error('AI model not configured. Set GROQ_API_KEY secret or enable Workers AI.');
}

/**
 * Parse JSON from AI response, handling markdown code blocks.
 */
function parseJSON(text) {
    // Strip markdown code block if present
    let cleaned = text.trim();
    if (cleaned.startsWith('```json')) {
        cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
        cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    try {
        return JSON.parse(cleaned);
    } catch (e) {
        // Try to find JSON object in the text
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) {
            return JSON.parse(match[0]);
        }
        throw new Error('Failed to parse AI response as JSON');
    }
}

// ============================================================
// Helpers
// ============================================================

function countWords(text) {
    return text.split(/\s+/).filter(w => w.length > 0).length;
}

function corsHeaders(env) {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept'
    };
}

function jsonResponse(data, status, env) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            ...corsHeaders(env),
            'Content-Type': 'application/json'
        }
    });
}
