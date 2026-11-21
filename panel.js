// Chimera — правая колонка «Собранный персонаж»:
// тумблеры, промт, негатив, свои теги, копирование и список тегов с весами, цветом, 📌 🚫 ✕.

import { getSettings, saveSettings, escapeHtml, TOAST_TITLE } from './store.js';
import {
    buildPrompt, formatWeight, isPart, isShadeable, isMulti, MULTI_MAX,
    PART_COLORS, SHADES, colorLabel, colorCss,
} from './builder.js';

const W_MIN = 0.5;
const W_MAX = 2;
const W_STEP = 0.05;

const TOGGLES = [
    { key: 'clothing', label: 'одежда', hint: 'Добавляет clothed, fashion — без этого персонаж часто выходит голым' },
    { key: 'otherGender', label: 'чужой пол', hint: 'Показывать теги, несовместимые с выбранным полом. Выключи — они спрячутся и уйдут из сборки. Касается только рас и половых признаков — причёски, хвосты и прочее не трогает' },
    { key: 'weights', label: 'веса', hint: 'Писать веса тегов. Выключи — все теги уйдут без весов, а слайдеры останутся на месте' },
    { key: 'genericTags', label: 'общие теги', hint: 'К выбранному виду сам добавляется общий тег: к кошачьим ушам — animal ears, к драконьим рогам — horns. Модель тогда точно рисует то, что нужно. Снять его руками можно всегда' },
    { key: 'colorOneTag', label: 'цвет одним тегом', hint: 'Цвет ушей, рогов, крыльев, хвостов и нимба одним тегом: pink cat ears. Выключи — уйдёт отдельно: cat ears, pink ears' },
    { key: 'naiWeights', label: 'веса NAI', hint: 'Записывать вес как в NovelAI: 1.2::тег:: вместо (тег:1.2). Для генерации в NovelAI держи включённым' },
];

let db = null;
let root = null;
let hooks = { onChange() {}, onReveal() {}, onBan() {} };
const openPalettes = new Set();
let saveTimer = null;

function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSettings, 300);
}

// ---------- Разметка ----------

function shellHtml() {
    const s = getSettings();
    const toggles = TOGGLES.map((t) => `
        <label class="chm-switch" title="${escapeHtml(t.hint)}">
            <input type="checkbox" data-toggle="${t.key}" ${s.toggles[t.key] ? 'checked' : ''}>
            <span class="chm-switch-track"></span>
            <span class="chm-switch-label">${escapeHtml(t.label)}</span>
        </label>`).join('');
    const place = s.custom.place;
    return `
        <div class="chm-panel-head">
            <span class="chm-panel-title">Собранный персонаж</span>
            <span class="chm-panel-count">0 тег.</span>
        </div>

        <div class="chm-card chm-prompt-card">
            <div class="chm-mono-label">prompt.txt</div>
            <div class="chm-switches">${toggles}</div>
            <div class="chm-prompt-text"></div>
        </div>

        <details class="chm-fold chm-neg-fold">
            <summary class="chm-mono-label">negative.txt</summary>
            <div class="chm-neg-note"></div>
            <textarea class="text_pole chm-neg-input" rows="3" placeholder="lowres, bad anatomy, ...">${escapeHtml(s.negative)}</textarea>
            <div class="chm-fold-foot">
                <span class="chm-set-hint">Впиши своё через запятую. Тег, выбранный в плюс, в негатив не уйдёт.</span>
                <button type="button" class="chm-btn chm-copy-neg" title="Скопировать негатив"><i class="fa-regular fa-copy"></i></button>
            </div>
        </details>

        <details class="chm-fold chm-custom-fold">
            <summary class="chm-mono-label">custom.txt</summary>
            <div class="chm-seg" role="radiogroup">
                <button type="button" class="chm-seg-btn${place === 'start' ? ' chm-active' : ''}" data-place="start">В начало</button>
                <button type="button" class="chm-seg-btn${place === 'end' ? ' chm-active' : ''}" data-place="end">В конец</button>
                <button type="button" class="chm-seg-btn${place === 'split' ? ' chm-active' : ''}" data-place="split">Разделить</button>
            </div>
            <textarea class="text_pole chm-custom-input" rows="3" placeholder="masterpiece, best quality, ...">${escapeHtml(s.custom.text)}</textarea>
            <div class="chm-set-hint chm-custom-hint"></div>
        </details>

        <button type="button" class="chm-copy-btn"><i class="fa-regular fa-copy"></i> Скопировать промт</button>

        <div class="chm-rows-head">
            <span class="chm-mono-label">теги</span>
        </div>
        <div class="chm-rows"></div>`;
}

