// Chimera — «Мои персонажи»: сохранить сборку под именем, загрузить, переименовать,
// обновить, удалить. Персонаж хранит только теги (с весами, цветами и закрепами)
// и снятые «само»; негатив и custom остаются общими.

import { getSettings, saveSettings, escapeHtml, makeId } from './store.js';
import { pushHistory } from './random.js';
import { toast } from './notice.js';

let db = null;
let onChange = () => {};
let saveOpen = false;        // открыта ли строка «имя + Сохранить» в шапке
let query = '';

// ---------- Данные ----------

export function loadedChar() {
    const s = getSettings();
    return s.characters.find((c) => c.id === s.loadedCharId) || null;
}

function cleanBuild(build) {
    return structuredClone(build || []).map((b) => {
        const out = { id: b.id, weight: Number(b.weight) || 1 };
        if (b.pinned) out.pinned = true;
        if (b.color) out.color = b.color;
        if (b.colors) out.colors = b.colors;
        return out;
    });
}

/** Отпечаток сборки для сравнения: порядок не важен. */
function fingerprint(build, autoOff) {
    const items = cleanBuild(build).sort((a, b) => a.id.localeCompare(b.id));
    return JSON.stringify([items, [...(autoOff || [])].sort()]);
}

/** Есть ли несохранённые правки у загруженного персонажа. */
export function isDirty() {
    const c = loadedChar();
    if (!c) return false;
    const s = getSettings();
    return fingerprint(s.build, s.autoOff) !== fingerprint(c.build, c.autoOff);
}

/** Путь к обложке: выбранное превью или последнее, нарисованное с этим персонажем. */
export function coverPath(c) {
    const previews = getSettings().previews;
    const chosen = c.coverId && previews.find((p) => p.id === c.coverId);
    if (chosen) return chosen.path;
    return previews.find((p) => p.charId === c.id)?.path || null;
}

function saveNew(name) {
    const s = getSettings();
    const now = Date.now();
    const c = {
        id: makeId(),
        name: String(name || '').trim() || 'Без имени',
        build: cleanBuild(s.build),
        autoOff: [...s.autoOff],
        coverId: null,
        createdAt: now,
        updatedAt: now,
    };
    s.characters.unshift(c);
    s.loadedCharId = c.id;
    saveSettings();
    return c;
}

function updateLoaded() {
    const c = loadedChar();
    if (!c) return null;
    const s = getSettings();
    c.build = cleanBuild(s.build);
    c.autoOff = [...s.autoOff];
    c.updatedAt = Date.now();
    saveSettings();
    return c;
}

/** Загрузить: заменяет сборку целиком, ⟲ возвращает как было. */
export function loadCharacter(id) {
    const s = getSettings();
    const c = s.characters.find((x) => x.id === id);
    if (!c) return false;
    pushHistory();
    // Теги, которых больше нет в tags.txt, тихо выпадают
    s.build = cleanBuild(c.build).filter((b) => !db || db.tags.has(b.id));
    s.autoOff = [...(c.autoOff || [])];
    s.loadedCharId = c.id;
    saveSettings();
    return true;
}

export function unloadCharacter() {
    getSettings().loadedCharId = null;
    saveSettings();
}

/** «Сделать обложкой» для загруженного персонажа. */
export function setCover(previewId) {
    const c = loadedChar();
    if (!c) return false;
    c.coverId = previewId;
    saveSettings();
    return true;
}

// ---------- Шапка панели: кнопки и строка «Персонаж: …» ----------

export function headButtonsHtml() {
    return `
        <span class="chm-head-btns">
            <button type="button" class="chm-icon-btn chm-char-save" title="Сохранить персонажа"><i class="fa-solid fa-floppy-disk"></i></button>
            <button type="button" class="chm-head-pill chm-char-list" title="Мои персонажи"><i class="fa-solid fa-user-group"></i> <span class="chm-char-count"></span></button>
        </span>`;
}

function barHtml() {
    const c = loadedChar();
    let html = '';
    if (c) {
        const dirty = isDirty();
        html += `
            <div class="chm-char-line">
                <span class="chm-char-label">Персонаж:</span>
                <b class="chm-char-name">${escapeHtml(c.name)}</b>
                ${dirty ? '<span class="chm-dirty" title="Есть несохранённые правки">●</span>' : ''}
                <button type="button" class="chm-icon-btn chm-char-unload" title="Выгрузить — сборка останется, просто без имени"><i class="fa-solid fa-xmark"></i></button>
            </div>`;
    }
    if (saveOpen) {
        if (c) {
            html += `
                <div class="chm-save-row">
                    <button type="button" class="chm-btn chm-btn-accent chm-save-update"><i class="fa-solid fa-floppy-disk"></i> Обновить «${escapeHtml(c.name)}»</button>
                    <button type="button" class="chm-btn chm-save-asnew">Сохранить как нового</button>
                    <button type="button" class="chm-icon-btn chm-save-cancel" title="Отмена"><i class="fa-solid fa-xmark"></i></button>
                </div>`;
        } else {
            html += `
                <div class="chm-save-row">
                    <input type="text" class="text_pole chm-save-name" placeholder="Имя персонажа" maxlength="80" spellcheck="false">
                    <button type="button" class="chm-btn chm-btn-accent chm-save-go">Сохранить</button>
                    <button type="button" class="chm-icon-btn chm-save-cancel" title="Отмена"><i class="fa-solid fa-xmark"></i></button>
                </div>`;
        }
    }
    return html;
}

