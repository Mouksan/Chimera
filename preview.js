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
import { loadedChar, setCover } from './characters.js';
import { sceneModeOn } from './scene.js';

let root = null;
let getBuilt = () => null;
let retrying = false;
let galleryOpen = false;
let filterCharId = null;     // фильтр галереи: только картинки этого персонажа

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
                ${coverBtn(p)}
                <button type="button" class="chm-btn chm-shot-del" title="Удалить превью и файл"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>`;
}

function coverBtn(p) {
    const c = loadedChar();
    if (!c || sceneModeOn()) return '';   // кадр сцены не делаем обложкой персонажа
    const isCover = c.coverId === p.id;
    return `<button type="button" class="chm-btn chm-shot-cover${isCover ? ' chm-active' : ''}" title="Обложка для «${escapeHtml(c.name)}» в «Моих персонажах»"><i class="fa-solid fa-image-portrait"></i> ${isCover ? 'Обложка' : 'Сделать обложкой'}</button>`;
}

function charName(id) {
    return getSettings().characters.find((c) => c.id === id)?.name || '';
}

/** «5 панелей» для подписи комикса в галерее. */
function comicPanels(n) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return `${n} панель`;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} панели`;
    return `${n} панелей`;
}

function galleryHtml() {
    const s = getSettings();
    if (!s.previews.length) return '';
    // Фильтр по персонажу, которого уже удалили, сам снимается
    if (filterCharId && !charName(filterCharId)) filterCharId = null;
    const c = loadedChar();
    const list = filterCharId ? s.previews.filter((p) => p.charIds?.includes(filterCharId)) : s.previews;
    let chip = '';
    if (filterCharId && filterCharId !== c?.id) {
        chip = `<div class="chm-gallery-filter"><button type="button" class="chm-chip chm-only-char chm-active" title="Показать все превью">только «${escapeHtml(charName(filterCharId))}» <i class="fa-solid fa-xmark"></i></button></div>`;
    } else if (c) {
        chip = `<div class="chm-gallery-filter"><button type="button" class="chm-chip chm-only-char${filterCharId ? ' chm-active' : ''}">только «${escapeHtml(c.name)}»</button></div>`;
    }
    return `
        <details class="chm-fold chm-gallery"${galleryOpen ? ' open' : ''}>
            <summary class="chm-mono-label">мои превью · ${s.previews.length}</summary>
            ${chip}
            ${list.length ? '' : '<div class="chm-prompt-empty">// с этим персонажем ещё ничего не рисовали</div>'}
            <div class="chm-thumbs">
                ${list.map((p) => `<button type="button" class="chm-thumb${p.id === s.currentPreviewId ? ' chm-active' : ''}" data-id="${escapeHtml(p.id)}" title="${escapeHtml((p.scene?.comic ? `комикс · ${comicPanels(p.scene.comic)} · ` : '') + new Date(p.createdAt).toLocaleString())}"><img src="${escapeHtml(p.path)}" alt="" loading="lazy"></button>`).join('')}
            </div>
        </details>`;
}

/** Открыть галерею с фильтром по персонажу (из «Моих персонажей»). */
export function showCharGallery(id) {
    filterCharId = id || null;
    renderPreview();
    const g = root?.querySelector('.chm-gallery');
    if (g) g.open = true;
    galleryOpen = true;
    const scroller = root?.closest('.chm-panel');
    if (!g || !scroller) return;
    requestAnimationFrame(() => {
        const delta = g.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
        scroller.scrollTop += delta;
    });
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

function bindListHtml(p) {
    const chars = getSettings().characters;
    if (!chars.length) return '<div class="chm-prompt-empty">// персонажей пока нет</div>';
    return chars.map((c) => `
        <label class="chm-bind-item">
            <input type="checkbox" data-bind="${escapeHtml(c.id)}" ${p.charIds?.includes(c.id) ? 'checked' : ''}>
            <span class="chm-bind-name">${escapeHtml(c.name)}</span>
        </label>`).join('');
}

function openLightbox(p) {
    const win = document.querySelector('#chm-overlay .chm-window');
    if (!win) return;
    closeLightbox();
    const el = document.createElement('div');
    el.className = 'chm-lightbox';
    el.dataset.id = p.id;
    el.innerHTML = `
        <img src="${escapeHtml(p.path)}" alt="превью">
        <button type="button" class="chm-icon-btn chm-lightbox-x" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
        <div class="chm-lightbox-bar">
            <button type="button" class="chm-btn chm-bind-btn" title="К каким персонажам относится картинка"><i class="fa-solid fa-user-tag"></i> Персонажи…</button>
            <div class="chm-bind-pop" hidden>
                <div class="chm-mono-label">чья картинка</div>
                <div class="chm-bind-list">${bindListHtml(p)}</div>
            </div>
        </div>`;
    el.addEventListener('click', (e) => {
        if (e.target.closest('.chm-bind-btn')) {
            const pop = el.querySelector('.chm-bind-pop');
            pop.hidden = !pop.hidden;
            return;
        }
        if (e.target.closest('.chm-lightbox-bar')) return;
        closeLightbox();
    });
    el.addEventListener('change', (e) => {
        const box = e.target.closest('[data-bind]');
        if (!box) return;
        toggleBinding(p.id, box.dataset.bind, box.checked);
    });
    win.appendChild(el);
}

/** Привязать картинку к персонажу или отвязать от него. */
function toggleBinding(previewId, charId, on) {
    const s = getSettings();
    const p = findPreview(previewId);
    if (!p) return;
    const ids = new Set(p.charIds || []);
    if (on) ids.add(charId);
    else ids.delete(charId);
    p.charIds = [...ids];
    // Отвязали обложку — персонаж возвращается к «последней картинке»
    const c = s.characters.find((x) => x.id === charId);
    if (!on && c?.coverId === previewId) c.coverId = null;
    saveSettings();
    renderPreview();
}

// ---------- Генерация ----------

async function run() {
    const missing = keyMissing();
    if (missing) {
        toast(missing, 4500);
        return;
    }
    const built = getBuilt();
    if (!built?.count && !built?.own?.length) {
        toast(sceneModeOn() ? 'Сначала выбери позу — рисовать пока нечего.' : 'Сначала выбери теги — рисовать пока нечего.');
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
    if (e.target.closest('.chm-only-char')) {
        const c = loadedChar();
        filterCharId = filterCharId ? null : (c?.id || null);
        renderPreview();
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
        openLightbox(p);
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
    if (e.target.closest('.chm-shot-cover')) {
        if (setCover(p.id)) {
            renderPreview();
            toast(`Обложка «${loadedChar()?.name}» обновлена`);
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