function customHint(place) {
    if (place === 'split') return 'Свои теги через запятую. Что до «|» — в начало промта, что после — в конец. Рандом и сброс их не трогают.';
    return 'Свои теги через запятую. Рандом и сброс их не трогают.';
}

function promptHtml(result) {
    if (!result.count && !result.head.length && !result.tail.length) {
        return '<span class="chm-prompt-empty">// пусто — выбери теги слева</span>';
    }
    const parts = [
        ...result.head.map((t) => `<span class="chm-ptag chm-ptag-custom">${escapeHtml(t)}</span>`),
        ...result.rows.map((r) => `<span class="chm-ptag chm-ptag-${r.kind}">${escapeHtml(r.text)}</span>`),
        ...result.tail.map((t) => `<span class="chm-ptag chm-ptag-custom">${escapeHtml(t)}</span>`),
    ];
    return parts.join('<span class="chm-pcomma">, </span>');
}

function paletteHtml(row) {
    const { tag, b } = row;
    const part = isPart(tag, db);
    const shadeOnly = !part && isShadeable(tag);
    const multi = isMulti(tag);
    const cur = b.color || {};
    let html = '<div class="chm-pal">';

    if (part) {
        html += '<div class="chm-pal-label">цвет</div><div class="chm-pal-colors">'
            + PART_COLORS.map((c) => `<button type="button" class="chm-pal-dot${cur.c === c.key ? ' chm-active' : ''}" data-color="${c.key}" title="${escapeHtml(c.ru)}" style="background:${escapeHtml(c.css)}"></button>`).join('')
            + '</div>';
    }
    if (part || shadeOnly) {
        html += '<div class="chm-pal-label">оттенок</div><div class="chm-pal-shades">'
            + SHADES.map((sh) => `<button type="button" class="chm-pal-shade${cur.s === sh.key ? ' chm-active' : ''}" data-shade="${sh.key}">${escapeHtml(sh.ru.replace(/-$/, ''))}</button>`).join('')
            + '</div>';
    }
    if (multi) {
        const picked = Array.isArray(b.colors) ? b.colors : [];
        html += `<div class="chm-pal-label">цвета · до ${MULTI_MAX}</div><div class="chm-pal-colors">`
            + PART_COLORS.filter((c) => c.key !== 'rainbow').map((c) => {
                const n = picked.indexOf(c.key);
                return `<button type="button" class="chm-pal-dot${n >= 0 ? ' chm-active' : ''}" data-multi="${c.key}" title="${escapeHtml(c.ru)}" style="background:${escapeHtml(c.css)}">${n >= 0 ? `<span>${n + 1}</span>` : ''}</button>`;
            }).join('')
            + '</div>';
    }
    html += '<button type="button" class="chm-btn chm-pal-reset">Сбросить цвет</button></div>';
    return html;
}

