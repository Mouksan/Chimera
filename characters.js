// Chimera — «Мои персонажи»: сохранить сборку под именем, загрузить, изменить, удалить.
// Персонаж хранит теги каталога (с весами, цветами и закрепами), снятые «само»,
// свои готовые теги и пол; негатив и custom остаются общими.
// Картинки привязываются к персонажам списком charIds у превью: сами — при генерации
// с загруженным персонажем, руками — в крупном просмотре.

import { getSettings, saveSettings, escapeHtml, makeId } from './store.js';
import { pushHistory } from './random.js';
import { currentGender } from './builder.js';
import { toast } from './notice.js';

let db = null;
let onChange = () => {};
let saveOpen = false;        // открыта ли строка «имя + Сохранить» в шапке
let query = '';
let showGallery = () => {};

export const GENDERS = [
    { key: 'm', icon: '♂', label: 'парень' },
    { key: 'f', icon: '♀', label: 'девушка' },
    { key: 'x', icon: '⚥', label: 'футанари' },
    { key: '', icon: '', label: 'не указан' },
];

// Её персонажи из генератора поз — теги оттуда как есть
const SEEDS = [
    { name: 'Се Юэ', gender: 'm', ownTags: 'xie yue, tall adult male, long loose blue-black hair, red eyes, athletic build' },
    { name: 'Гу Юньси', gender: 'm', ownTags: 'gu yunxi, adult androgynous man, long white hair, white silk blindfold, pale skin' },
    { name: 'Адриан', gender: 'm', ownTags: 'hadrian vaelmont, wolf demi-human alpha, short silver-gray hair, gray eyes, wolf ears, wolf tail, tall muscular' },
    { name: 'Вейн', gender: 'm', ownTags: 'veyne of arvath, hare demi-human omega, long wavy crimson hair, kohl-lined silver eyes, white hare ears, ruby choker' },
];

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
function fingerprint(build, autoOff, ownTags) {
    const items = cleanBuild(build).sort((a, b) => a.id.localeCompare(b.id));
    return JSON.stringify([items, [...(autoOff || [])].sort(), String(ownTags || '').trim()]);
}

/** Есть ли несохранённые правки у загруженного персонажа. */
export function isDirty() {
    const c = loadedChar();
    if (!c) return false;
    const s = getSettings();
    return fingerprint(s.build, s.autoOff, s.ownTags) !== fingerprint(c.build, c.autoOff, c.ownTags);
}

/** Путь к обложке: выбранное превью или последнее, нарисованное с этим персонажем. */
export function coverPath(c) {
    const previews = getSettings().previews;
    const chosen = c.coverId && previews.find((p) => p.id === c.coverId);
    if (chosen) return chosen.path;
    return previews.find((p) => p.charIds?.includes(c.id))?.path || null;
}

/** Картинки персонажа — новые первыми. */
export function picsOf(c) {
    return getSettings().previews.filter((p) => p.charIds?.includes(c.id));
}

/** Пол из сборки: тег пола в каталоге главнее, футанари поверх «женского» не сбиваем. */
function deriveGender(build, prev = '') {
    const g = db ? currentGender(db, build) : null;
    if (g === 'm') return 'm';
    if (g === 'f') return prev === 'x' ? 'x' : 'f';
    return prev || '';
}

