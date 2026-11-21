// Chimera — генерация в правой колонке: стиль, формат, «Сгенерировать превью»,
// большая картинка с кнопками и галерея «Мои превью».

import { getSettings, saveSettings, escapeHtml, TOAST_TITLE } from './store.js';
import {
    SIZE_LABELS, NAI_SIZES, isGenerating, cancelGeneration, keyMissing, generatePreview,
    findPreview, deletePreview, downloadPreview, modelLabel,
} from './gen.js';
import { setLauncherBusy } from './launcher.js';
import { toast } from './notice.js';
import { renderPanel } from './panel.js';

let root = null;
let getBuilt = () => null;
let retrying = false;
let galleryOpen = false;

function windowOpen() {
    return Boolean(document.querySelector('#chm-overlay.chm-open'));
}

// ---------- Разметка ----------

function styleOptions() {
    const s = getSettings();
    return `<option value="">без стиля</option>`
        + s.styles.map((x) => `<option value="${escapeHtml(x.id)}" ${x.id === s.activeStyleId ? 'selected' : ''}>${escapeHtml(x.name || 'Без названия')}</option>`).join('');
}

function metaLine(p) {
    const who = p.provider === 'novelai' ? `NovelAI ${modelLabel(p.model)}` : 'Наистера';
    const dims = NAI_SIZES[p.size] ? `${NAI_SIZES[p.size].width}×${NAI_SIZES[p.size].height}` : '';
    const style = p.styleName ? `стиль «${p.styleName}»` : 'без стиля';
    const seed = p.seed !== null && p.seed !== undefined ? `seed ${p.seed}` : '';
    return [who, p.provider === 'novelai' ? dims : SIZE_LABELS[p.size], style, seed].filter(Boolean).join(' · ');
}

function currentHtml() {
    const s = getSettings();
    const p = findPreview(s.currentPreviewId);
    if (!p) return '';
    return `
        <div class="chm-shot" data-id="${escapeHtml(p.id)}">
            <button type="button" class="chm-shot-img" title="Открыть крупно"><img src="${escapeHtml(p.path)}" alt="превью" loading="lazy"></button>
            <div class="chm-shot-meta">${escapeHtml(metaLine(p))}</div>
            <div class="chm-shot-btns">
                <button type="button" class="chm-btn" data-dl="png"><i class="fa-solid fa-download"></i> PNG</button>
                <button type="button" class="chm-btn" data-dl="webp"><i class="fa-solid fa-download"></i> WEBP</button>
                <button type="button" class="chm-btn chm-shot-copy" title="Скопировать промт, по которому нарисовано (со стилем)"><i class="fa-regular fa-copy"></i> Промт</button>
                <button type="button" class="chm-btn chm-shot-del" title="Удалить превью и файл"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>`;
}

function galleryHtml() {
    const s = getSettings();
    if (!s.previews.length) return '';
    return `
        <details class="chm-fold chm-gallery"${galleryOpen ? ' open' : ''}>
            <summary class="chm-mono-label">мои превью · ${s.previews.length}</summary>
            <div class="chm-thumbs">
                ${s.previews.map((p) => `<button type="button" class="chm-thumb${p.id === s.currentPreviewId ? ' chm-active' : ''}" data-id="${escapeHtml(p.id)}" title="${escapeHtml(new Date(p.createdAt).toLocaleString())}"><img src="${escapeHtml(p.path)}" alt="" loading="lazy"></button>`).join('')}
            </div>
        </details>`;
}

function buttonHtml() {
    if (isGenerating()) {
        return `
            <div class="chm-gen-busy">
                <button type="button" class="chm-gen-btn" disabled><i class="fa-solid fa-spinner fa-spin"></i> ${retrying ? 'Провайдер занят — повторяю…' : 'Рисую…'}</button>
                <button type="button" class="chm-btn chm-gen-cancel" title="Отменить"><i class="fa-solid fa-xmark"></i></button>
            </div>`;
    }
    return '<button type="button" class="chm-gen-btn"><i class="fa-solid fa-wand-magic-sparkles"></i> Сгенерировать превью</button>';
}

function html() {
    const s = getSettings();
    return `
        <div class="chm-gen-controls">
            <label class="chm-gen-style">
                <span class="chm-mono-label">стиль</span>
                <select class="text_pole chm-style-select">${styleOptions()}</select>
            </label>
            <div class="chm-seg chm-size-seg" role="radiogroup" aria-label="Формат">
                ${Object.entries(SIZE_LABELS).map(([k, label]) => `<button type="button" class="chm-seg-btn${s.size === k ? ' chm-active' : ''}" data-size="${k}">${label}</button>`).join('')}
            </div>
        </div>
        <div class="chm-gen-btnwrap">${buttonHtml()}</div>
        <div class="chm-gen-current">${currentHtml()}</div>
        <div class="chm-gen-gallery">${galleryHtml()}</div>`;
}

