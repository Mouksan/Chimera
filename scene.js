// Chimera — режим «Сцена» (этапы 2–3): позы, место, ракурс, детали, слоты персонажей A/B/C → промт сцены.
// Каталоги — data/scene.json (порт из генератора поз; её сюжетные позы с готовыми персонажами не переносим),
// грузятся только когда режим «Сцена» открыт. Тумблер «Сцена 18+» — в настройках, по умолчанию выключено.
//
// Слоты: A — актив, B — пассив, C — третий (только у поз с третьим). В слот ставится персонаж из «Моих персонажей» или
// просто текст тегов. Структура промта: общий блок (основа, общие теги позы, место, детали, ракурс) и блоки персонажей —
// у каждого пол boy/girl/other, adult, теги слота, роль позы и взаимодействия source# / target# / mutual#.
// Для NovelAI напрямую блоки уходят персонажными (nai), для Наистеры и таверны — склейка без `#`-тегов (positive).
// Генерация идёт тем же блоком, что и в режиме «Персонаж».
// Безопасность (safety.js) вшита: adult man / adult woman / adult в каждом блоке, анти-детские теги в негативе,
// вычистка тегов про возраст.

import { getSettings, saveSettings, escapeHtml } from './store.js';
import { ADULT_TAG, ANTI_CHILD_NEG, stripUnsafeTags, withSafeNegative } from './safety.js';
import { buildPrompt } from './builder.js';

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

const SLOT_KEYS = ['A', 'B', 'C'];
const SLOT_TITLES = { A: 'A — актив', B: 'B — пассив', C: 'C — третий' };
const GENDER_OPTIONS = [['m', '♂ парень'], ['f', '♀ девушка'], ['x', '⚥ футанари'], ['', 'не указан']];
const GENDER_ICON = { m: '♂', f: '♀', x: '⚥' };
const LOCK_KEYS = ['pose', 'place', 'shot', 'details'];

// «Счётные» теги задаёт поза (2boys / 3boys…), у слота их быть не должно. futanari убираем до этапа со смешанными парами.
const COUNT_TAGS = new Set(['1boy', '1girl', 'solo', '2boys', '2girls', '3boys', '3girls', 'multiple boys', 'multiple girls', 'futanari']);

function adultFor(gender) {
    if (gender === 'm') return 'adult man';
    if (gender === 'f') return 'adult woman';
    return ADULT_TAG;    // ⚥ и «не указан»
}

/** Сколько слотов у позы: B нет у соло-поз, C — только у поз с третьим. */
function poseShape(a) {
    const second = a.bot || [];
    const single = Boolean(a.one) || (!second.length && !a.third);
    return { B: !single, C: Boolean(a.third) };
}

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

    // Слоты: удалённого персонажа убираем, мусор в полях чиним
    const ids = new Set((getSettings().characters || []).map((c) => c.id));
    if (!st.slots || typeof st.slots !== 'object') st.slots = {};
    for (const k of SLOT_KEYS) {
        const v = { src: '', charId: '', text: '', gender: '', ...(st.slots[k] || {}) };
        if (!['', 'char', 'text'].includes(v.src)) v.src = '';
        if (v.src === 'char' && !ids.has(v.charId)) {
            v.src = '';
            v.charId = '';
        }
        if (!['m', 'f', 'x', ''].includes(v.gender)) v.gender = '';
        v.text = String(v.text || '');
        st.slots[k] = v;
    }
    st.locks = { pose: false, place: false, shot: false, details: false, ...(st.locks || {}) };
}

// ---------- Сборка промта ----------

function splitList(text) {
    return String(text || '').split(',').map((x) => x.trim()).filter(Boolean);
}

function bare(tag) {
    return String(tag).trim().replace(/^[\d.]+::/, '').replace(/::$/, '').toLowerCase();
}

const INTERACTION_RE = /^(?:[\d.]+::)?(source|target|mutual)#/i;

function interKind(tag) {
    const m = String(tag || '').trim().match(INTERACTION_RE);
    return m ? m[1].toLowerCase() : '';
}