let panelRoot = null;

/** Перерисовать строку персонажа и счётчик (зовётся из renderPanel). */
export function renderCharBar() {
    if (!panelRoot) return;
    const bar = panelRoot.querySelector('.chm-char-bar');
    if (!bar) return;
    // Не перерисовываем строку с полем имени, пока в нём печатают
    const typing = bar.querySelector('.chm-save-name');
    const typed = typing?.value;
    bar.innerHTML = barHtml();
    bar.hidden = !bar.innerHTML.trim();
    const input = bar.querySelector('.chm-save-name');
    if (input && typed !== undefined) input.value = typed;
    const n = getSettings().characters.length;
    const count = panelRoot.querySelector('.chm-char-count');
    if (count) count.textContent = n ? String(n) : '';
}

function openSaveRow() {
    saveOpen = true;
    renderCharBar();
    panelRoot.querySelector('.chm-save-name')?.focus({ preventScroll: true });
}

function closeSaveRow() {
    saveOpen = false;
    renderCharBar();
}

function doSaveNew(name) {
    if (!getSettings().build.length) {
        toast('Сохранять нечего — сборка пустая.');
        return;
    }
    const c = saveNew(name);
    closeSaveRow();
    onChange({ chars: true });
    toast(`«${c.name}» сохранён`);
}

function onPanelClick(e) {
    if (e.target.closest('.chm-char-list')) {
        openList();
        return;
    }
    if (e.target.closest('.chm-char-save')) {
        if (saveOpen) closeSaveRow();
        else openSaveRow();
        return;
    }
    if (e.target.closest('.chm-save-cancel')) {
        closeSaveRow();
        return;
    }
    if (e.target.closest('.chm-save-go')) {
        doSaveNew(panelRoot.querySelector('.chm-save-name')?.value);
        return;
    }
    if (e.target.closest('.chm-save-asnew')) {
        // Загруженный есть — «как нового» спрашивает имя
        getSettings().loadedCharId = null;
        saveSettings();
        openSaveRow();
        return;
    }
    if (e.target.closest('.chm-save-update')) {
        const c = updateLoaded();
        closeSaveRow();
        onChange({ chars: true });
        if (c) toast(`«${c.name}» обновлён`);
        return;
    }
    if (e.target.closest('.chm-char-unload')) {
        unloadCharacter();
        closeSaveRow();
        onChange({ chars: true });
    }
}

function onPanelKey(e) {
    const input = e.target.closest('.chm-save-name');
    if (!input) return;
    if (e.key === 'Enter') {
        e.preventDefault();
        doSaveNew(input.value);
    } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeSaveRow();
    }
}

// ---------- Окошко «Мои персонажи» ----------

function fmtDate(ts) {
    try {
        return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    } catch {
        return '';
    }
}