export function renderPreview() {
    if (!root) return;
    const g = root.querySelector('.chm-gallery');
    if (g) galleryOpen = g.open;
    root.innerHTML = html();
}

/** Только выбор стиля (после правки стилей в настройках). */
export function refreshStyleSelect() {
    const sel = root?.querySelector('.chm-style-select');
    if (sel) sel.innerHTML = styleOptions();
}

// ---------- Крупный просмотр ----------

export function isLightboxOpen() {
    return Boolean(document.querySelector('#chm-overlay .chm-lightbox'));
}

export function closeLightbox() {
    document.querySelector('#chm-overlay .chm-lightbox')?.remove();
}

function openLightbox(path) {
    const win = document.querySelector('#chm-overlay .chm-window');
    if (!win) return;
    closeLightbox();
    const el = document.createElement('div');
    el.className = 'chm-lightbox';
    el.innerHTML = `<img src="${escapeHtml(path)}" alt="превью"><button type="button" class="chm-icon-btn chm-lightbox-x" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>`;
    el.addEventListener('click', closeLightbox);
    win.appendChild(el);
}

// ---------- Генерация ----------

async function run() {
    const missing = keyMissing();
    if (missing) {
        toast(missing, 4500);
        return;
    }
    const built = getBuilt();
    if (!built?.count) {
        toast('Сначала выбери теги — рисовать пока нечего.');
        return;
    }
    retrying = false;
    setLauncherBusy(true);
    const promise = generatePreview(built, {
        onRetry: (v) => {
            retrying = v;
            renderPreview();
        },
        notify: (text) => toast(text, 8000),
    });
    renderPreview();
    try {
        await promise;
        if (!windowOpen()) window.toastr?.success('Превью готово — открой Химеру.', TOAST_TITLE, { timeOut: 4000 });
    } catch (error) {
        if (error?.name !== 'AbortError') {
            console.warn('[Chimera] Генерация упала:', error);
            const who = getSettings().provider === 'naistera' ? 'Наистера' : 'NovelAI';
            const text = `${who}: ${String(error?.message || error).slice(0, 220)}`;
            if (windowOpen()) toast(text, 9000);
            else window.toastr?.error(text, TOAST_TITLE, { timeOut: 9000 });
        }
    } finally {
        retrying = false;
        setLauncherBusy(false);
        renderPreview();
    }
}

// ---------- События ----------

async function onClick(e) {
    const s = getSettings();
    if (e.target.closest('.chm-gen-cancel')) {
        cancelGeneration();
        return;
    }
    if (e.target.closest('.chm-gen-btn')) {
        if (!isGenerating()) run();
        return;
    }
    const size = e.target.closest('[data-size]');
    if (size) {
        s.size = size.dataset.size;
        saveSettings();
        root.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('chm-active', b === size));
        return;
    }
    const thumb = e.target.closest('.chm-thumb');
    if (thumb) {
        s.currentPreviewId = thumb.dataset.id;
        saveSettings();
        renderPreview();
        return;
    }
    const shot = e.target.closest('.chm-shot');
    if (!shot) return;
    const p = findPreview(shot.dataset.id);
    if (!p) return;
    if (e.target.closest('.chm-shot-img')) {
        openLightbox(p.path);
        return;
    }
    const dl = e.target.closest('[data-dl]');
    if (dl) {
        try {
            await downloadPreview(p, dl.dataset.dl);
        } catch (error) {
            toast(`Не скачалось: ${error?.message || error}`, 5000);
        }
        return;
    }
    if (e.target.closest('.chm-shot-copy')) {
        try {
            await navigator.clipboard.writeText(p.prompt);
            toast('Промт этого превью скопирован');
        } catch {
            toast('Браузер не дал скопировать');
        }
        return;
    }
    const del = e.target.closest('.chm-shot-del');
    if (del) {
        if (del.dataset.confirm !== '1') {
            del.dataset.confirm = '1';
            del.classList.add('chm-danger');
            del.innerHTML = '<i class="fa-solid fa-trash"></i> Точно?';
            setTimeout(() => {
                if (!del.isConnected) return;
                del.dataset.confirm = '';
                del.classList.remove('chm-danger');
                del.innerHTML = '<i class="fa-solid fa-trash"></i>';
            }, 3000);
            return;
        }
        const gone = await deletePreview(p.id);
        renderPreview();
        toast(gone ? 'Превью удалено вместе с файлом' : 'Из списка убрала, но файл на сервере остался — его можно удалить в папке user/images/Chimera', gone ? 2600 : 6000);
    }
}

function onChange(e) {
    const sel = e.target.closest('.chm-style-select');
    if (!sel) return;
    getSettings().activeStyleId = sel.value;
    saveSettings();
    renderPanel();   // заметка «у стиля свой негатив»
}

/**
 * @param {HTMLElement} el — контейнер в правой колонке
 * @param {() => object} built — актуальный результат buildPrompt
 */
export function initPreview(el, built) {
    root = el;
    getBuilt = built;
    renderPreview();
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
}
