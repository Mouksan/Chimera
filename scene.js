// Chimera — режим «Сцена» (этап 2): позы, место, ракурс, детали → промт сцены.
// Каталоги — data/scene.json (порт из генератора поз; её сюжетные позы с готовыми персонажами не переносим),
// грузятся только когда режим «Сцена» открыт. Тумблер «Сцена 18+» — в настройках, по умолчанию выключено.
//
// На этом этапе слотов персонажей ещё нет: промт склеенный (как у генератора подруги, но без `source#` /
// `target#` — они нужны только разбивке по персонажам на этапе 4). Генерация идёт тем же блоком, что и в режиме «Персонаж».
// Безопасность (safety.js) вшита: adult в каждом блоке, анти-детские теги в негативе, вычистка тегов про возраст.

import { getSettings, saveSettings, escapeHtml } from './store.js';
import { ADULT_TAG, ANTI_CHILD_NEG, stripUnsafeTags, withSafeNegative } from './safety.js';

// ---------- Режимы окна ----------

export const MODES = Object.freeze([
    { id: 'character', label: 'Персонаж', icon: 'fa-user' },
    { id: 'scene', label: 'Сцена', icon: 'fa-film' },
    // сюда же потом встанет «Гардероб»: одна строка + её экран
]);

export function sceneEnabled() {
    return Boolean(getSettings().sceneEnabled);
}

/** Режимы, доступные сейчас (Сцена — только при включённом тумблере). */
export function availableModes() {
    return MODES.filter((m) => m.id === 'character' || (m.id === 'scene' && sceneEnabled()));
}

export function currentMode() {
    const s = getSettings();
    return s.sceneEnabled && s.mode === 'scene' ? 'scene' : 'character';
}

export function sceneModeOn() {
    return currentMode() === 'scene';
}

export function setMode(id) {
    const s = getSettings();
    s.mode = id === 'scene' && s.sceneEnabled ? 'scene' : 'character';
    saveSettings();
}

// ---------- Данные ----------

const CATS = [
    { id: 'all', label: 'Все' },
    { id: 'rom', label: 'Романтика' },
    { id: 'solo', label: 'Соло' },
    { id: 'port', label: 'Портреты' },
    { id: 'story', label: 'Сюжеты' },
    { id: 'arch', label: 'Архив' },
];

const NO_PLACE_LABEL = 'как у позы (или спальня)';

let data = null;
let loading = null;

function normQuery(text) {
    return String(text || '').trim().toLowerCase().replace(/ё/g, 'е');
}

function prepare(raw) {
    if (!raw || !raw.poses || !raw.sets || !raw.shots || !raw.detGroups) throw new Error('scene.json: неожиданный формат');
    const names = Object.keys(raw.poses);
    const hay = new Map(names.map((n) => [n, normQuery(`${n} ${(raw.poses[n].sh || []).join(' ')}`)]));
    const counts = { all: names.length };
    for (const n of names) {
        const c = raw.poses[n].c;
        counts[c] = (counts[c] || 0) + 1;
    }
    return {
        ...raw,
        names,
        hay,
        counts,
        detAll: new Set(Object.values(raw.detGroups).flat()),
        firstSet: Object.keys(raw.sets)[0],
        firstShot: Object.keys(raw.shots)[0],
    };
}

/** Загрузить каталоги один раз за сессию. */
export async function loadSceneData() {
    if (data) return data;
    if (!loading) {
        loading = (async () => {
            const res = await fetch(new URL('./data/scene.json', import.meta.url), { cache: 'no-cache' });
            if (!res.ok) throw new Error(`scene.json: HTTP ${res.status}`);
            data = prepare(await res.json());
            return data;
        })().finally(() => {
            loading = null;
        });
    }
    return loading;
}