function cardHtml(c) {
    const cover = coverPath(c);
    const loaded = getSettings().loadedCharId === c.id;
    const n = c.build.filter((b) => !db || db.tags.has(b.id)).length;
    return `
        <div class="chm-cc${loaded ? ' chm-cc-loaded' : ''}" data-id="${escapeHtml(c.id)}">
            <div class="chm-cc-cover">${cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy">` : '<i class="fa-solid fa-dragon"></i>'}</div>
            <div class="chm-cc-body">
                <div class="chm-cc-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>
                <div class="chm-cc-meta">${n} тег. · ${escapeHtml(fmtDate(c.updatedAt || c.createdAt))}${loaded ? ' · загружен' : ''}</div>
                <div class="chm-cc-btns">
                    <button type="button" class="chm-btn chm-btn-accent chm-cc-load">Загрузить</button>
                    <button type="button" class="chm-icon-btn chm-cc-rename" title="Переименовать"><i class="fa-solid fa-pen"></i></button>
                    <button type="button" class="chm-icon-btn chm-cc-del" title="Удалить персонажа (превью останутся)"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        </div>`;
}

function listHtml() {
    const all = getSettings().characters;
    if (!all.length) {
        return '<div class="chm-prompt-empty">// пока никого. Собери персонажа и нажми 💾 в шапке справа.</div>';
    }
    const q = query.trim().toLowerCase();
    const list = q ? all.filter((c) => c.name.toLowerCase().includes(q)) : all;
    if (!list.length) return '<div class="chm-prompt-empty">// никого с таким именем</div>';
    return `<div class="chm-cc-grid">${list.map(cardHtml).join('')}</div>`;
}

function modal() {
    return document.querySelector('#chm-overlay .chm-chars-modal');
}

function renderList() {
    const m = modal();
    if (!m) return;
    m.querySelector('.chm-chars-list').innerHTML = listHtml();
    m.querySelector('.chm-modal-count').textContent = getSettings().characters.length || '';
}

export function openList() {
    const win = document.querySelector('#chm-overlay .chm-window');
    if (!win || modal()) return;
    query = '';
    const wrap = document.createElement('div');
    wrap.className = 'chm-modal-wrap chm-chars-modal';
    wrap.innerHTML = `
        <div class="chm-modal chm-modal-wide" role="dialog" aria-label="Мои персонажи">
            <div class="chm-modal-head">
                <span class="chm-modal-title"><i class="fa-solid fa-user-group"></i> Мои персонажи <span class="chm-modal-count"></span></span>
                <button type="button" class="chm-icon-btn chm-modal-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <label class="chm-search chm-chars-search">
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                <input type="search" class="chm-chars-q" placeholder="найти по имени" autocomplete="off" spellcheck="false">
            </label>
            <div class="chm-chars-list"></div>
        </div>`;
    win.appendChild(wrap);
    renderList();

    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) wrap.remove(); });
    wrap.querySelector('.chm-chars-q').addEventListener('input', (e) => {
        query = e.target.value;
        renderList();
    });
    wrap.addEventListener('click', onListClick);
    wrap.addEventListener('keydown', onListKey);
}

function armConfirm(btn, html, idle) {
    btn.dataset.confirm = '1';
    btn.classList.add('chm-danger');
    btn.innerHTML = html;
    setTimeout(() => {
        if (!btn.isConnected) return;
        btn.dataset.confirm = '';
        btn.classList.remove('chm-danger');
        btn.innerHTML = idle;
    }, 3500);
}

function onListClick(e) {
    if (e.target.closest('.chm-modal-close')) {
        modal()?.remove();
        return;
    }
    const card = e.target.closest('.chm-cc');
    if (!card) return;
    const s = getSettings();
    const c = s.characters.find((x) => x.id === card.dataset.id);
    if (!c) return;

    const load = e.target.closest('.chm-cc-load');
    if (load) {
        const cur = loadedChar();
        if (cur && isDirty() && load.dataset.confirm !== '1') {
            armConfirm(load, `Точно? Правки «${escapeHtml(cur.name)}» не сохранены`, 'Загрузить');
            return;
        }
        loadCharacter(c.id);
        modal()?.remove();
        onChange({ chars: true, random: true });
        toast(`Загружен «${c.name}» · ⟲ вернёт прошлую сборку`);
        return;
    }
    const del = e.target.closest('.chm-cc-del');
    if (del) {
        if (del.dataset.confirm !== '1') {
            armConfirm(del, '<i class="fa-solid fa-trash"></i> Точно?', '<i class="fa-solid fa-trash"></i>');
            return;
        }
        s.characters = s.characters.filter((x) => x.id !== c.id);
        if (s.loadedCharId === c.id) s.loadedCharId = null;
        saveSettings();
        renderList();
        onChange({ chars: true });
        return;
    }
    if (e.target.closest('.chm-cc-rename')) {
        const nameEl = card.querySelector('.chm-cc-name');
        nameEl.innerHTML = `<input type="text" class="text_pole chm-cc-rename-input" value="${escapeHtml(c.name)}" maxlength="80" spellcheck="false">`;
        const input = nameEl.querySelector('input');
        input.focus({ preventScroll: true });
        input.select();
        input.addEventListener('blur', () => commitRename(c.id, input.value), { once: true });
    }
}

function commitRename(id, value) {
    const c = getSettings().characters.find((x) => x.id === id);
    if (c) {
        const name = String(value || '').trim();
        if (name) {
            c.name = name;
            saveSettings();
        }
    }
    renderList();
    onChange({ chars: true });
}

function onListKey(e) {
    const input = e.target.closest('.chm-cc-rename-input');
    if (!input) return;
    if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
    } else if (e.key === 'Escape') {
        // Отмена переименования: старое имя вернётся при перерисовке
        e.preventDefault();
        e.stopPropagation();
        input.value = '';
        input.blur();
    }
}

// ---------- Запуск ----------

/**
 * @param {HTMLElement} panel — правая колонка (в ней .chm-char-bar и кнопки в шапке)
 * @param {object} database
 * @param {(opts) => void} changed
 */
export function initCharacters(panel, database, changed) {
    panelRoot = panel;
    db = database;
    onChange = changed || (() => {});
    panel.addEventListener('click', onPanelClick);
    panel.addEventListener('keydown', onPanelKey);
    // Персонаж мог быть удалён в прошлой сессии
    const s = getSettings();
    if (s.loadedCharId && !s.characters.some((c) => c.id === s.loadedCharId)) {
        s.loadedCharId = null;
        saveSettings();
    }
    renderCharBar();
}