function noInter(list) {
    return list.filter((t) => !String(t).includes('#'));
}

function leadFor(gender) {
    return gender === 'm' ? 'boy' : (gender === 'f' ? 'girl' : 'other');   // пол персонажа в NovelAI: boy / girl / other
}

/** Без повторов; `source#…` / `target#…` / `mutual#…` остаются только если keepInter (блоки персонажей). */
function cleanTags(list, keepInter = false) {
    const seen = new Set();
    const out = [];
    for (const raw of list) {
        const t = String(raw || '').trim();
        if (!t || (!keepInter && t.includes('#'))) continue;
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(t);
    }
    return out;
}

let getDb = () => null;    // база тегов (её отдаёт index.js), нужна, чтобы собрать теги сохранённого персонажа

function dropCount(tags) {
    return tags.filter((t) => !COUNT_TAGS.has(bare(t)));
}

/** Что слот кладёт в промт: теги, пол (m/f/x/'') и подпись. */
function slotInfo(key) {
    const s = getSettings();
    const slot = s.scene.slots?.[key];
    const none = { tags: [], gender: '', who: '' };
    if (!slot || !slot.src) return none;

    if (slot.src === 'text') {
        return { tags: dropCount(splitList(slot.text)), gender: slot.gender || '', who: 'свой текст' };
    }

    const c = (s.characters || []).find((x) => x.id === slot.charId);
    const db = getDb();
    if (!c || !db) return none;
    try {
        // Теги персонажа — тем же сборщиком, что и в режиме «Персонаж», но по его сохранённой сборке.
        // Одежда по умолчанию и свои «общие» теги (custom) не нужны: об этом заботятся поза и стиль.
        const synth = {
            ...s,
            build: (c.build || []).filter((b) => db.tags.has(b.id)).map((b) => ({ ...b })),
            autoOff: [...(c.autoOff || [])],
            ownTags: c.ownTags || '',
            toggles: { ...s.toggles, clothing: false },
            custom: { place: 'start', text: '' },
            negative: '',
            loadedCharId: c.id,
        };
        const built = buildPrompt(db, synth);
        const fromBuild = built.gender === 'm' ? 'm' : (built.gender === 'f' ? 'f' : '');
        return { tags: dropCount(splitList(built.positive)), gender: c.gender || fromBuild, who: c.name };
    } catch (error) {
        console.error('[Chimera] Не удалось собрать теги персонажа для слота', key, error);
        return { ...none, who: c.name };
    }
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
        charIds: [],
        removed: 0,
        warnings: [],
        nai: null,
        sceneInfo: null,
    };
}

