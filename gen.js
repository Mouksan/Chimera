// Chimera — генерация превью: NovelAI напрямую (подписка) или через наистеру.
// Почти дословный порт из Комы (index.js: «Рисование» и «NovelAI напрямую»):
// прямой запрос в image.novelai.net с v4_prompt, запасной путь через таверну,
// zip → png, наистера с повторами на 429/5xx, сохранение в /user/images/Chimera/.
// Тексты ошибок провайдеров оставлены как пришли (по-английски) — их удобно гуглить.

import { ctx, getSettings, saveSettings, makeId } from './store.js';

const LOG = '[Chimera]';
export const FOLDER = 'Chimera';

// ---------- NovelAI ----------

const NAI_HOST = 'https://image.novelai.net';
export const NAI_MODELS = [
    { id: 'nai-diffusion-5-full', label: 'V5 Full' },
    { id: 'nai-diffusion-5-curated', label: 'V5 Curated' },
    { id: 'nai-diffusion-4-5-full', label: 'V4.5 Full' },
];
// Только бесплатные размеры Opus
export const NAI_SIZES = {
    portrait: { width: 832, height: 1216 },
    square: { width: 1024, height: 1024 },
    landscape: { width: 1216, height: 832 },
};
export const SIZE_LABELS = { portrait: 'Портрет', square: 'Квадрат', landscape: 'Пейзаж' };
const NAI_TIERS = ['Paper', 'Tablet', 'Scroll', 'Opus'];

export const NAI_SAMPLERS = [
    { id: 'k_euler_ancestral', label: 'Euler Ancestral (k_euler_ancestral)' },
    { id: 'k_euler', label: 'Euler (k_euler)' },
    { id: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral (k_dpmpp_2s_ancestral)' },
    { id: 'k_dpmpp_2m_sde', label: 'DPM++ 2M SDE (k_dpmpp_2m_sde)' },
    { id: 'k_dpmpp_2m', label: 'DPM++ 2M (k_dpmpp_2m)' },
    { id: 'k_dpmpp_sde', label: 'DPM++ SDE (k_dpmpp_sde)' },
];
// Native не даём: на V4.5 и V5 он всё равно превращается в Karras
export const NAI_SCHEDULES = [
    { id: 'karras', label: 'Karras' },
    { id: 'exponential', label: 'Exponential' },
    { id: 'polyexponential', label: 'Polyexponential' },
];
export const NAI_FINE_DEFAULTS = Object.freeze({ sampler: 'k_euler_ancestral', schedule: 'karras', steps: 28, scale: 5, rescale: 0 });
// Потолок шагов: больше 28 NovelAI берёт анласы даже на Opus
export const NAI_FINE_RANGES = { steps: [1, 28], scale: [1, 10], rescale: [0, 1] };

export function normalizeFine(fine) {
    const out = { ...NAI_FINE_DEFAULTS };
    if (!fine || typeof fine !== 'object') return out;
    if (NAI_SAMPLERS.some((x) => x.id === fine.sampler)) out.sampler = fine.sampler;
    if (NAI_SCHEDULES.some((x) => x.id === fine.schedule)) out.schedule = fine.schedule;
    for (const key of ['steps', 'scale', 'rescale']) {
        const value = Number(fine[key]);
        if (!Number.isFinite(value)) continue;
        const [min, max] = NAI_FINE_RANGES[key];
        out[key] = Math.min(max, Math.max(min, key === 'steps' ? Math.round(value) : value));
    }
    return out;
}

function effectiveFine(style) {
    if (style?.fineOn) return normalizeFine(style.fine);
    return normalizeFine(getSettings().naiFine);
}

export function modelLabel(id) {
    return NAI_MODELS.find((m) => m.id === id)?.label || id;
}

// Заблокировал ли браузер прямые запросы (CORS). Помним до перезагрузки.
let naiDirectBlocked = false;
let naiFallbackAnnounced = false;

/** Проверка ключа NovelAI: данные подписки, генерацию не тратит. → { ok, text } */
export async function checkNovelAiKey() {
    const key = String(getSettings().naiKey || '').trim();
    if (!key) return { ok: false, text: 'Не задан ключ NovelAI' };
    let response;
    try {
        response = await fetch(`${NAI_HOST}/user/subscription`, { method: 'GET', headers: { Authorization: `Bearer ${key}` } });
    } catch (error) {
        console.warn(LOG, 'NovelAI из браузера недоступен:', error);
        naiDirectBlocked = true;
        return { ok: false, text: 'NovelAI не пускает запросы из браузера — буду рисовать через таверну. Положи ключ ещё и в Подключения к API → NovelAI' };
    }
    if (response.status === 401) return { ok: false, text: 'Ключ не подошёл (401)' };
    if (!response.ok) return { ok: false, text: `NovelAI не ответил (${response.status})` };
    naiDirectBlocked = false;
    const data = await response.json().catch(() => ({}));
    const tier = NAI_TIERS[data?.tier] || `уровень ${data?.tier ?? '?'}`;
    const charge = Number.isFinite(data?.usage?.percent) ? `, заряд V5: ${data.usage.percent}%` : '';
    return { ok: true, text: `Ключ рабочий, ${tier}${charge}` };
}

/** Достаёт первый .png из zip. Поддерживает хранение без сжатия и deflate. */
async function extractPngFromZip(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('NovelAI response is not a zip');
    const count = view.getUint16(eocd + 10, true);
    let ptr = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    for (let n = 0; n < count; n++) {
        if (view.getUint32(ptr, true) !== 0x02014b50) break;
        const method = view.getUint16(ptr + 10, true);
        const compressedSize = view.getUint32(ptr + 20, true);
        const nameLength = view.getUint16(ptr + 28, true);
        const extraLength = view.getUint16(ptr + 30, true);
        const commentLength = view.getUint16(ptr + 32, true);
        const localOffset = view.getUint32(ptr + 42, true);
        const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLength));
        ptr += 46 + nameLength + extraLength + commentLength;
        if (!/\.png$/i.test(name)) continue;
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const start = localOffset + 30 + localNameLength + localExtraLength;
        const data = bytes.subarray(start, start + compressedSize);
        if (method === 0) return data;
        if (method === 8) {
            const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            return new Uint8Array(await new Response(stream).arrayBuffer());
        }
        throw new Error(`unknown zip compression (${method})`);
    }
    throw new Error('no image in NovelAI response');
}

