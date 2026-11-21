// Chimera — каталог тегов: разделы, категории, подгруппы, поиск и выбор
// Тела категорий рисуются лениво — только когда категория раскрыта (тегов больше двух тысяч).

import { getSettings, saveSettings, escapeHtml } from './store.js';
import { swatchCss, normalizeQuery } from './data.js';
import { currentGender, genderedEn, isIncompatible } from './builder.js';

const SEARCH_MIN = 18;       // у категорий от стольких тегов есть свой поиск (как на сайте)
const GLOBAL_LIMIT = 40;     // сколько результатов показывать в общем поиске

let db = null;               // { sections, cats, tags }
let rootEl = null;           // .chm-catalog-list
let onChange = () => {};
const view = new Map();      // catId → { sub: 'all' | key, q: '', searchOpen: bool }

// ---------- Состояние ----------

function viewOf(catId) {
    if (!view.has(catId)) view.set(catId, { sub: 'all', q: '', searchOpen: false });
    return view.get(catId);
}

function isCatOpen(cat) {
    const saved = getSettings().catOpen[cat.id];
    return saved === undefined ? cat.open : saved;
}

function isSectionOpen(sec) {
    return !getSettings().sectionClosed[sec.id];
}

export function selectedIds() {
    return new Set(getSettings().build.map((b) => b.id));
}

function countSelectedIn(cat, selected = selectedIds()) {
    return cat.tags.reduce((n, t) => n + (selected.has(t.id) ? 1 : 0), 0);
}

// ---------- Выбор тегов ----------

/** Клик по тегу: выбрать или снять. В категории «один» новый тег вытесняет старый. */
export function toggleTag(id) {
    const tag = db?.tags.get(id);
    if (!tag) return;
    const s = getSettings();
    // Клик по забаненному тегу снимает бан и сразу выбирает тег
    const banIdx = s.banned.indexOf(id);
    if (banIdx >= 0) s.banned.splice(banIdx, 1);
    const idx = s.build.findIndex((b) => b.id === id);
    if (idx >= 0) {
        s.build.splice(idx, 1);
    } else {
        const cat = db.cats.get(tag.catId);
        if (cat.mode === 'one') {
            const sameCat = new Set(cat.tags.map((t) => t.id));
            s.build = s.build.filter((b) => !sameCat.has(b.id));
        }
        s.build.push({ id, weight: 1 });
    }
    saveSettings();
    refreshSelection(tag.catId);
    onChange(id);
}

/** Перекрасить выбранные теги в категории (или во всех открытых). */
function refreshSelection(catId) {
    if (!rootEl) return;
    const selected = selectedIds();
    const banned = new Set(getSettings().banned);
    const cats = catId ? [db.cats.get(catId)] : [...db.cats.values()];
    for (const cat of cats) {
        const box = rootEl.querySelector(`.chm-catbox[data-cat="${cat.id}"]`);
        if (!box) continue;
        box.querySelectorAll('.chm-tag').forEach((el) => {
            const on = selected.has(el.dataset.id);
            el.classList.toggle('chm-on', on);
            el.classList.toggle('chm-banned', banned.has(el.dataset.id));
            el.setAttribute('aria-pressed', String(on));
        });
        renderCatCount(box, cat, selected);
    }
}

export function refreshAllSelection() {
    refreshSelection(null);
}

// ---------- Рендер ----------

function tagHtml(tag, selected, ctx = renderCtx()) {
    const on = selected.has(tag.id);
    const banned = ctx.banned.has(tag.id);
    const swatch = swatchCss(tag.swatch);
    const dot = swatch ? `<span class="chm-dot" style="background:${escapeHtml(swatch)}"></span>` : '';
    const en = genderedEn(tag, ctx.gender);
    // У цветных кружков английский не показываем (как на сайте); у эмотиконов, где ru = en, — тоже
    const showEn = !swatch && tag.ru !== tag.en;
    const title = banned ? `${en} — в бане, клик снимет бан` : en;
    return `<button type="button" class="chm-tag${on ? ' chm-on' : ''}${tag.rare ? ' chm-rare' : ''}${banned ? ' chm-banned' : ''}" data-id="${escapeHtml(tag.id)}" aria-pressed="${on}" title="${escapeHtml(title)}">`
        + dot
        + `<span class="chm-tag-ru">${escapeHtml(tag.ru)}</span>`
        + (showEn ? `<span class="chm-tag-en">${escapeHtml(en)}</span>` : '')
        + (tag.rare ? '<span class="chm-tag-rare">&lt;100</span>' : '')
        + '</button>';
}

/** Общее для отрисовки: пол, баны, показывать ли чужой пол. */
function renderCtx() {
    const s = getSettings();
    return {
        gender: db ? currentGender(db, s.build) : null,
        banned: new Set(s.banned),
        showOther: s.toggles.otherGender,
    };
}