/**
 * Собрать промт сцены по текущему выбору.
 * @returns {{ scene: true, parts: {key:string,label:string,who:string,lead:string,tags:string[]}[], positive: string, negative: string,
 *             negAlways: readonly string[], count: number, own: [], charIds: string[], removed: number,
 *             warnings: string[], nai: {base:string, chars:string[]}|null, sceneInfo: object|null }}
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

    const shape = poseShape(a);
    const single = !shape.B;
    const split = s.sceneSplit !== false;
    const slotA = slotInfo('A');
    const sh = a.sh || [];

    // Общий блок: основа, общие теги позы, место, детали, ракурс. Взаимодействия (#) уходят в блоки персонажей
    const mutual = [...sh, ...details].filter((t) => interKind(t) === 'mutual');
    const common = { key: 'common', label: 'общее', who: '', lead: '', tags: [...base, ...noInter(sh), ...placeTags, ...noInter(details), ...shotTags] };
    const people = [
        // пол/adult → теги персонажа → роль позы (source#…) → взаимодействия
        { key: 'a', label: single ? 'персонаж' : 'актив (source)', who: slotA.who, gender: slotA.gender,
            tags: [adultFor(slotA.gender), ...slotA.tags, ...(a.top || []), ...details.filter((t) => interKind(t) === 'source'), ...mutual] },
    ];
    if (shape.B) {
        const slotB = slotInfo('B');
        people.push({ key: 'b', label: 'пассив (target)', who: slotB.who, gender: slotB.gender,
            tags: [adultFor(slotB.gender), ...slotB.tags, ...(a.bot || []), ...details.filter((t) => interKind(t) === 'target'), ...mutual] });
    }
    if (shape.C) {
        const slotC = slotInfo('C');
        people.push({ key: 'c', label: 'третий', who: slotC.who, gender: slotC.gender,
            tags: [adultFor(slotC.gender), ...slotC.tags, ...(a.third || []), ...mutual] });
    }

    // Защита: теги про возраст вычищаются из каждого блока
    let removed = 0;
    const clean = (tags, keepInter) => {
        const safe = stripUnsafeTags(cleanTags(tags, keepInter));
        removed += safe.removed;
        return safe.tags;
    };
    const commonTags = clean(common.tags, false);
    const personBlocks = people.map((p) => ({ key: p.key, label: p.label, who: p.who, lead: leadFor(p.gender), tags: clean(p.tags, true) }));

    // Склеенный промт (Наистера, таверна, разбивка выключена): общее первым, потом персонажи; `#`-тегов и boy/girl нет
    const seen = new Set();
    const flat = [];
    for (const tags of [commonTags, ...personBlocks.map((p) => noInter(p.tags))]) {
        for (const t of tags) {
            const k = t.toLowerCase();
            if (seen.has(k)) continue;
            seen.add(k);
            flat.push(t);
        }
    }

    // Что показываем в карточке: при разбивке — как увидит NovelAI (с boy/girl и #-тегами), иначе — склейка по блокам
    const parts = split
        ? [{ ...common, tags: commonTags }, ...personBlocks]
        : [{ ...common, tags: commonTags }, ...personBlocks.map((p) => ({ ...p, lead: '', tags: noInter(p.tags) }))];

    // Смешанные пары и не-парни пока не поддерживаются: основа сцены считается по позе, теги основы не меняются
    const warnings = [];
    if (people.some((p) => p.gender && p.gender !== 'm')) {
        const countTag = base.find((t) => /boys|girls/.test(t)) || base[0];
        warnings.push(`Смешанные пары пока не поддерживаются: основа сцены остаётся «${countTag}»`);
    }

    // Чьи это картинки: персонажи из слотов, которые реально участвуют в позе
    const stSlots = st.slots || {};
    const present = ['A', ...(shape.B ? ['B'] : []), ...(shape.C ? ['C'] : [])];
    const charIds = [...new Set(present
        .map((k) => stSlots[k])
        .filter((v) => v && v.src === 'char' && v.charId)
        .map((v) => v.charId))];

    const plus = new Set(flat.map(bare));
    const negKept = splitList(s.negative).filter((t) => !plus.has(bare(t)));

    return {
        scene: true,
        parts,
        positive: flat.join(', '),
        // NovelAI напрямую: base_caption + по блоку на персонажа (стиль gen.js добавит в базу)
        nai: split ? { base: commonTags.join(', '), chars: personBlocks.map((p) => [p.lead, ...p.tags].join(', ')) } : null,
        negative: withSafeNegative(negKept.join(', ')),
        negAlways: ANTI_CHILD_NEG,
        count: flat.length,
        own: [],
        charIds,
        removed,
        warnings,
        sceneInfo: { pose: st.pose, place: st.place || '', shot: st.shot || '', details, chars: charIds },
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

function lockBtn(key) {
    const on = Boolean(st().locks[key]);
    return `<button type="button" class="chm-lock${on ? ' chm-active' : ''}" data-lock="${key}" aria-pressed="${on}" title="Закреплённое при рандоме не трогаем"><i class="fa-solid ${on ? 'fa-lock' : 'fa-lock-open'}"></i></button>`;
}

function slotOptions(slot) {
    const chars = getSettings().characters || [];
    return `<option value="">пусто</option>`
        + chars.map((c) => `<option value="c:${escapeHtml(c.id)}" ${slot.src === 'char' && slot.charId === c.id ? 'selected' : ''}>${GENDER_ICON[c.gender] ? `${GENDER_ICON[c.gender]} ` : ''}${escapeHtml(c.name)}</option>`).join('')
        + `<option value="t" ${slot.src === 'text' ? 'selected' : ''}>свой текст</option>`;
}

function slotCardHtml(key) {
    const slot = st().slots[key];
    const text = slot.src === 'text';
    return `
        <div class="chm-slot" data-slot="${key}">
            <div class="chm-slot-title">${SLOT_TITLES[key]}</div>
            <select class="text_pole chm-slot-src" aria-label="Кто в слоте ${key}">${slotOptions(slot)}</select>
            <div class="chm-slot-text" ${text ? '' : 'hidden'}>
                <textarea class="text_pole chm-slot-tags" rows="2" placeholder="hadrian vaelmont, wolf ears, short silver-gray hair…" spellcheck="false">${escapeHtml(slot.text)}</textarea>
                <div class="chm-set-hint">Впиши готовые теги через запятую</div>
                <select class="text_pole chm-slot-gender" aria-label="Пол">${GENDER_OPTIONS.map(([v, l]) => `<option value="${v}" ${slot.gender === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            </div>
            <div class="chm-set-hint chm-slot-empty" ${slot.src ? 'hidden' : ''}>Слот пуст — у этого персонажа будут только adult и теги позы</div>
        </div>`;
}

/** Слоты, которые нужны выбранной позе: B нет у соло-поз, C только у поз с третьим. */
function slotsBodyHtml() {
    const a = data.poses[st().pose];
    const shape = a ? poseShape(a) : { B: true, C: false };
    return SLOT_KEYS.filter((k) => k === 'A' || (k === 'B' && shape.B) || (k === 'C' && shape.C)).map(slotCardHtml).join('');
}

