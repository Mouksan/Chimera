// Chimera — каталог тегов: разделы, категории, подгруппы, поиск и выбор
// Тела категорий рисуются лениво — только когда категория раскрыта (тегов больше двух тысяч).

import { getSettings, saveSettings, escapeHtml } from './store.js';
import { swatchCss, normalizeQuery } from './data.js';
import { currentGender, genderedEn, isIncompatible } from './builder.js';
import { isBanned, isDirectBan, subKey, catKey, toggleBanKey, addBan, removeBan } from './bans.js';
import { findConflicts } from './conflicts.js';
import { rollCategory, togglePinCategory } from './random.js';
import { showUndo, toast } from './notice.js';

const SEARCH_MIN = 18;       // у категорий от стольких тегов есть свой поиск (как на сайте)
const GLOBAL_LIMIT = 40;     // сколько результатов показывать в общем поиске

let db = null;               // { sections, cats, tags }
let rootEl = null;           // .chm-catalog-list
let onChange = () => {};    // (id?, opts?) — сборка поменялась
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

// ---------- Выбор тегов ----------

/** Клик по тегу: выбрать или снять. В категории «один» новый тег вытесняет старый. */
export function toggleTag(id) {
    const tag = db?.tags.get(id);
    if (!tag) return;
    const s = getSettings();
    // Клик по забаненному руками тегу снимает его бан и сразу выбирает.
    // Бан подгруппы или категории остаётся: он про рандом, а руками выбрать можно всегда
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
    const ctx = renderCtx();
    const selected = ctx.selected;
    const cats = catId ? [db.cats.get(catId)] : [...db.cats.values()];
    for (const cat of cats) {
        const box = rootEl.querySelector(`.chm-catbox[data-cat="${cat.id}"]`);
        if (!box) continue;
        box.querySelectorAll('.chm-tag').forEach((el) => {
            const tag = db.tags.get(el.dataset.id);
            const on = selected.has(el.dataset.id);
            el.classList.toggle('chm-on', on);
            el.classList.toggle('chm-banned', Boolean(tag) && isBanned(tag, ctx.banned));
            el.classList.toggle('chm-conflict', ctx.conflicted.has(el.dataset.id));
            el.setAttribute('aria-pressed', String(on));
        });
        box.querySelectorAll('.chm-subwrap').forEach((w) => {
            w.classList.toggle('chm-sub-banned', ctx.banned.has(subKey(cat.id, w.dataset.sub)));
        });
        renderCatHead(box, cat, ctx);
    }
}

export function refreshAllSelection() {
    refreshSelection(null);
}

// ---------- Рендер ----------

function tagHtml(tag, selected, ctx = renderCtx()) {
    const on = selected.has(tag.id);
    const banned = isBanned(tag, ctx.banned);
    const direct = isDirectBan(tag, ctx.banned);
    const conflict = ctx.conflicted.has(tag.id);
    const swatch = swatchCss(tag.swatch);
    const dot = swatch ? `<span class="chm-dot" style="background:${escapeHtml(swatch)}"></span>` : '';
    const en = genderedEn(tag, ctx.gender);
    // У цветных кружков английский не показываем (как на сайте); у эмотиконов, где ru = en, — тоже
    const showEn = !swatch && tag.ru !== tag.en;
    let title = `${en} · правый клик — в бан`;
    if (direct) title = `${en} — в бане, клик выберет и снимет бан`;
    else if (banned) title = `${en} — в бане вместе с подгруппой или категорией; руками выбрать можно`;
    return `<button type="button" class="chm-tag${on ? ' chm-on' : ''}${tag.rare ? ' chm-rare' : ''}${banned ? ' chm-banned' : ''}${conflict ? ' chm-conflict' : ''}" data-id="${escapeHtml(tag.id)}" aria-pressed="${on}" title="${escapeHtml(title)}">`
        + dot
        + `<span class="chm-tag-ru">${escapeHtml(tag.ru)}</span>`
        + (showEn ? `<span class="chm-tag-en">${escapeHtml(en)}</span>` : '')
        + (tag.rare ? '<span class="chm-tag-rare">&lt;100</span>' : '')
        + '</button>';
}