function bytesToDataUrl(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return `data:image/png;base64,${btoa(binary)}`;
}

function httpError(message, status) {
    const error = new Error(message);
    error.status = status;
    return error;
}

async function requestNovelAiDirect({ prompt, negative, model, fine, width, height, seed }, signal) {
    const parameters = {
        params_version: 4,
        width, height,
        scale: fine.scale,
        sampler: fine.sampler,
        steps: fine.steps,
        seed,
        n_samples: 1,
        ucPreset: 3,
        qualityToggle: false,
        sm: false,
        sm_dyn: false,
        dynamic_thresholding: false,
        controlnet_strength: 1,
        legacy: false,
        add_original_image: false,
        cfg_rescale: fine.rescale,
        noise_schedule: fine.schedule,
        legacy_v3_extend: false,
        uncond_scale: 1,
        negative_prompt: negative,
        prompt,
        reference_image_multiple: [],
        reference_information_extracted_multiple: [],
        reference_strength_multiple: [],
        extra_noise_seed: seed,
        characterPrompts: [],
        v4_prompt: { use_coords: false, use_order: true, caption: { base_caption: prompt, char_captions: [] } },
        v4_negative_prompt: { use_coords: false, use_order: false, caption: { base_caption: negative, char_captions: [] } },
    };
    const response = await fetch(`${NAI_HOST}/ai/generate-image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${String(getSettings().naiKey || '').trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: prompt, model, action: 'generate', parameters }),
        signal,
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw httpError(`${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`, response.status);
    }
    return bytesToDataUrl(await extractPngFromZip(await response.arrayBuffer()));
}

/** Через прокси таверны: ключ берётся из Подключений к API → NovelAI. */
async function requestNovelAiViaTavern({ prompt, negative, model, fine, width, height, seed }, signal) {
    const response = await fetch('/api/novelai/generate-image', {
        method: 'POST',
        headers: ctx().getRequestHeaders(),
        body: JSON.stringify({
            prompt, negative_prompt: negative, model, width, height,
            steps: fine.steps, scale: fine.scale, sampler: fine.sampler, scheduler: fine.schedule, seed,
        }),
        signal,
    });
    if (!response.ok) throw httpError(`tavern proxy ${response.status} — check the key in API Connections → NovelAI`, response.status);
    const base64 = (await response.text()).trim();
    if (!base64) throw httpError('tavern proxy returned an empty response');
    return `data:image/png;base64,${base64}`;
}

async function requestNovelAi(params, signal, notify) {
    if (!naiDirectBlocked) {
        try {
            return { dataUrl: await requestNovelAiDirect(params, signal), route: 'direct' };
        } catch (error) {
            // TypeError у fetch — это CORS или сеть. Остальное — ответ самого NovelAI
            if (error?.name !== 'TypeError') throw error;
            console.warn(LOG, 'Прямой запрос в NovelAI не прошёл, иду через таверну:', error);
            naiDirectBlocked = true;
        }
    }
    if (!naiFallbackAnnounced) {
        naiFallbackAnnounced = true;
        notify?.('NovelAI не пускает запросы из браузера — рисую через таверну. Положи ключ ещё и в Подключения к API → NovelAI');
    }
    return { dataUrl: await requestNovelAiViaTavern(params, signal), route: 'tavern' };
}

// ---------- Наистера ----------

const NAISTERA_DEFAULT_ENDPOINT = 'https://naistera.org';
const NAISTERA_MODEL = 'novelai';
const DRAW_TIMEOUT_MS = 180000;
const DRAW_RETRY_DELAYS = [5000, 15000, 30000];
export const RATIO_CHOICES = ['16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16', '21:9'];

function naisteraBase() {
    const raw = String(getSettings().naisteraEndpoint || '').trim() || NAISTERA_DEFAULT_ENDPOINT;
    return raw.replace(/\/api\/(generate|models)\/?$/i, '').replace(/\/+$/, '');
}

/** Проверка ключа наистеры: каталог моделей под этим ключом. → { ok, text } */
export async function checkNaisteraKey() {
    const key = String(getSettings().naisteraKey || '').trim();
    if (!key) return { ok: false, text: 'Не задан ключ наистеры' };
    try {
        const response = await fetch(`${naisteraBase()}/api/models`, { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${key}` } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (payload?.authenticated === false) return { ok: false, text: 'Ключ не подошёл' };
        const models = Array.isArray(payload?.models) ? payload.models : [];
        return models.some((m) => /novel/i.test(`${m?.id || ''} ${m?.name || ''}`))
            ? { ok: true, text: 'Ключ рабочий, NovelAI доступен' }
            : { ok: false, text: 'Ключ рабочий, но NovelAI в тарифе нет' };
    } catch (error) {
        console.warn(LOG, 'Проверка ключа наистеры упала:', error);
        return { ok: false, text: `Ключ не подошёл (${error?.message || error})` };
    }
}