/** Привести сохранённый выбор в порядок: что-то могли убрать из каталога. */
function normalizeState() {
    const st = getSettings().scene;
    if (!CATS.some((c) => c.id === st.cat)) st.cat = 'all';
    if (!data.poses[st.pose]) {
        const first = data.names.find((n) => st.cat === 'all' || data.poses[n].c === st.cat);
        st.pose = first || data.names[0] || '';
    }
    if (st.place && !data.sets[st.place]) st.place = '';
    if (st.shot && !data.shots[st.shot]) st.shot = '';
    st.details = (st.details || []).filter((d) => data.detAll.has(d));
    if (typeof st.q !== 'string') st.q = '';
}

// ---------- Сборка промта ----------

function splitList(text) {
    return String(text || '').split(',').map((x) => x.trim()).filter(Boolean);
}

function bare(tag) {
    return String(tag).trim().replace(/^[\d.]+::/, '').replace(/::$/, '').toLowerCase();
}

/** Без повторов и без `source#…` / `target#…` / `mutual#…` (это для разбивки по персонажам, этап 4). */
function cleanTags(list) {
    const seen = new Set();
    const out = [];
    for (const raw of list) {
        const t = String(raw || '').trim();
        if (!t || t.includes('#')) continue;
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(t);
    }
    return out;
}

function emptyBuilt(s) {
    return {
        scene: true,
        parts: [],
        positive: '',
        negative: withSafeNegative(s.negative),
        negAlways: ANTI_CHILD_NEG,
        count: 0,
        own: [],
        charIds: [],       // на этапе 2 картинка сцены ни к кому не привязывается
        removed: 0,
        sceneInfo: null,
    };
}

/**
 * Собрать промт сцены по текущему выбору.
 * @returns {{ scene: true, parts: {key:string,label:string,tags:string[]}[], positive: string, negative: string,
 *             negAlways: readonly string[], count: number, own: [], charIds: [], removed: number, sceneInfo: object|null }}
 */
export function buildScene() {
    const s = getSettings();
    const st = s.scene;
    if (!data || !data.poses[st.pose]) return emptyBuilt(s);

    const a = data.poses[st.pose];
    const first = a.top || [];
    const second = a.bot || [];

    // Основа: сколько и кого на картинке
    let base;
    if (a.girls) base = ['2girls', 'yuri'];
    else if (a.one) base = ['1boy', 'solo', 'male focus', 'nsfw', 'explicit', 'uncensored'];
    else {
        base = a.third ? data.base.map((t) => (t === '2boys' ? '3boys' : t)) : data.base.slice();
        if (a.soft) base = base.filter((t) => t !== 'sex');
    }

    // Ракурс: «без кадра» — берём из позы
    const shotKey = st.shot && data.shots[st.shot] ? st.shot : data.firstShot;
    const shotRaw = data.shots[shotKey] || [];
    const shotTags = shotRaw.length ? shotRaw : (a.cam || []);

    // Место: выбранное руками перебивает место позы; не выбрано — место позы, а если его нет — спальня
    const placeTags = st.place && data.sets[st.place]
        ? data.sets[st.place]
        : (a.place && a.place.length ? a.place : (data.sets[data.firstSet] || []));

    const details = (st.details || []).filter((d) => data.detAll.has(d));

    const single = Boolean(a.one) || (!second.length && !a.third);
    const raw = [
        { key: 'common', label: 'общее', tags: [...base, ...shotTags, ...details] },
        // действие и место уходят в блок активного (как в рабочем промпте подруги)
        { key: 'a', label: single ? 'персонаж' : 'актив (source)', tags: [ADULT_TAG, ...(a.sh || []), ...first, ...placeTags] },
    ];
    if (!single) raw.push({ key: 'b', label: 'пассив (target)', tags: [ADULT_TAG, ...second] });
    if (a.third) raw.push({ key: 'c', label: 'третий', tags: [ADULT_TAG, ...a.third] });

    let removed = 0;
    const parts = raw.map((p) => {
        const safe = stripUnsafeTags(cleanTags(p.tags));
        removed += safe.removed;
        return { key: p.key, label: p.label, tags: safe.tags };
    });

    // Склеенный промт: повторы между блоками выкидываем (в блоках они остаются — пригодятся этапу 4)
    const seen = new Set();
    const flat = [];
    for (const p of parts) {
        for (const t of p.tags) {
            const k = t.toLowerCase();
            if (seen.has(k)) continue;
            seen.add(k);
            flat.push(t);
        }
    }

    const plus = new Set(flat.map(bare));
    const negKept = splitList(s.negative).filter((t) => !plus.has(bare(t)));

    return {
        scene: true,
        parts,
        positive: flat.join(', '),
        negative: withSafeNegative(negKept.join(', ')),
        negAlways: ANTI_CHILD_NEG,
        count: flat.length,
        own: [],
        charIds: [],
        removed,
        sceneInfo: { pose: st.pose, place: st.place || '', shot: st.shot || '', details },
    };
}