/** Общее для отрисовки: пол, баны, показывать ли чужой пол. */
function renderCtx() {
    const s = getSettings();
    const selected = new Set(s.build.map((b) => b.id));
    const conflicted = new Set(findConflicts(selected).flat());
    return {
        gender: db ? currentGender(db, s.build) : null,
        banned: new Set(s.banned),
        showOther: s.toggles.otherGender,
        selected,
        conflicted,
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

/** Шапка категории: счётчик, состояние 📌 и 🚫. */
function renderCatHead(box, cat, ctx = renderCtx()) {
    const s = getSettings();
    const inCat = s.build.filter((b) => db.tags.get(b.id)?.catId === cat.id);
    const n = inCat.length;
    const count = box.querySelector('.chm-catbox-count');
    if (count) {
        count.textContent = n ? `${n} / ${cat.tags.length}` : String(cat.tags.length);
        count.classList.toggle('chm-has', n > 0);
    }
    const allPinned = n > 0 && inCat.every((b) => b.pinned);
    const pin = box.querySelector('.chm-cat-pin');
    if (pin) {
        pin.classList.toggle('chm-active', allPinned);
        pin.disabled = n === 0;
        pin.title = n === 0 ? 'Закрепить выбранное — сначала выбери что-нибудь' : (allPinned ? 'Открепить всё в категории' : 'Закрепить всё выбранное в категории');
    }
    const catBanned = ctx.banned.has(catKey(cat.id));
    box.classList.toggle('chm-cat-banned', catBanned);
    const ban = box.querySelector('.chm-cat-ban');
    if (ban) {
        ban.classList.toggle('chm-active', catBanned);
        ban.title = catBanned ? 'Вернуть категорию в рандом' : 'Забанить категорию — рандом её не тронет';
    }
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
            + cat.subs.map((s) => {
                const subBanned = ctx.banned.has(subKey(cat.id, s.key));
                return `<span class="chm-subwrap${subBanned ? ' chm-sub-banned' : ''}" data-sub="${escapeHtml(s.key)}">`
                    + `<button type="button" class="chm-sub${v.sub === s.key ? ' chm-active' : ''}" data-sub="${escapeHtml(s.key)}">${escapeHtml(s.title)}</button>`
                    + `<button type="button" class="chm-sub-ban" title="${subBanned ? 'Вернуть подгруппу в рандом' : 'Забанить подгруппу целиком'}"><i class="fa-solid fa-ban"></i></button>`
                    + '</span>';
            }).join('')
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
                <span class="chm-catbox-tools">
                    ${canSearch ? '<button type="button" class="chm-icon-btn chm-catbox-searchbtn" title="Искать в категории"><i class="fa-solid fa-magnifying-glass"></i></button>' : ''}
                    <button type="button" class="chm-icon-btn chm-cat-ban"><i class="fa-solid fa-ban"></i></button>
                    <button type="button" class="chm-icon-btn chm-cat-pin"><i class="fa-solid fa-thumbtack"></i></button>
                    <button type="button" class="chm-icon-btn chm-cat-dice" title="Случайный тег в этой категории"><i class="fa-solid fa-dice"></i></button>
                </span>
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
    rootEl.querySelectorAll('.chm-catbox').forEach((box) => renderCatHead(box, db.cats.get(box.dataset.cat), ctx));
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

    if (e.target.closest('.chm-cat-dice')) {
        const res = rollCategory(db, cat.id);
        if (!res.ok) {
            toast(res.reason);
            return;
        }
        refreshSelection(cat.id);
        onChange(res.id, { random: true });
        return;
    }

    if (e.target.closest('.chm-cat-pin')) {
        if (togglePinCategory(db, cat.id) === null) return;
        renderCatHead(box, cat);
        onChange(null, { pins: true });
        return;
    }

    if (e.target.closest('.chm-cat-ban')) {
        const on = toggleBanKey(catKey(cat.id));
        refreshSelection(cat.id);
        onChange(null, { bans: true });
        if (on) showUndo(`«${cat.title}» в бане`, () => {
            removeBan(catKey(cat.id));
            refreshSelection(cat.id);
            onChange(null, { bans: true });
        });
        return;
    }

    const subBan = e.target.closest('.chm-sub-ban');
    if (subBan) {
        const key = subBan.closest('.chm-subwrap').dataset.sub;
        const title = cat.subs.find((x) => x.key === key)?.title || key;
        const on = toggleBanKey(subKey(cat.id, key));
        refreshSelection(cat.id);
        onChange(null, { bans: true });
        if (on) showUndo(`«${title}» в бане`, () => {
            removeBan(subKey(cat.id, key));
            refreshSelection(cat.id);
            onChange(null, { bans: true });
        });
        return;
    }

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
        if (v.searchOpen) box.querySelector('.chm-catbox-q')?.focus({ preventScroll: true });
        renderCollapseLabel();
        return;
    }

    const subBtn = e.target.closest('.chm-sub');
    if (subBtn) {
        viewOf(cat.id).sub = subBtn.dataset.sub;
        renderCatBody(cat);
    }
}

/** Правый клик (на телефоне — долгое нажатие) по тегу: в бан, с полоской «Отменить». */
function onContextMenu(e) {
    const tagBtn = e.target.closest('.chm-tag');
    if (!tagBtn) return;
    e.preventDefault();
    banTagWithUndo(tagBtn.dataset.id);
}

/** Забанить тег (и убрать из сборки, если выбран) — с полоской «Отменить». */
export function banTagWithUndo(id) {
    const tag = db?.tags.get(id);
    if (!tag) return;
    const s = getSettings();
    if (s.banned.includes(id)) {
        // Уже в бане — правый клик возвращает
        removeBan(id);
        refreshSelection(tag.catId);
        onChange(id, { bans: true });
        toast(`«${tag.ru}» снова в рандоме`);
        return;
    }
    const prevBuild = structuredClone(s.build);
    s.build = s.build.filter((b) => b.id !== id);
    addBan(id);
    refreshSelection(tag.catId);
    onChange(id, { bans: true });
    showUndo(`«${tag.ru}» в бане`, () => {
        removeBan(id);
        getSettings().build = prevBuild;
        saveSettings();
        refreshSelection(tag.catId);
        onChange(id, { bans: true });
    });
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

// ---------- Прокрутка только внутри своего контейнера ----------

/**
 * Прокрутить контейнер так, чтобы элемент оказался виден.
 * Не scrollIntoView: тот крутит заодно всех прокручиваемых родителей, включая страницу
 * таверны, — и её шапка уезжает вверх под нашим окном.
 * @param {'center'|'nearest'} block
 */
function scrollWithin(container, el, block = 'nearest', smooth = false) {
    if (!container || !el) return;
    const c = container.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    let delta = 0;
    if (block === 'center') {
        delta = (r.top + r.height / 2) - (c.top + c.height / 2);
    } else if (r.top < c.top) {
        delta = r.top - c.top - 4;
    } else if (r.bottom > c.bottom) {
        delta = r.bottom - c.bottom + 4;
    }
    if (!delta) return;
    const top = container.scrollTop + delta;
    if (smooth && container.scrollTo) container.scrollTo({ top, behavior: 'smooth' });
    else container.scrollTop = top;
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
    scrollWithin(rootEl.closest('.chm-col'), el, 'center', true);
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
        scrollWithin(dropdown, dropdown.querySelector('.chm-sr.chm-active'));
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
    root.addEventListener('contextmenu', onContextMenu);
    renderCatalog();
}

export function getDb() {
    return db;
}