function rowHtml(row) {
    if (row.kind === 'clothing') return '';
    if (row.kind === 'auto') {
        return `
            <div class="chm-row chm-row-auto" data-auto="${escapeHtml(row.key)}">
                <div class="chm-row-top">
                    <span class="chm-row-name">${escapeHtml(row.ru)}</span>
                    <span class="chm-row-en">${escapeHtml(row.text)}</span>
                    <span class="chm-badge" title="Добавлен сам вместе с видом части">само</span>
                    <span class="chm-row-tools">
                        <button type="button" class="chm-row-btn chm-auto-off" title="Убрать общий тег"><i class="fa-solid fa-xmark"></i></button>
                    </span>
                </div>
            </div>`;
    }

    const { tag, b, weight } = row;
    const colorable = isPart(tag, db) || isShadeable(tag) || isMulti(tag);
    const label = colorLabel(b.color);
    const multi = isMulti(tag) && Array.isArray(b.colors) && b.colors.length
        ? b.colors.map((c) => `<span class="chm-mini-dot" style="background:${escapeHtml(colorCss(c))}"></span>`).join('')
        : '';
    const dot = b.color?.c ? `<span class="chm-mini-dot" style="background:${escapeHtml(colorCss(b.color.c))}" title="${escapeHtml(label)}"></span>` : '';
    const shadeOnly = !b.color?.c && b.color?.s ? `<span class="chm-row-shade">${escapeHtml(SHADES.find((s) => s.key === b.color.s)?.ru || '')}</span>` : '';
    const open = openPalettes.has(tag.id);

    return `
        <div class="chm-row${b.pinned ? ' chm-pinned' : ''}" data-id="${escapeHtml(tag.id)}">
            <div class="chm-row-top">
                ${dot}${multi}
                <button type="button" class="chm-row-name" title="Показать в каталоге">${shadeOnly}${escapeHtml(tag.ru)}</button>
                <span class="chm-row-en" title="${escapeHtml(row.en)}">${escapeHtml(row.en)}</span>
                <span class="chm-row-tools">
                    ${row.isGender ? '' : `<span class="chm-row-w">×${formatWeight(weight)}</span>`}
                    ${colorable ? `<button type="button" class="chm-row-btn chm-pal-btn${open ? ' chm-active' : ''}" title="Цвет"><i class="fa-solid fa-palette"></i></button>` : ''}
                    <button type="button" class="chm-row-btn chm-pin${b.pinned ? ' chm-active' : ''}" title="${b.pinned ? 'Открепить' : 'Закрепить — рандом не тронет'}"><i class="fa-solid fa-thumbtack"></i></button>
                    <button type="button" class="chm-row-btn chm-ban" title="В бан — убрать и больше не предлагать"><i class="fa-solid fa-ban"></i></button>
                    <button type="button" class="chm-row-btn chm-remove" title="Убрать"><i class="fa-solid fa-xmark"></i></button>
                </span>
            </div>
            ${row.isGender ? '' : `<input type="range" class="chm-w" min="${W_MIN}" max="${W_MAX}" step="${W_STEP}" value="${weight}" aria-label="Вес тега">`}
            ${open && colorable ? paletteHtml(row) : ''}
        </div>`;
}

// ---------- Рендер ----------

let last = null;

/** Перерисовать промт и список тегов. */
export function renderPanel() {
    if (!root || !db) return;
    const s = getSettings();
    last = buildPrompt(db, s);

    root.querySelector('.chm-panel-count').textContent = `${last.count} тег.`;
    root.querySelector('.chm-prompt-text').innerHTML = promptHtml(last);

    const note = root.querySelector('.chm-neg-note');
    note.textContent = last.negDropped
        ? `// ${last.negDropped} из негатива уже выбраны в плюс — их не отправим`
        : (last.count ? '' : '');
    note.hidden = !note.textContent;

    const rows = root.querySelector('.chm-rows');
    const html = last.rows.map(rowHtml).join('');
    rows.innerHTML = html || '<div class="chm-prompt-empty">// тут появятся выбранные теги с весами</div>';
}

/** Обновить только текст промта (во время перетаскивания слайдера или набора текста). */
function renderPromptOnly() {
    if (!root || !db) return;
    last = buildPrompt(db, getSettings());
    root.querySelector('.chm-prompt-text').innerHTML = promptHtml(last);
}

// ---------- Копирование ----------

async function copyText(text, what) {
    if (!text) {
        window.toastr?.info(`Копировать нечего — ${what} пустой.`, TOAST_TITLE);
        return;
    }
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
    }
    window.toastr?.success(`${what[0].toUpperCase()}${what.slice(1)} скопирован.`, TOAST_TITLE, { timeOut: 1500 });
}

/** Готовый промт целиком — для копирования и (на этапе 5) для генерации. */
export function currentPrompt() {
    return db ? buildPrompt(db, getSettings()) : null;
}

// ---------- События ----------

function findB(id) {
    return getSettings().build.find((b) => b.id === id);
}