/** Для блока генерации: промт сцены. */
export function currentSceneBuilt() {
    return buildScene();
}

// ---------- Экран режима ----------

let col = null;       // левая колонка: выбор позы, места, ракурса, деталей
let side = null;      // кусок правой колонки: промт сцены
let onSceneChange = () => {};
let renderedOnce = false;

function st() {
    return getSettings().scene;
}

function filteredPoses() {
    const { cat, q } = st();
    const query = normQuery(q);
    return data.names.filter((n) => (cat === 'all' || data.poses[n].c === cat) && (!query || data.hay.get(n).includes(query)));
}

function poseButton(name) {
    const a = data.poses[name];
    const badge = a.third ? '<span class="chm-pose-badge">3 перс.</span>' : (a.one ? '<span class="chm-pose-badge">соло</span>' : '');
    const on = name === st().pose;
    return `<button type="button" class="chm-pose${on ? ' chm-active' : ''}" data-pose="${escapeHtml(name)}" role="option" aria-selected="${on}"><span class="chm-pose-name">${escapeHtml(name)}</span>${badge}</button>`;
}

function renderPoseList() {
    if (!col) return;
    const list = filteredPoses();
    const box = col.querySelector('.chm-scene-poses');
    box.innerHTML = list.map(poseButton).join('') || '<div class="chm-prompt-empty">// ничего не нашла — попробуй короче или по-английски</div>';
    const total = data.counts[st().cat] ?? data.names.length;
    col.querySelector('.chm-scene-shown').textContent = list.length === total ? `${total}` : `${list.length} из ${total}`;
    const active = box.querySelector('.chm-pose.chm-active');
    if (active) active.scrollIntoView({ block: 'nearest' });
}

function placeOptions() {
    const cur = st().place;
    return `<option value="">${NO_PLACE_LABEL}</option>`
        + Object.keys(data.sets).map((k) => `<option value="${escapeHtml(k)}" ${k === cur ? 'selected' : ''}>${escapeHtml(k)}</option>`).join('');
}

function shotOptions() {
    const cur = st().shot;
    return Object.keys(data.shots).map((k, i) => {
        const value = i === 0 ? '' : k;
        return `<option value="${escapeHtml(value)}" ${value === cur ? 'selected' : ''}>${escapeHtml(k)}</option>`;
    }).join('');
}

function detailsHtml() {
    const chosen = new Set(st().details);
    return Object.entries(data.detGroups).map(([group, list], i) => {
        const n = list.filter((d) => chosen.has(d)).length;
        return `
            <details class="chm-fold chm-scene-grp" ${i === 0 || n ? 'open' : ''} data-group="${escapeHtml(group)}">
                <summary class="chm-mono-label">${escapeHtml(group)} <span class="chm-scene-grp-n">${n || ''}</span></summary>
                <div class="chm-scene-chips">
                    ${list.map((d) => `<button type="button" class="chm-det${chosen.has(d) ? ' chm-active' : ''}" data-d="${escapeHtml(d)}" aria-pressed="${chosen.has(d)}">${escapeHtml(d)}</button>`).join('')}
                </div>
            </details>`;
    }).join('');
}