function saveNew(name) {
    const s = getSettings();
    const now = Date.now();
    const c = {
        id: makeId(),
        name: String(name || '').trim() || 'Без имени',
        build: cleanBuild(s.build),
        autoOff: [...s.autoOff],
        ownTags: String(s.ownTags || '').trim(),
        gender: deriveGender(s.build),
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
    c.ownTags = String(s.ownTags || '').trim();
    c.gender = deriveGender(s.build, c.gender);
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
    s.ownTags = c.ownTags || '';
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
    // Обложка — заодно и картинка этого персонажа
    const p = getSettings().previews.find((x) => x.id === previewId);
    if (p && !p.charIds?.includes(c.id)) p.charIds = [...(p.charIds || []), c.id];
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
    const s = getSettings();
    if (!s.build.length && !String(s.ownTags || '').trim()) {
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

let view = 'list';           // 'list' | 'edit'
let editId = null;           // кого правим (null — новый из текста)
let draft = null;            // { name, gender, ownTags, coverId }

function fmtDate(ts) {
    try {
        return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    } catch {
        return '';
    }
}

function genderIcon(g) {
    const x = GENDERS.find((v) => v.key === g && v.key);
    return x ? `<span class="chm-cc-gender" title="${escapeHtml(x.label)}">${x.icon}</span>` : '';
}

function cardHtml(c) {
    const cover = coverPath(c);
    const loaded = getSettings().loadedCharId === c.id;
    const n = c.build.filter((b) => !db || db.tags.has(b.id)).length;
    const own = String(c.ownTags || '').trim();
    const pics = picsOf(c).length;
    const tags = n ? `${n} тег.${own ? ' + свои' : ''}` : (own ? 'свои теги' : '0 тег.');
    return `
        <div class="chm-cc${loaded ? ' chm-cc-loaded' : ''}" data-id="${escapeHtml(c.id)}">
            <div class="chm-cc-cover">${cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy">` : '<i class="fa-solid fa-dragon"></i>'}</div>
            <div class="chm-cc-body">
                <div class="chm-cc-name" title="${escapeHtml(c.name)}">${genderIcon(c.gender)}${escapeHtml(c.name)}</div>
                <div class="chm-cc-meta">
                    ${escapeHtml(tags)} · ${escapeHtml(fmtDate(c.updatedAt || c.createdAt))}${loaded ? ' · загружен' : ''}
                    ${pics ? `<button type="button" class="chm-cc-pics" title="Открыть галерею персонажа"><i class="fa-regular fa-images"></i> ${pics}</button>` : ''}
                </div>
                <div class="chm-cc-btns">
                    <button type="button" class="chm-btn chm-btn-accent chm-cc-load">Загрузить</button>
                    <button type="button" class="chm-icon-btn chm-cc-edit" title="Изменить: имя, пол, свои теги, обложка"><i class="fa-solid fa-pen"></i></button>
                    <button type="button" class="chm-icon-btn chm-cc-del" title="Удалить персонажа (превью останутся)"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        </div>`;
}

function missingSeeds() {
    const names = new Set(getSettings().characters.map((c) => c.name.trim().toLowerCase()));
    return SEEDS.filter((x) => !names.has(x.name.toLowerCase()));
}

function listHtml() {
    const all = getSettings().characters;
    if (!all.length) {
        return '<div class="chm-prompt-empty">// пока никого. Собери персонажа и нажми 💾 в шапке справа — или «Новый из текста».</div>';
    }
    const q = query.trim().toLowerCase();
    const list = q ? all.filter((c) => c.name.toLowerCase().includes(q)) : all;
    if (!list.length) return '<div class="chm-prompt-empty">// никого с таким именем</div>';
    return `<div class="chm-cc-grid">${list.map(cardHtml).join('')}</div>`;
}

function listViewHtml() {
    const seeds = missingSeeds();
    return `
        <div class="chm-modal-head">
            <span class="chm-modal-title"><i class="fa-solid fa-user-group"></i> Мои персонажи <span class="chm-modal-count">${getSettings().characters.length || ''}</span></span>
            <button type="button" class="chm-icon-btn chm-modal-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="chm-chars-tools">
            <label class="chm-search chm-chars-search">
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                <input type="search" class="chm-chars-q" placeholder="найти по имени" autocomplete="off" spellcheck="false" value="${escapeHtml(query)}">
            </label>
            <button type="button" class="chm-btn chm-chars-new" title="Персонаж из своих готовых тегов, без каталога"><i class="fa-solid fa-paste"></i> Новый из текста</button>
            ${seeds.length ? `<button type="button" class="chm-btn chm-chars-seed" title="${escapeHtml(seeds.map((x) => x.name).join(', '))} — с тегами из генератора поз"><i class="fa-solid fa-user-plus"></i> Мои из генератора поз</button>` : ''}
        </div>
        <div class="chm-chars-list">${listHtml()}</div>`;
}

function editViewHtml() {
    const s = getSettings();
    const c = editId ? s.characters.find((x) => x.id === editId) : null;
    const d = draft;
    const catalog = c ? c.build.map((b) => db?.tags.get(b.id)).filter(Boolean) : [];
    const buildHasGender = c && db && currentGender(db, c.build);
    const pics = c ? picsOf(c) : [];
    const genderSeg = GENDERS.map((g) => `<button type="button" class="chm-seg-btn${d.gender === g.key ? ' chm-active' : ''}" data-gender="${g.key}">${g.icon ? `${g.icon} ` : ''}${g.label}</button>`).join('');

    let coverBlock = '';
    if (c) {
        coverBlock = pics.length
            ? `<div class="chm-ed-covers">
                    <button type="button" class="chm-ed-cover chm-ed-cover-auto${!d.coverId ? ' chm-active' : ''}" data-cover="" title="Последняя картинка персонажа"><span>авто</span></button>
                    ${pics.map((p) => `<button type="button" class="chm-ed-cover${d.coverId === p.id ? ' chm-active' : ''}" data-cover="${escapeHtml(p.id)}"><img src="${escapeHtml(p.path)}" alt="" loading="lazy"></button>`).join('')}
               </div>`
            : '<div class="chm-prompt-empty">// картинок пока нет — нарисуй с загруженным персонажем или привяжи в крупном просмотре</div>';
    }

    return `
        <div class="chm-modal-head">
            <button type="button" class="chm-icon-btn chm-ed-back" title="К списку"><i class="fa-solid fa-arrow-left"></i></button>
            <span class="chm-modal-title">${c ? `Изменить «${escapeHtml(c.name)}»` : 'Новый персонаж из текста'}</span>
            <button type="button" class="chm-icon-btn chm-modal-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="chm-ed">
            <label class="chm-ed-field">
                <span class="chm-mono-label">имя</span>
                <input type="text" class="text_pole chm-ed-name" maxlength="80" spellcheck="false" placeholder="Имя персонажа" value="${escapeHtml(d.name)}">
            </label>
            <div class="chm-ed-field">
                <span class="chm-mono-label">пол</span>
                <div class="chm-seg chm-ed-gender" role="radiogroup">${genderSeg}</div>
                ${buildHasGender ? '<span class="chm-set-hint">В сборке есть тег пола — при «Обновить» из конструктора пол возьмётся оттуда (футанари поверх «женского» сохранится).</span>' : '<span class="chm-set-hint">Если в сборке нет тега пола, он сам встанет в начало промта: 1boy, 1girl или 1girl, futanari.</span>'}
            </div>
            <label class="chm-ed-field">
                <span class="chm-mono-label">свои теги</span>
                <textarea class="text_pole chm-ed-own" rows="4" spellcheck="false" placeholder="xie yue, long loose blue-black hair, red eyes, ...">${escapeHtml(d.ownTags)}</textarea>
                <span class="chm-set-hint">Вставь свои готовые теги через запятую — они допишутся к тегам из каталога.</span>
            </label>
            ${c ? `
            <div class="chm-ed-field">
                <span class="chm-mono-label">теги из каталога · ${catalog.length}</span>
                ${catalog.length
                    ? `<div class="chm-ed-chips">${catalog.map((t) => `<span class="chm-ed-chip">${escapeHtml(t.ru)}</span>`).join('')}</div>`
                    : '<div class="chm-prompt-empty">// нет — персонаж только из своих тегов</div>'}
                <span class="chm-set-hint">Меняются в конструкторе: «Загрузить» → правишь → 💾 «Обновить».</span>
            </div>
            <div class="chm-ed-field">
                <span class="chm-mono-label">обложка</span>
                ${coverBlock}
            </div>` : ''}
        </div>
        <div class="chm-ed-foot">
            <button type="button" class="chm-btn chm-ed-cancel">Отмена</button>
            <button type="button" class="chm-btn chm-btn-accent chm-ed-save"><i class="fa-solid fa-floppy-disk"></i> Сохранить</button>
        </div>`;
}

function modal() {
    return document.querySelector('#chm-overlay .chm-chars-modal');
}

function renderModal() {
    const m = modal();
    if (!m) return;
    const box = m.querySelector('.chm-modal');
    // Поле поиска не теряет фокус при перерисовке списка
    if (view === 'list' && box.querySelector('.chm-chars-list')) {
        box.querySelector('.chm-chars-list').innerHTML = listHtml();
        box.querySelector('.chm-modal-count').textContent = getSettings().characters.length || '';
        return;
    }
    box.innerHTML = view === 'edit' ? editViewHtml() : listViewHtml();
    box.classList.toggle('chm-chars-editing', view === 'edit');
}

function showList() {
    view = 'list';
    editId = null;
    draft = null;
    const box = modal()?.querySelector('.chm-modal');
    if (box) {
        box.innerHTML = listViewHtml();
        box.classList.remove('chm-chars-editing');
    }
}

function showEditor(id) {
    const c = id ? getSettings().characters.find((x) => x.id === id) : null;
    view = 'edit';
    editId = c?.id || null;
    draft = {
        name: c?.name || '',
        gender: c?.gender || '',
        ownTags: c?.ownTags || '',
        coverId: c?.coverId || null,
    };
    renderModal();
    const box = modal()?.querySelector('.chm-modal');
    box?.scrollTo?.(0, 0);
    box?.querySelector(c ? '.chm-ed-own' : '.chm-ed-name')?.focus({ preventScroll: true });
}

export function openList() {
    const win = document.querySelector('#chm-overlay .chm-window');
    if (!win || modal()) return;
    query = '';
    view = 'list';
    const wrap = document.createElement('div');
    wrap.className = 'chm-modal-wrap chm-chars-modal';
    wrap.innerHTML = '<div class="chm-modal chm-modal-wide" role="dialog" aria-label="Мои персонажи"></div>';
    win.appendChild(wrap);
    showList();

    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) wrap.remove(); });
    wrap.addEventListener('input', onModalInput);
    wrap.addEventListener('click', onModalClick);
    wrap.addEventListener('keydown', onModalKey);
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

function onModalInput(e) {
    if (e.target.closest('.chm-chars-q')) {
        query = e.target.value;
        renderModal();
        return;
    }
    if (!draft) return;
    if (e.target.closest('.chm-ed-name')) draft.name = e.target.value;
    else if (e.target.closest('.chm-ed-own')) draft.ownTags = e.target.value;
}

function addSeeds() {
    const s = getSettings();
    const add = missingSeeds();
    if (!add.length) return;
    const now = Date.now();
    // Сверху в том же порядке, что в генераторе
    const made = add.map((x, i) => ({
        id: makeId(),
        name: x.name,
        build: [],
        autoOff: [],
        ownTags: x.ownTags,
        gender: x.gender,
        coverId: null,
        createdAt: now - i,
        updatedAt: now - i,
    }));
    s.characters.unshift(...made);
    saveSettings();
    showList();
    onChange({ chars: true });
    toast(`Добавлены: ${add.map((x) => x.name).join(', ')}`);
}

function saveDraft() {
    const s = getSettings();
    const name = String(draft.name || '').trim() || 'Без имени';
    const ownTags = String(draft.ownTags || '').trim();
    if (!editId) {
        if (!ownTags) {
            toast('Вставь хотя бы один тег.');
            modal()?.querySelector('.chm-ed-own')?.focus({ preventScroll: true });
            return;
        }
        const now = Date.now();
        s.characters.unshift({
            id: makeId(), name, build: [], autoOff: [], ownTags, gender: draft.gender || '',
            coverId: null, createdAt: now, updatedAt: now,
        });
        saveSettings();
        showList();
        onChange({ chars: true });
        toast(`«${name}» создан — жми «Загрузить»`);
        return;
    }
    const c = s.characters.find((x) => x.id === editId);
    if (!c) {
        showList();
        return;
    }
    c.name = name;
    c.gender = draft.gender || '';
    c.ownTags = ownTags;
    c.coverId = draft.coverId || null;
    c.updatedAt = Date.now();
    // Правим загруженного — его свои теги в конструкторе тоже обновляются
    if (s.loadedCharId === c.id) s.ownTags = ownTags;
    saveSettings();
    showList();
    onChange({ chars: true });
    toast(`«${name}» сохранён`);
}

function onModalClick(e) {
    if (e.target.closest('.chm-modal-close')) {
        modal()?.remove();
        return;
    }
    if (view === 'edit') {
        onEditClick(e);
        return;
    }
    if (e.target.closest('.chm-chars-new')) {
        showEditor(null);
        return;
    }
    if (e.target.closest('.chm-chars-seed')) {
        addSeeds();
        return;
    }
    const card = e.target.closest('.chm-cc');
    if (!card) return;
    const s = getSettings();
    const c = s.characters.find((x) => x.id === card.dataset.id);
    if (!c) return;

    if (e.target.closest('.chm-cc-pics')) {
        modal()?.remove();
        showGallery(c.id);
        return;
    }
    if (e.target.closest('.chm-cc-edit')) {
        showEditor(c.id);
        return;
    }
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
        // Картинки остаются, просто без этого персонажа
        for (const p of s.previews) {
            if (p.charIds?.includes(c.id)) p.charIds = p.charIds.filter((x) => x !== c.id);
        }
        saveSettings();
        showList();
        onChange({ chars: true });
    }
}

function onEditClick(e) {
    if (e.target.closest('.chm-ed-back') || e.target.closest('.chm-ed-cancel')) {
        showList();
        return;
    }
    if (e.target.closest('.chm-ed-save')) {
        saveDraft();
        return;
    }
    const g = e.target.closest('[data-gender]');
    if (g) {
        draft.gender = g.dataset.gender;
        modal().querySelectorAll('[data-gender]').forEach((b) => b.classList.toggle('chm-active', b === g));
        return;
    }
    const cover = e.target.closest('[data-cover]');
    if (cover) {
        draft.coverId = cover.dataset.cover || null;
        modal().querySelectorAll('[data-cover]').forEach((b) => b.classList.toggle('chm-active', b === cover));
    }
}

function onModalKey(e) {
    if (view !== 'edit') return;
    if (e.key === 'Escape') {
        // Esc в редакторе — назад к списку, а не закрыть всё
        e.preventDefault();
        e.stopPropagation();
        showList();
        return;
    }
    if (e.key === 'Enter' && e.target.closest('.chm-ed-name')) {
        e.preventDefault();
        saveDraft();
    }
}

// ---------- Запуск ----------

/**
 * @param {HTMLElement} panel — правая колонка (в ней .chm-char-bar и кнопки в шапке)
 * @param {object} database
 * @param {(opts) => void} changed
 * @param {{ showGallery?: (charId: string) => void }} extra
 */
export function initCharacters(panel, database, changed, extra = {}) {
    panelRoot = panel;
    db = database;
    onChange = changed || (() => {});
    showGallery = extra.showGallery || (() => {});
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