/** Тег виден с учётом пола (при выключенном «чужой пол» несовместимые прячутся). */
function genderVisible(tag, ctx) {
    return ctx.showOther || !isIncompatible(tag, ctx.gender);
}

function visibleTags(cat, ctx = renderCtx()) {
    const v = viewOf(cat.id);
    const q = normalizeQuery(v.q);
    return cat.tags.filter((t) => genderVisible(t, ctx) && (v.sub === 'all' || t.sub === v.sub) && (!q || t.search.includes(q)));
}

/** Категория целиком чужого пола (например, «Грудь» при мужском) — прячем её саму. */
function catHidden(cat, ctx) {
    return !ctx.showOther && cat.tags.every((t) => isIncompatible(t, ctx.gender));
}

function renderCatCount(box, cat, selected = selectedIds()) {
    const el = box.querySelector('.chm-catbox-count');
    if (!el) return;
    const n = countSelectedIn(cat, selected);
    el.textContent = n ? `${n} / ${cat.tags.length}` : String(cat.tags.length);
    el.classList.toggle('chm-has', n > 0);
}

function catBodyHtml(cat) {
    const v = viewOf(cat.id);
    const selected = selectedIds();
    const ctx = renderCtx();
    const search = v.searchOpen
        ? `<div class="chm-catbox-search"><i class="fa-solid fa-magnifying-glass"></i><input type="search" class="chm-catbox-q" placeholder="искать в «${escapeHtml(cat.title)}»" value="${escapeHtml(v.q)}" autocomplete="off" spellcheck="false"></div>`
        : '';
    const subs = cat.subs.length
        ? `<div class="chm-subs">`
            + `<button type="button" class="chm-sub${v.sub === 'all' ? ' chm-active' : ''}" data-sub="all">Все</button>`
            + cat.subs.map((s) => `<button type="button" class="chm-sub${v.sub === s.key ? ' chm-active' : ''}" data-sub="${escapeHtml(s.key)}">${escapeHtml(s.title)}</button>`).join('')
            + `</div>`
        : '';
    const list = visibleTags(cat, ctx);
    const tags = list.length
        ? list.map((t) => tagHtml(t, selected, ctx)).join('')
        : '<div class="chm-empty">// ничего не нашлось</div>';
    return `${search}${subs}<div class="chm-tags">${tags}</div>`;
}

function catHtml(cat, ctx = renderCtx()) {
    const open = isCatOpen(cat);
    const canSearch = cat.tags.length >= SEARCH_MIN;
    const hidden = catHidden(cat, ctx);
    return `
        <div class="chm-catbox${open ? ' chm-open' : ''}" data-cat="${escapeHtml(cat.id)}"${hidden ? ' hidden' : ''}>
            <div class="chm-catbox-head">
                <button type="button" class="chm-catbox-toggle" aria-expanded="${open}">
                    <i class="fa-solid fa-chevron-down chm-chev"></i>
                    <span class="chm-catbox-title">${escapeHtml(cat.title)}</span>
                    <span class="chm-catbox-mode">· ${cat.mode === 'one' ? 'один' : 'мультивыбор'}</span>
                </button>
                <span class="chm-catbox-count"></span>
                ${canSearch ? '<button type="button" class="chm-icon-btn chm-catbox-searchbtn" title="Искать в категории"><i class="fa-solid fa-magnifying-glass"></i></button>' : ''}
            </div>
            <div class="chm-catbox-body">${open ? catBodyHtml(cat) : ''}</div>
        </div>`;
}

function sectionHtml(sec, ctx) {
    const open = isSectionOpen(sec);
    return `
        <section class="chm-sec${open ? ' chm-open' : ''}" data-sec="${escapeHtml(sec.id)}">
            <button type="button" class="chm-sec-head" aria-expanded="${open}">
                <span class="chm-sec-title">${escapeHtml(sec.title)}</span>
                <span class="chm-sec-line"></span>
                <span class="chm-sec-en">${escapeHtml(sec.en)}</span>
                <i class="fa-solid fa-chevron-down chm-chev"></i>
            </button>
            <div class="chm-sec-body">${sec.cats.map((c) => catHtml(c, ctx)).join('')}</div>
        </section>`;
}

function renderCatBody(cat) {
    const box = rootEl?.querySelector(`.chm-catbox[data-cat="${cat.id}"]`);
    if (!box) return;
    const body = box.querySelector('.chm-catbox-body');
    body.innerHTML = isCatOpen(cat) ? catBodyHtml(cat) : '';
}