function colHtml() {
    const s = st();
    const cats = CATS.map((c) => `<button type="button" class="chm-chip chm-scene-cat${c.id === s.cat ? ' chm-active' : ''}" data-cat="${c.id}">${escapeHtml(c.label)} <span class="chm-scene-cat-n">${data.counts[c.id] || 0}</span></button>`).join('');
    return `
        <div class="chm-card chm-scene-block">
            <div class="chm-card-head"><i class="fa-solid fa-people-arrows"></i> Поза <span class="chm-scene-shown"></span></div>
            <label class="chm-search chm-scene-search">
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                <input type="search" class="chm-search-input chm-scene-q" placeholder="Найти позу…" autocomplete="off" spellcheck="false" value="${escapeHtml(s.q)}">
            </label>
            <div class="chm-scene-cats">${cats}</div>
            <div class="chm-scene-poses" role="listbox" aria-label="Поза"></div>
        </div>

        <div class="chm-card chm-scene-block">
            <div class="chm-card-head"><i class="fa-solid fa-location-dot"></i> Место</div>
            <select class="text_pole chm-scene-place">${placeOptions()}</select>
            <div class="chm-set-hint">«${NO_PLACE_LABEL}» — у многих поз есть своё место, оно и пойдёт в промт. Если выбрать место здесь, оно перебьёт место позы.</div>
            <div class="chm-card-head chm-scene-subhead"><i class="fa-solid fa-camera"></i> Ракурс</div>
            <select class="text_pole chm-scene-shot">${shotOptions()}</select>
        </div>

        <div class="chm-card chm-scene-block">
            <div class="chm-card-head"><i class="fa-solid fa-tags"></i> Детали</div>
            <div class="chm-scene-groups">${detailsHtml()}</div>
        </div>

        <div class="chm-scene-foot">
            <button type="button" class="chm-btn chm-scene-reset" title="Сбросить место, ракурс и детали (поза остаётся)"><i class="fa-solid fa-rotate-left"></i> Очистить</button>
        </div>`;
}

function partsHtml(built) {
    if (!built.parts.length) return '<span class="chm-prompt-empty">// выбери позу слева</span>';
    const comma = '<span class="chm-pcomma">, </span>';
    return built.parts.map((p) => `
        <div class="chm-scene-part">
            <div class="chm-scene-part-l">${escapeHtml(p.label)}</div>
            <div class="chm-prompt-text">${p.tags.map((t) => `<span class="chm-ptag">${escapeHtml(t)}</span>`).join(comma)}</div>
        </div>`).join('');
}

function sideHtml() {
    return `
        <div class="chm-scene-head">
            <span class="chm-panel-title">Сцена</span>
            <span class="chm-panel-count chm-scene-count">0 тег.</span>
        </div>
        <div class="chm-card chm-prompt-card">
            <div class="chm-mono-label">prompt.txt</div>
            <div class="chm-scene-parts"></div>
            <div class="chm-set-hint chm-scene-removed" hidden></div>
            <div class="chm-set-hint chm-scene-safe">Вшито и не отключается: в каждом блоке стоит adult, а в негатив при рисовании всегда добавляются ${escapeHtml(ANTI_CHILD_NEG.join(', '))}. Теги про возраст из промта вычищаются.</div>
        </div>`;
}

function renderSide() {
    if (!side) return;
    const built = buildScene();
    side.querySelector('.chm-scene-count').textContent = `${built.count} тег.`;
    side.querySelector('.chm-scene-parts').innerHTML = partsHtml(built);
    const removed = side.querySelector('.chm-scene-removed');
    removed.hidden = !built.removed;
    removed.textContent = built.removed ? `// убрала ${built.removed} тег. про возраст` : '';
}

function renderCol() {
    if (!col) return;
    col.innerHTML = colHtml();
    renderPoseList();
}