function renderSlots() {
    if (!col) return;
    const body = col.querySelector('.chm-slots-body');
    if (!body) return;
    body.innerHTML = slotsBodyHtml();
    const a = data.poses[st().pose];
    const swap = col.querySelector('.chm-slot-swap');
    if (swap) swap.disabled = !(a && poseShape(a).B);
}

function colHtml() {
    const s = st();
    const cats = CATS.map((c) => `<button type="button" class="chm-chip chm-scene-cat${c.id === s.cat ? ' chm-active' : ''}" data-cat="${c.id}">${escapeHtml(c.label)} <span class="chm-scene-cat-n">${data.counts[c.id] || 0}</span></button>`).join('');
    return `
        <div class="chm-scene-bar">
            <button type="button" class="chm-btn chm-scene-roll" title="Перебросить всё, что не закреплено замочком"><i class="fa-solid fa-dice"></i> Случайная сцена</button>
            <button type="button" class="chm-btn chm-scene-reset" title="Сбросить место, ракурс и детали (поза остаётся)"><i class="fa-solid fa-rotate-left"></i> Очистить</button>
        </div>

        <div class="chm-card chm-scene-block chm-slots">
            <div class="chm-card-head"><i class="fa-solid fa-users"></i> Персонажи
                <button type="button" class="chm-btn chm-slot-swap" title="Поменять A и B местами: актив остаётся активом, меняются люди"><i class="fa-solid fa-right-left"></i> Поменять местами</button>
            </div>
            <div class="chm-slots-body"></div>
        </div>

        <div class="chm-card chm-scene-block">
            <div class="chm-card-head"><i class="fa-solid fa-people-arrows"></i> Поза <span class="chm-scene-shown"></span>${lockBtn('pose')}</div>
            <label class="chm-search chm-scene-search">
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                <input type="search" class="chm-search-input chm-scene-q" placeholder="Найти позу…" autocomplete="off" spellcheck="false" value="${escapeHtml(s.q)}">
            </label>
            <div class="chm-scene-cats">${cats}</div>
            <div class="chm-scene-poses" role="listbox" aria-label="Поза"></div>
        </div>

        <div class="chm-card chm-scene-block">
            <div class="chm-card-head"><i class="fa-solid fa-location-dot"></i> Место ${lockBtn('place')}</div>
            <select class="text_pole chm-scene-place">${placeOptions()}</select>
            <div class="chm-set-hint">«${NO_PLACE_LABEL}» — у многих поз есть своё место, оно и пойдёт в промт. Если выбрать место здесь, оно перебьёт место позы.</div>
            <div class="chm-card-head chm-scene-subhead"><i class="fa-solid fa-camera"></i> Ракурс ${lockBtn('shot')}</div>
            <select class="text_pole chm-scene-shot">${shotOptions()}</select>
        </div>

        <div class="chm-card chm-scene-block">
            <div class="chm-card-head"><i class="fa-solid fa-tags"></i> Детали ${lockBtn('details')}</div>
            <div class="chm-scene-groups">${detailsHtml()}</div>
        </div>
`;
}