/** Полный перерисованный каталог (после загрузки и после «Свернуть всё»). */
export function renderCatalog() {
    if (!rootEl || !db) return;
    const ctx = renderCtx();
    // Сохраняем прокрутку: полная перерисовка не должна прыгать наверх
    const scroller = rootEl.closest('.chm-col');
    const top = scroller?.scrollTop || 0;
    rootEl.innerHTML = `
        <div class="chm-catalog-tools">
            <button type="button" class="chm-btn chm-collapse-all"></button>
        </div>
        ${db.sections.map((sec) => sectionHtml(sec, ctx)).join('')}`;
    rootEl.querySelectorAll('.chm-catbox').forEach((box) => renderCatCount(box, db.cats.get(box.dataset.cat)));
    renderCollapseLabel();
    if (scroller) scroller.scrollTop = top;
}

// ---------- «Свернуть всё» ----------

function anyCatOpen() {
    return [...db.cats.values()].some((c) => isCatOpen(c) && isSectionOpen(db.sections.find((s) => s.id === c.sectionId)));
}

function anySectionOpen() {
    return db.sections.some(isSectionOpen);
}

function renderCollapseLabel() {
    const btn = rootEl?.querySelector('.chm-collapse-all');
    if (!btn) return;
    if (anyCatOpen()) btn.innerHTML = '<i class="fa-solid fa-compress"></i> Свернуть всё';
    else if (anySectionOpen()) btn.innerHTML = '<i class="fa-solid fa-angles-up"></i> Свернуть разделы';
    else btn.innerHTML = '<i class="fa-solid fa-angles-down"></i> Развернуть разделы';
}

function collapseStep() {
    const s = getSettings();
    if (anyCatOpen()) {
        for (const cat of db.cats.values()) s.catOpen[cat.id] = false;
    } else if (anySectionOpen()) {
        for (const sec of db.sections) s.sectionClosed[sec.id] = true;
    } else {
        s.sectionClosed = {};
    }
    saveSettings();
    renderCatalog();
}

// ---------- События ----------

function onClick(e) {
    const tagBtn = e.target.closest('.chm-tag');
    if (tagBtn) {
        toggleTag(tagBtn.dataset.id);
        return;
    }

    if (e.target.closest('.chm-collapse-all')) {
        collapseStep();
        return;
    }

    const secHead = e.target.closest('.chm-sec-head');
    if (secHead) {
        const secEl = secHead.closest('.chm-sec');
        const s = getSettings();
        const open = !secEl.classList.contains('chm-open');
        if (open) delete s.sectionClosed[secEl.dataset.sec];
        else s.sectionClosed[secEl.dataset.sec] = true;
        saveSettings();
        secEl.classList.toggle('chm-open', open);
        secHead.setAttribute('aria-expanded', String(open));
        renderCollapseLabel();
        return;
    }

    const box = e.target.closest('.chm-catbox');
    if (!box) return;
    const cat = db.cats.get(box.dataset.cat);

    if (e.target.closest('.chm-catbox-toggle')) {
        const open = !isCatOpen(cat);
        getSettings().catOpen[cat.id] = open;
        saveSettings();
        box.classList.toggle('chm-open', open);
        box.querySelector('.chm-catbox-toggle').setAttribute('aria-expanded', String(open));
        renderCatBody(cat);
        renderCollapseLabel();
        return;
    }

    if (e.target.closest('.chm-catbox-searchbtn')) {
        const v = viewOf(cat.id);
        v.searchOpen = !v.searchOpen;
        if (!v.searchOpen) v.q = '';
        if (!isCatOpen(cat)) {
            getSettings().catOpen[cat.id] = true;
            saveSettings();
            box.classList.add('chm-open');
        }
        renderCatBody(cat);
        if (v.searchOpen) box.querySelector('.chm-catbox-q')?.focus();
        renderCollapseLabel();
        return;
    }

    const subBtn = e.target.closest('.chm-sub');
    if (subBtn) {
        viewOf(cat.id).sub = subBtn.dataset.sub;
        renderCatBody(cat);
    }
}

function onInput(e) {
    const input = e.target.closest('.chm-catbox-q');
    if (!input) return;
    const box = input.closest('.chm-catbox');
    const cat = db.cats.get(box.dataset.cat);
    viewOf(cat.id).q = input.value;
    // Перерисовываем только список, чтобы не терять фокус в поле
    const selected = selectedIds();
    const ctx = renderCtx();
    const list = visibleTags(cat, ctx);
    box.querySelector('.chm-tags').innerHTML = list.length
        ? list.map((t) => tagHtml(t, selected, ctx)).join('')
        : '<div class="chm-empty">// ничего не нашлось</div>';
}

// ---------- Показать тег на месте ----------