/** Подготовить экран: загрузить каталоги и нарисовать выбор и промт. Зовётся при входе в режим. */
export async function refreshScene() {
    if (!col) return;
    if (!data) col.innerHTML = '<div class="chm-stub chm-stub-big"><i class="fa-solid fa-spinner fa-spin"></i> Загружаю позы…</div>';
    try {
        await loadSceneData();
    } catch (error) {
        console.error('[Chimera] Не удалось загрузить каталог сцены', error);
        col.innerHTML = `<div class="chm-stub chm-stub-big">Не удалось загрузить каталог сцены.<br><small>${escapeHtml(error?.message || error)}</small></div>`;
        window.toastr?.error('Не удалось загрузить каталог сцены — подробности в консоли.', 'Chimera');
        return;
    }
    normalizeState();
    renderCol();
    renderSide();
    renderedOnce = true;
    onSceneChange();
}

// ---------- События ----------

function save() {
    saveSettings();
    renderSide();
    onSceneChange();
}

function onClick(e) {
    if (!data) return;
    const s = st();

    const cat = e.target.closest('[data-cat]');
    if (cat) {
        s.cat = cat.dataset.cat;
        col.querySelectorAll('.chm-scene-cat').forEach((b) => b.classList.toggle('chm-active', b === cat));
        const list = filteredPoses();
        if (list.length && !list.includes(s.pose)) s.pose = list[0];   // как у подруги: если позы нет в разделе, встаёт первая
        renderPoseList();
        save();
        return;
    }

    const pose = e.target.closest('.chm-pose');
    if (pose) {
        s.pose = pose.dataset.pose;
        col.querySelectorAll('.chm-pose').forEach((b) => {
            const on = b === pose;
            b.classList.toggle('chm-active', on);
            b.setAttribute('aria-selected', String(on));
        });
        save();
        return;
    }

    const det = e.target.closest('.chm-det');
    if (det) {
        const d = det.dataset.d;
        const set = new Set(s.details);
        if (set.has(d)) set.delete(d);
        else set.add(d);
        s.details = [...set];
        det.classList.toggle('chm-active', set.has(d));
        det.setAttribute('aria-pressed', String(set.has(d)));
        const grp = det.closest('.chm-scene-grp');
        const n = grp.querySelectorAll('.chm-det.chm-active').length;
        grp.querySelector('.chm-scene-grp-n').textContent = n || '';
        save();
        return;
    }

    if (e.target.closest('.chm-scene-reset')) {
        s.place = '';
        s.shot = '';
        s.details = [];
        renderCol();
        save();
    }
}

function onInput(e) {
    if (!data || !e.target.closest('.chm-scene-q')) return;
    st().q = e.target.value;
    renderPoseList();
    saveSettings();
}

function onChange(e) {
    if (!data) return;
    if (e.target.closest('.chm-scene-place')) {
        st().place = e.target.value;
        save();
    } else if (e.target.closest('.chm-scene-shot')) {
        st().shot = e.target.value;
        save();
    }
}

/** Быстрый поиск по позам: «/» в режиме «Сцена». */
export function focusPoseSearch() {
    col?.querySelector('.chm-scene-q')?.focus({ preventScroll: true });
}

/**
 * Встроить экран сцены в окно.
 * @param {HTMLElement} mainEl — .chm-main (там колонки)
 * @param {HTMLElement} panelEl — .chm-panel (правая колонка)
 * @param {{ onChange?: Function }} callbacks
 */
export function initScene(mainEl, panelEl, callbacks = {}) {
    onSceneChange = callbacks.onChange || (() => {});

    col = document.createElement('section');
    col.className = 'chm-col chm-scene-col';
    col.dataset.col = 'scene';
    mainEl.insertBefore(col, panelEl);
    col.addEventListener('click', onClick);
    col.addEventListener('input', onInput);
    col.addEventListener('change', onChange);

    side = document.createElement('div');
    side.className = 'chm-scene-side';
    side.innerHTML = sideHtml();
    const head = panelEl.querySelector('.chm-panel-head');
    if (head) head.after(side);
    else panelEl.prepend(side);
}

export function isSceneReady() {
    return renderedOnce;
}