function partsHtml(built) {
    if (!built.parts.length) return '<span class="chm-prompt-empty">// выбери позу слева</span>';
    const comma = '<span class="chm-pcomma">, </span>';
    return built.parts.map((p) => `
        <div class="chm-scene-part">
            <div class="chm-scene-part-l">${escapeHtml(p.label)}${p.who ? ` · ${escapeHtml(p.who)}` : ''}</div>
            <div class="chm-prompt-text">${[...(p.lead ? [p.lead] : []), ...p.tags].map((t) => `<span class="chm-ptag">${escapeHtml(t)}</span>`).join(comma)}</div>
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
            <div class="chm-set-hint chm-scene-route"></div>
            <div class="chm-set-hint chm-scene-warn" hidden></div>
            <div class="chm-set-hint chm-scene-removed" hidden></div>
            <div class="chm-set-hint chm-scene-safe">Вшито и не отключается: в каждом блоке стоит adult, а в негатив при рисовании всегда добавляются ${escapeHtml(ANTI_CHILD_NEG.join(', '))}. Теги про возраст из промта вычищаются.</div>
        </div>`;
}

function renderSide() {
    if (!side) return;
    const built = buildScene();
    side.querySelector('.chm-scene-count').textContent = `${built.count} тег.`;
    side.querySelector('.chm-scene-parts').innerHTML = partsHtml(built);
    side.querySelector('.chm-scene-route').textContent = built.nai
        ? '// NovelAI: по персонажам (общее + блок на каждого) · Наистера и таверна: склеенно'
        : '// склеенно: общее, потом персонажи (разбивка по персонажам выключена в настройках)';
    const warn = side.querySelector('.chm-scene-warn');
    warn.hidden = !built.warnings.length;
    warn.textContent = built.warnings.map((w) => `// ${w}`).join(' ');
    const removed = side.querySelector('.chm-scene-removed');
    removed.hidden = !built.removed;
    removed.textContent = built.removed ? `// убрала ${built.removed} тег. про возраст` : '';
}

function renderCol() {
    if (!col) return;
    col.innerHTML = colHtml();
    renderSlots();
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

// ---------- Рандом и слоты ----------

function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
}

/** Занят ли слот: персонаж выбран или вписан текст. */
function slotFilled(key) {
    const v = st().slots[key];
    return Boolean(v && (v.src === 'char' || (v.src === 'text' && v.text.trim())));
}

/**
 * «Случайная сцена»: перебрасывает всё, что не закреплено замочком.
 * Как у генератора подруги: поза — из текущего списка, но поза с третьим берётся только когда слот C занят;
 * ракурс — без «обрезает…»; деталей 2–5 из общего списка. Слоты персонажей рандом не трогает.
 */
function rollScene() {
    const s = st();
    const L = s.locks;

    if (!L.pose) {
        const pool = filteredPoses().filter((n) => !(data.poses[n].third && !slotFilled('C')));
        if (pool.length) s.pose = pick(pool);
    }
    if (!L.place) {
        // у позы своё место — оставляем «как у позы», иначе случайное из списка
        const own = data.poses[s.pose]?.place;
        s.place = own && own.length ? '' : pick(Object.keys(data.sets));
    }
    if (!L.shot) {
        const keys = Object.keys(data.shots);
        const pool = keys.filter((k) => !k.includes('обрезает'));
        const key = pick(pool.length ? pool : keys);
        s.shot = key === keys[0] ? '' : key;
    }
    if (!L.details) {
        const all = [...data.detAll];
        const want = 2 + Math.floor(Math.random() * 4);
        const chosen = new Set();
        while (chosen.size < Math.min(want, all.length)) chosen.add(pick(all));
        s.details = [...chosen];
    }
    renderCol();
    save();
}

function swapSlots() {
    const s = st();
    const a = data.poses[s.pose];
    if (!a || !poseShape(a).B) return;
    [s.slots.A, s.slots.B] = [s.slots.B, s.slots.A];
    renderSlots();
    save();
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

    if (e.target.closest('.chm-scene-roll')) {
        rollScene();
        return;
    }
    if (e.target.closest('.chm-slot-swap')) {
        swapSlots();
        return;
    }
    const lock = e.target.closest('.chm-lock');
    if (lock) {
        const key = lock.dataset.lock;
        if (!LOCK_KEYS.includes(key)) return;
        s.locks[key] = !s.locks[key];
        lock.classList.toggle('chm-active', s.locks[key]);
        lock.setAttribute('aria-pressed', String(s.locks[key]));
        lock.querySelector('i').className = `fa-solid ${s.locks[key] ? 'fa-lock' : 'fa-lock-open'}`;
        saveSettings();
        return;
    }

    const cat = e.target.closest('[data-cat]');
    if (cat) {
        s.cat = cat.dataset.cat;
        col.querySelectorAll('.chm-scene-cat').forEach((b) => b.classList.toggle('chm-active', b === cat));
        const list = filteredPoses();
        if (list.length && !list.includes(s.pose)) s.pose = list[0];   // как у подруги: если позы нет в разделе, встаёт первая
        renderPoseList();
        renderSlots();
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
        renderSlots();   // у позы может быть другой набор слотов
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
    if (!data) return;
    if (e.target.closest('.chm-scene-q')) {
        st().q = e.target.value;
        renderPoseList();
        saveSettings();
        return;
    }
    const tags = e.target.closest('.chm-slot-tags');
    if (tags) {
        st().slots[tags.closest('.chm-slot').dataset.slot].text = tags.value;
        save();   // слот не перерисовываем — иначе пропадёт фокус в поле
    }
}

function onChange(e) {
    if (!data) return;
    if (e.target.closest('.chm-scene-place')) {
        st().place = e.target.value;
        save();
    } else if (e.target.closest('.chm-scene-shot')) {
        st().shot = e.target.value;
        save();
    } else if (e.target.closest('.chm-slot-src')) {
        const card = e.target.closest('.chm-slot');
        const slot = st().slots[card.dataset.slot];
        const v = e.target.value;
        if (v === 't') {
            slot.src = 'text';
            slot.charId = '';
        } else if (v.startsWith('c:')) {
            slot.src = 'char';
            slot.charId = v.slice(2);
        } else {
            slot.src = '';
            slot.charId = '';
        }
        card.querySelector('.chm-slot-text').hidden = slot.src !== 'text';
        card.querySelector('.chm-slot-empty').hidden = Boolean(slot.src);
        save();
    } else if (e.target.closest('.chm-slot-gender')) {
        st().slots[e.target.closest('.chm-slot').dataset.slot].gender = e.target.value;
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
 * @param {{ onChange?: Function, getDb?: () => object|null }} callbacks   getDb — база тегов для сборки персонажей слотов
 */
export function initScene(mainEl, panelEl, callbacks = {}) {
    onSceneChange = callbacks.onChange || (() => {});
    getDb = callbacks.getDb || (() => null);

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