/** Раскрыть раздел и категорию тега, сбросить фильтры, прокрутить к нему и подсветить. */
export function revealTag(id) {
    const tag = db?.tags.get(id);
    if (!tag || !rootEl) return;
    const cat = db.cats.get(tag.catId);
    const s = getSettings();
    delete s.sectionClosed[cat.sectionId];
    s.catOpen[cat.id] = true;
    saveSettings();
    const v = viewOf(cat.id);
    v.sub = 'all';
    v.q = '';

    const secEl = rootEl.querySelector(`.chm-sec[data-sec="${cat.sectionId}"]`);
    secEl?.classList.add('chm-open');
    secEl?.querySelector('.chm-sec-head')?.setAttribute('aria-expanded', 'true');
    const box = rootEl.querySelector(`.chm-catbox[data-cat="${cat.id}"]`);
    box?.classList.add('chm-open');
    box?.querySelector('.chm-catbox-toggle')?.setAttribute('aria-expanded', 'true');
    renderCatBody(cat);
    renderCollapseLabel();

    const el = box?.querySelector(`.chm-tag[data-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    el.classList.remove('chm-flash');
    void el.offsetWidth;   // перезапуск анимации
    el.classList.add('chm-flash');
    setTimeout(() => el.classList.remove('chm-flash'), 1600);
}

// ---------- Общий поиск в шапке ----------

export function searchTags(query) {
    const q = normalizeQuery(query);
    if (!q || !db) return [];
    const ctx = renderCtx();
    const starts = [];
    const contains = [];
    for (const tag of db.tags.values()) {
        if (!genderVisible(tag, ctx)) continue;
        const ru = tag.ru.toLowerCase().replace(/ё/g, 'е');
        const en = tag.en.toLowerCase();
        if (ru.startsWith(q) || en.startsWith(q)) starts.push(tag);
        else if (tag.search.includes(q)) contains.push(tag);
        if (starts.length >= GLOBAL_LIMIT) break;
    }
    return [...starts, ...contains].slice(0, GLOBAL_LIMIT);
}

/**
 * Поиск в шапке: выпадающий список, ↑↓ — выбор, ⏎ — показать тег на месте, Esc — закрыть список.
 * @param {HTMLInputElement} input
 * @param {HTMLElement} dropdown
 * @param {() => void} beforeReveal — например, переключить телефон на вкладку «Каталог»
 */
export function bindGlobalSearch(input, dropdown, beforeReveal = () => {}) {
    let results = [];
    let active = -1;

    function close() {
        dropdown.hidden = true;
        dropdown.innerHTML = '';
        results = [];
        active = -1;
    }

    function paint() {
        if (!input.value.trim()) {
            close();
            return;
        }
        dropdown.hidden = false;
        if (!results.length) {
            dropdown.innerHTML = '<div class="chm-sr-empty">// ничего не нашлось</div>';
            return;
        }
        const selected = selectedIds();
        dropdown.innerHTML = results.map((t, i) => {
            const cat = db.cats.get(t.catId);
            return `<button type="button" class="chm-sr${i === active ? ' chm-active' : ''}${selected.has(t.id) ? ' chm-on' : ''}" data-i="${i}">`
                + `<span class="chm-sr-ru">${escapeHtml(t.ru)}</span>`
                + `<span class="chm-sr-en">${escapeHtml(genderedEn(t, currentGender(db)))}</span>`
                + `<span class="chm-sr-cat">${escapeHtml(cat.title)}</span>`
                + '</button>';
        }).join('');
        dropdown.querySelector('.chm-sr.chm-active')?.scrollIntoView?.({ block: 'nearest' });
    }

    function pick(i) {
        const tag = results[i];
        if (!tag) return;
        close();
        input.value = '';
        input.blur();
        beforeReveal();
        revealTag(tag.id);
    }

    input.addEventListener('input', () => {
        results = searchTags(input.value);
        active = results.length ? 0 : -1;
        paint();
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' && results.length) {
            e.preventDefault();
            active = (active + 1) % results.length;
            paint();
        } else if (e.key === 'ArrowUp' && results.length) {
            e.preventDefault();
            active = (active - 1 + results.length) % results.length;
            paint();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(active);
        } else if (e.key === 'Escape') {
            // Первый Esc — закрыть список и выйти из поля, окно не трогаем
            e.preventDefault();
            e.stopPropagation();
            close();
            input.value = '';
            input.blur();
        }
    });

    // mousedown, а не click: иначе blur поля успевает закрыть список раньше
    dropdown.addEventListener('mousedown', (e) => {
        const row = e.target.closest('.chm-sr');
        if (!row) return;
        e.preventDefault();
        pick(Number(row.dataset.i));
    });

    input.addEventListener('blur', () => setTimeout(close, 150));
}

// ---------- Запуск ----------

/**
 * @param {HTMLElement} root — контейнер каталога
 * @param {object} database — результат loadTags()
 * @param {() => void} changed — вызывается после изменения выбора
 */
export function initCatalog(root, database, changed) {
    rootEl = root;
    db = database;
    onChange = changed || (() => {});
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    renderCatalog();
}

export function getDb() {
    return db;
}