function onClick(e) {
    const s = getSettings();

    if (e.target.closest('.chm-copy-btn')) {
        copyText(buildPrompt(db, s).positive, 'промт');
        return;
    }
    if (e.target.closest('.chm-copy-neg')) {
        copyText(buildPrompt(db, s).negative, 'негатив');
        return;
    }

    const seg = e.target.closest('.chm-seg-btn');
    if (seg) {
        s.custom.place = seg.dataset.place;
        saveSettings();
        root.querySelectorAll('.chm-seg-btn').forEach((b) => b.classList.toggle('chm-active', b === seg));
        root.querySelector('.chm-custom-hint').textContent = customHint(s.custom.place);
        renderPromptOnly();
        return;
    }

    const autoRow = e.target.closest('.chm-row-auto');
    if (autoRow && e.target.closest('.chm-auto-off')) {
        if (!s.autoOff.includes(autoRow.dataset.auto)) s.autoOff.push(autoRow.dataset.auto);
        saveSettings();
        renderPanel();
        return;
    }

    const row = e.target.closest('.chm-row[data-id]');
    if (!row) return;
    const id = row.dataset.id;
    const b = findB(id);
    if (!b) return;

    if (e.target.closest('.chm-row-name')) {
        hooks.onReveal(id);
        return;
    }
    if (e.target.closest('.chm-remove')) {
        s.build = s.build.filter((x) => x.id !== id);
        openPalettes.delete(id);
        saveSettings();
        hooks.onChange(id);
        return;
    }
    if (e.target.closest('.chm-ban')) {
        s.build = s.build.filter((x) => x.id !== id);
        if (!s.banned.includes(id)) s.banned.push(id);
        openPalettes.delete(id);
        saveSettings();
        hooks.onBan(id);
        hooks.onChange(id);
        return;
    }
    if (e.target.closest('.chm-pin')) {
        b.pinned = !b.pinned;
        saveSettings();
        renderPanel();
        return;
    }
    if (e.target.closest('.chm-pal-btn')) {
        if (openPalettes.has(id)) openPalettes.delete(id);
        else openPalettes.add(id);
        renderPanel();
        return;
    }

    const dot = e.target.closest('[data-color]');
    if (dot) {
        const c = dot.dataset.color;
        b.color = { ...(b.color || {}), c: b.color?.c === c ? null : c };
        if (!b.color.c && !b.color.s) delete b.color;
        saveSettings();
        renderPanel();
        return;
    }
    const shade = e.target.closest('[data-shade]');
    if (shade) {
        const sh = shade.dataset.shade;
        b.color = { ...(b.color || {}), s: b.color?.s === sh ? null : sh };
        if (!b.color.c && !b.color.s) delete b.color;
        saveSettings();
        renderPanel();
        return;
    }
    const multi = e.target.closest('[data-multi]');
    if (multi) {
        const c = multi.dataset.multi;
        const list = Array.isArray(b.colors) ? b.colors : [];
        if (list.includes(c)) b.colors = list.filter((x) => x !== c);
        else if (list.length < MULTI_MAX) b.colors = [...list, c];
        else window.toastr?.info(`Не больше ${MULTI_MAX} цветов.`, TOAST_TITLE, { timeOut: 1500 });
        if (!b.colors?.length) delete b.colors;
        saveSettings();
        renderPanel();
        return;
    }
    if (e.target.closest('.chm-pal-reset')) {
        delete b.color;
        delete b.colors;
        saveSettings();
        renderPanel();
    }
}

function onInput(e) {
    const s = getSettings();

    const slider = e.target.closest('.chm-w');
    if (slider) {
        const row = slider.closest('.chm-row');
        const b = findB(row.dataset.id);
        if (!b) return;
        b.weight = Math.min(W_MAX, Math.max(W_MIN, Number(slider.value) || 1));
        row.querySelector('.chm-row-w').textContent = `×${formatWeight(b.weight)}`;
        saveSoon();
        renderPromptOnly();
        return;
    }
    if (e.target.closest('.chm-neg-input')) {
        s.negative = e.target.value;
        saveSoon();
        renderPanel();
        return;
    }
    if (e.target.closest('.chm-custom-input')) {
        s.custom.text = e.target.value;
        saveSoon();
        renderPromptOnly();
    }
}

function onChangeEvt(e) {
    const t = e.target.closest('[data-toggle]');
    if (!t) return;
    getSettings().toggles[t.dataset.toggle] = t.checked;
    saveSettings();
    hooks.onChange(null, { toggle: t.dataset.toggle });
}

// ---------- Запуск ----------

/**
 * @param {HTMLElement} el — правая колонка
 * @param {object} database
 * @param {{ onChange: Function, onReveal: Function, onBan: Function }} callbacks
 */
export function initPanel(el, database, callbacks) {
    root = el;
    db = database;
    hooks = { ...hooks, ...callbacks };
    root.innerHTML = shellHtml();
    root.querySelector('.chm-custom-hint').textContent = customHint(getSettings().custom.place);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChangeEvt);
    renderPanel();
}