function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
}

async function requestNaistera(body, signal) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), DRAW_TIMEOUT_MS);
    const onAbort = () => timeout.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
        const response = await fetch(`${naisteraBase()}/api/generate`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${String(getSettings().naisteraKey || '').trim()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: timeout.signal,
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw httpError(`${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`, response.status);
        }
        const result = await response.json();
        const image = result?.data_url || result?.url || result?.image;
        if (!image) throw new Error('no image in response');
        return image;
    } catch (error) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (timeout.signal.aborted && !error.status) throw new Error('no response in 3 minutes');
        throw error;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
}

async function toDataUrl(image, signal) {
    if (/^data:image\//i.test(image)) return image;
    const response = await fetch(image, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`image download failed (${response.status})`);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('image read failed'));
        reader.readAsDataURL(blob);
    });
}

// ---------- Файлы в таверне ----------

/** Сохраняет картинку в /user/images/Chimera/. → путь */
async function uploadImage(dataUrl) {
    const match = String(dataUrl).match(/^data:image\/([\w+.-]+);base64,(.+)$/);
    if (!match) throw new Error('unexpected image format');
    const format = match[1] === 'jpeg' ? 'jpg' : match[1];
    const filename = `chm_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const response = await fetch('/api/images/upload', {
        method: 'POST',
        headers: ctx().getRequestHeaders(),
        body: JSON.stringify({ image: match[2], format, ch_name: FOLDER, filename }),
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error || `save failed (${response.status})`);
    }
    const result = await response.json();
    if (!result?.path) throw new Error('tavern returned no file path');
    return result.path;
}

/** Удалить файл с сервера. → true, если таверна подтвердила. */
async function deleteImageFile(path) {
    try {
        const response = await fetch('/api/images/delete', {
            method: 'POST',
            headers: ctx().getRequestHeaders(),
            body: JSON.stringify({ path }),
        });
        return response.ok;
    } catch {
        return false;
    }
}

// ---------- Стиль ----------

function normTag(tag) {
    return String(tag || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Стиль в начало, дальше промт без тегов, которые уже есть в стиле (как в Коме). */
export function composeWithStyle(prompt, style) {
    const styleTags = String(style?.tags || '').trim().replace(/[\s,]+$/, '');
    if (!styleTags) return String(prompt || '').trim();
    const inStyle = new Set(styleTags.split(',').map(normTag).filter(Boolean));
    const rest = String(prompt || '').split(',').map((t) => t.trim()).filter((t) => t && !inStyle.has(normTag(t)));
    return rest.length ? `${styleTags}, ${rest.join(', ')}` : styleTags;
}

export function activeStyle() {
    const s = getSettings();
    return s.styles.find((x) => x.id === s.activeStyleId) || null;
}

// ---------- Генерация ----------

let job = null;

export function isGenerating() {
    return Boolean(job);
}

export function cancelGeneration() {
    job?.controller.abort();
}

export function keyMissing() {
    const s = getSettings();
    if (s.provider === 'naistera') return String(s.naisteraKey || '').trim() ? '' : 'Не задан ключ наистеры — он в настройках под шестерёнкой, «Рисование».';
    return String(s.naiKey || '').trim() ? '' : 'Не задан ключ NovelAI — он в настройках под шестерёнкой, «Рисование».';
}

/**
 * Нарисовать превью по готовому промту.
 * @param {{ positive: string, negative: string }} built — из buildPrompt
 * @param {{ onRetry?: Function, notify?: Function }} hooks
 * @returns {Promise<object>} запись превью (уже в settings.previews)
 */
export async function generatePreview(built, hooks = {}) {
    if (job) throw new Error('already generating');
    const s = getSettings();
    const provider = s.provider === 'naistera' ? 'naistera' : 'novelai';
    const style = activeStyle();
    const prompt = composeWithStyle(built.positive, style);
    // Негатив стиля, если заполнен, заменяет общий (как в Коме); из него тоже выкидываем теги плюса
    const styleNeg = String(style?.negative || '').trim();
    const plus = new Set(prompt.split(',').map(normTag));
    const negative = styleNeg
        ? styleNeg.split(',').map((t) => t.trim()).filter((t) => t && !plus.has(normTag(t))).join(', ')
        : built.negative;
    const size = NAI_SIZES[s.size] ? s.size : 'portrait';
    const seed = Math.floor(Math.random() * 4294967295);
    const model = NAI_MODELS.some((m) => m.id === s.naiModel) ? s.naiModel : NAI_MODELS[0].id;

    job = { controller: new AbortController() };
    const signal = job.controller.signal;
    try {
        let imageUrl;
        let route = 'naistera';
        if (provider === 'novelai') {
            const dims = NAI_SIZES[size];
            const result = await requestNovelAi({ prompt, negative, model, fine: effectiveFine(style), width: dims.width, height: dims.height, seed }, signal, hooks.notify);
            imageUrl = result.dataUrl;
            route = result.route;
        } else {
            const body = { prompt, aspect_ratio: s.aspectMap[size] || '2:3', model: NAISTERA_MODEL };
            if (negative) body.negative_prompt = negative;
            for (let attempt = 0; ; attempt++) {
                try {
                    imageUrl = await requestNaistera(body, signal);
                    break;
                } catch (error) {
                    const retryable = error?.name !== 'AbortError'
                        && (error?.status === 429 || (error?.status >= 500 && error?.status < 600) || error?.name === 'TypeError');
                    if (!retryable || attempt >= DRAW_RETRY_DELAYS.length) throw error;
                    hooks.onRetry?.(true);
                    await sleep(DRAW_RETRY_DELAYS[attempt], signal);
                    hooks.onRetry?.(false);
                }
            }
        }
        const path = await uploadImage(await toDataUrl(imageUrl, signal));
        const entry = {
            id: makeId(),
            path,
            prompt,
            negative,
            styleName: style?.name || '',
            size,
            provider,
            model: provider === 'novelai' ? model : NAISTERA_MODEL,
            route,
            seed: provider === 'novelai' ? seed : null,
            charId: s.loadedCharId || null,   // чей это превью (для обложки и фильтра галереи)
            createdAt: Date.now(),
        };
        s.previews.unshift(entry);
        s.currentPreviewId = entry.id;
        saveSettings();
        return entry;
    } finally {
        job = null;
    }
}

export function findPreview(id) {
    return getSettings().previews.find((p) => p.id === id) || null;
}

/** Удалить превью: файл с сервера и запись из списка. → удалился ли файл */
export async function deletePreview(id) {
    const s = getSettings();
    const entry = findPreview(id);
    if (!entry) return false;
    const fileGone = await deleteImageFile(entry.path);
    s.previews = s.previews.filter((p) => p.id !== id);
    if (s.currentPreviewId === id) s.currentPreviewId = s.previews[0]?.id || null;
    saveSettings();
    return fileGone;
}

// ---------- Скачивание ----------

function stamp(entry) {
    return new Date(entry.createdAt || Date.now()).toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Скачать превью как PNG или WEBP. */
export async function downloadPreview(entry, format = 'png') {
    const response = await fetch(entry.path);
    if (!response.ok) throw new Error(`file not found (${response.status})`);
    const blob = await response.blob();
    const name = `chimera_${stamp(entry)}`;
    if (format === 'png' && blob.type === 'image/png') {
        saveBlob(blob, `${name}.png`);
        return;
    }
    // Перекодировать через canvas
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const type = format === 'webp' ? 'image/webp' : 'image/png';
    const out = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.92));
    if (!out) throw new Error('browser could not encode the image');
    saveBlob(out, `${name}.${format === 'webp' ? 'webp' : 'png'}`);
}

// ---------- Импорт из Комы ----------

/** Настройки Комы в этой же таверне (ключ модуля у неё остался sideweaver). */
export function komaSettings() {
    const ext = ctx().extensionSettings || {};
    return ext.sideweaver || ext.koma || null;
}

/** Взять из Комы провайдера, ключи, модель, адрес наистеры и тонкую настройку. → true, если нашлось */
export function copyDrawingFromKoma() {
    const k = komaSettings();
    if (!k) return false;
    const s = getSettings();
    if (k.provider === 'novelai' || k.provider === 'naistera') s.provider = k.provider;
    if (k.naiKey) s.naiKey = String(k.naiKey);
    if (k.naiModel && NAI_MODELS.some((m) => m.id === k.naiModel)) s.naiModel = k.naiModel;
    if (k.naisteraKey) s.naisteraKey = String(k.naisteraKey);
    if (k.naisteraEndpoint !== undefined) s.naisteraEndpoint = String(k.naisteraEndpoint || '');
    if (k.naiFine) s.naiFine = normalizeFine(k.naiFine);
    for (const a of ['portrait', 'square', 'landscape']) {
        if (RATIO_CHOICES.includes(k.aspectMap?.[a])) s.aspectMap[a] = k.aspectMap[a];
    }
    saveSettings();
    return true;
}
