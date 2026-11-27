// Chimera — режим «Сцена» (этапы 2–3): позы, место, ракурс, детали, слоты персонажей A/B/C → промт сцены.
// Каталоги — data/scene.json (порт из генератора поз; её сюжетные позы с готовыми персонажами не переносим),
// грузятся только когда режим «Сцена» открыт. Тумблер «Сцена 18+» — в настройках, по умолчанию выключено.
//
// Слоты: A — актив, B — пассив, C — третий (только у поз с третьим). В слот ставится персонаж из «Моих персонажей» или
// просто текст тегов. Структура промта: общий блок (основа, общие теги позы, место, детали, ракурс) и блоки персонажей —
// у каждого пол boy/girl/other, adult, теги слота, роль позы и взаимодействия source# / target# / mutual#.
// Для NovelAI напрямую блоки уходят персонажными (nai), для Наистеры и таверны — склейка без `#`-тегов (positive).
// Каркас (6б): разделы «Персонажи / Поза и кадр / Детали» сворачиваются и скрываются (скрытый раздел в промте не участвует),
// поза выбирается из «Библиотеки» (выпадающая панель), «Детали» — мультивыбор-чипы со своими чипами «＋».
// Комикс: у поз с сюжетом (story) страница рисуется одной картинкой — панели это кадры сюжета (теговый формат, как в
// генераторе поз: comic, N panels, раскладка позы, «panel i: кто, теги кадра»). Имена персонажей берутся из слотов.
// Генерация идёт тем же блоком, что и в режиме «Персонаж».
// Безопасность (safety.js) вшита: adult man / adult woman / adult в каждом блоке, анти-детские теги в негативе,
// вычистка тегов про возраст.

import { getSettings, saveSettings, escapeHtml } from './store.js';
import { ADULT_TAG, ANTI_CHILD_NEG, stripUnsafeTags, stripUnsafeText, withSafeNegative } from './safety.js';
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

const NAME_RE = /^[A-Za-z][A-Za-z0-9 '.\-]*$/;

/** Имя для промта из имени персонажа: только латиницей, иначе пусто (его впишут руками). */
function latinName(name) {
    const n = String(name || '').trim();
    return NAME_RE.test(n) ? n : '';
}

function hasStory(a) {
    return Boolean(a && Array.isArray(a.story) && a.story.length);
}

/** «1 кадр / 2 кадра / 5 кадров». */
function plural(n, one, few, many) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} ${few}`;
    return `${n} ${many}`;
}

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

/** Деталь существует: встроенная или свой чип. */
function isValidDetail(d) {
    const st = getSettings().scene;
    return data.detAll.has(d) || Object.values(st.customChips || {}).some((list) => list.includes(d));
}

/** Скрытый раздел в промте не участвует (как будто пуст). Основа сцены («Поза и кадр») скрываться не умеет. */
function isHidden(id) {
    return id !== 'pose' && Boolean(getSettings().scene.ui?.hidden?.[id]);
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
    if (typeof st.q !== 'string') st.q = '';

    // Каркас: состояние разделов и группы деталей, свои чипы
    if (!st.ui || typeof st.ui !== 'object') st.ui = {};
    st.ui.open = { ...(st.ui.open || {}) };
    st.ui.groups = { ...(st.ui.groups || {}) };
    st.ui.hidden = { ...(st.ui.hidden || {}) };
    st.ui.hidden.pose = false;   // основу сцены скрыть нельзя
    if (!st.customChips || typeof st.customChips !== 'object') st.customChips = {};
    for (const g of Object.keys(st.customChips)) {
        if (!data.detGroups[g] || !Array.isArray(st.customChips[g])) delete st.customChips[g];
        else st.customChips[g] = st.customChips[g].filter((t) => typeof t === 'string' && t.trim());
    }
    st.details = (st.details || []).filter(isValidDetail);

    // Слоты: удалённого персонажа убираем, мусор в полях чиним
    const ids = new Set((getSettings().characters || []).map((c) => c.id));
    if (!st.slots || typeof st.slots !== 'object') st.slots = {};
    for (const k of SLOT_KEYS) {
        const v = { src: '', charId: '', text: '', gender: '', name: '', ...(st.slots[k] || {}) };
        if (!['', 'char', 'text'].includes(v.src)) v.src = '';
        if (v.src === 'char' && !ids.has(v.charId)) {
            v.src = '';
            v.charId = '';
        }
        if (!['m', 'f', 'x', ''].includes(v.gender)) v.gender = '';
        v.text = String(v.text || '');
        v.name = String(v.name || '');
        // слот с персонажем без имени: подставить его имя, если оно латиницей
        if (v.src === 'char' && !v.name.trim()) v.name = latinName((getSettings().characters || []).find((c) => c.id === v.charId)?.name);
        st.slots[k] = v;
    }
    st.locks = { pose: false, place: false, shot: false, details: false, ...(st.locks || {}) };
    st.comic = st.comic !== false;
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
    if (isHidden('chars') || !slot || !slot.src) return none;

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

    const details = isHidden('details') ? [] : (st.details || []).filter(isValidDetail);

    const shape = poseShape(a);
    const single = !shape.B;
    const split = s.sceneSplit !== false;
    const slotA = slotInfo('A');
    const sh = a.sh || [];

    // Комикс: у позы с сюжетом страница рисуется одной картинкой, панели — кадры сюжета
    const comicOn = st.comic !== false && hasStory(a);
    const customName = (k) => (isHidden('chars') ? '' : String(st.slots?.[k]?.name || '').trim());
    const nameOf = (k) => customName(k) || `character ${k}`;          // в комиксе имя нужно всегда: на него ссылаются панели
    const nameTags = (k) => (comicOn ? [nameOf(k)] : (customName(k) ? [customName(k)] : []));
    let panelRemoved = 0;
    let comicTags = [];
    if (comicOn) {
        const nm = { A: nameOf('A'), B: nameOf('B'), C: nameOf('C') };
        const group = shape.C ? `${nm.A}, ${nm.B} and ${nm.C}` : (shape.B ? `${nm.A} and ${nm.B}` : nm.A);
        const whoFor = (w) => ((w === 'A' || w === 'B' || w === 'C') && (w === 'A' || (w === 'B' && shape.B) || (w === 'C' && shape.C)) ? nm[w] : group);
        const panels = a.story.map(([who, text], i) => {
            const raw = `panel ${i + 1}: ${whoFor(who)}, ${text}`;
            const safe = stripUnsafeText(raw);
            panelRemoved += raw.split(',').length - safe.split(',').length;
            return safe;
        });
        const preface = shape.C ? `the same three characters in every panel: ${group}`
            : (shape.B ? `the same two characters in every panel: ${group}` : `the same character in every panel: ${group}`);
        comicTags = [preface, ...panels];
    }

    // Общий блок: основа, общие теги позы, (комикс: раскладка), место, детали, ракурс (в комиксе его задаёт кадр), кадры.
    // Взаимодействия (#) уходят в блоки персонажей
    const mutual = [...sh, ...details].filter((t) => interKind(t) === 'mutual');
    const comicHead = comicOn ? ['comic', `${a.story.length} panels`, ...(a.layout || []), 'narrow gutters'] : [];
    const comicTail = comicOn ? ['consistent character design', 'same characters in every panel', 'consistent faces', 'no text'] : [];
    const common = { key: 'common', label: comicOn ? 'общее · комикс' : 'общее', who: '', lead: '',
        tags: [...base, ...noInter(sh), ...comicHead, ...placeTags, ...noInter(details), ...(comicOn ? [] : shotTags), ...comicTags, ...comicTail] };
    const people = [
        // [имя] → пол/adult → теги персонажа → роль позы (source#…) → взаимодействия
        { key: 'a', label: single ? 'персонаж' : 'актив (source)', who: slotA.who, gender: slotA.gender,
            tags: [...nameTags('A'), adultFor(slotA.gender), ...slotA.tags, ...(a.top || []), ...details.filter((t) => interKind(t) === 'source'), ...mutual] },
    ];
    if (shape.B) {
        const slotB = slotInfo('B');
        people.push({ key: 'b', label: 'пассив (target)', who: slotB.who, gender: slotB.gender,
            tags: [...nameTags('B'), adultFor(slotB.gender), ...slotB.tags, ...(a.bot || []), ...details.filter((t) => interKind(t) === 'target'), ...mutual] });
    }
    if (shape.C) {
        const slotC = slotInfo('C');
        people.push({ key: 'c', label: 'третий', who: slotC.who, gender: slotC.gender,
            tags: [...nameTags('C'), adultFor(slotC.gender), ...slotC.tags, ...(a.third || []), ...mutual] });
    }

    // Защита: теги про возраст вычищаются из каждого блока
    let removed = panelRemoved;
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
    if (comicOn && !isHidden('chars')) {
        const unnamed = present.filter((k) => !customName(k));
        if (unnamed.length) warnings.push(`Слоты без «Имени в промте» (${unnamed.join(', ')}) в панелях называются ${unnamed.map((k) => `«character ${k}»`).join(', ')} — впиши имена латиницей`);
    }
    const charIds = isHidden('chars') ? [] : [...new Set(present
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
        sceneInfo: { pose: st.pose, place: st.place || '', shot: st.shot || '', details, chars: charIds, comic: comicOn ? a.story.length : 0 },
    };
}

/** Для блока генерации: промт сцены. */
export function currentSceneBuilt() {
    return buildScene();
}

// ---------- Экран режима ----------

let col = null;       // левая колонка: разделы «Персонажи», «Поза и кадр», «Детали»
let side = null;      // кусок правой колонки: промт сцены
let onSceneChange = () => {};
let renderedOnce = false;
let libOpen = false;      // открыта ли «Библиотека поз»
let chipEditor = '';      // группа деталей, где сейчас открыт ввод своего чипа ('' — нигде)
let secMenuOpen = false;  // открыто ли меню «Разделы»

const SECTIONS = [
    { id: 'chars', title: 'Персонажи', en: 'CHARACTERS', hideable: true },
    { id: 'pose', title: 'Поза и кадр', en: 'POSE & FRAME', hideable: false },
    { id: 'details', title: 'Детали', en: 'DETAILS', hideable: true },
];

function st() {
    return getSettings().scene;
}

/** Раздел развёрнут: по умолчанию открыт только «Персонажи». */
function isSecOpen(id) {
    const v = st().ui.open[id];
    return v === undefined ? id === 'chars' : Boolean(v);
}

function isGroupOpen(group) {
    return Boolean(st().ui.groups[group]);
}

function customList(group) {
    return st().customChips[group] || [];
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

/** Активная поза в видимой части списка (вручную: scrollIntoView прокручивает ВСЕ родительские контейнеры). */
function scrollActivePose() {
    const box = col?.querySelector('.chm-scene-poses');
    const act = box?.querySelector('.chm-pose.chm-active');
    if (!box || !act) return;
    if (act.offsetTop < box.scrollTop) box.scrollTop = act.offsetTop;
    else if (act.offsetTop + act.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = act.offsetTop + act.offsetHeight - box.clientHeight;
}

function renderPoseList() {
    if (!col) return;
    const list = filteredPoses();
    const box = col.querySelector('.chm-scene-poses');
    box.innerHTML = list.map(poseButton).join('') || '<div class="chm-prompt-empty">// ничего не нашла — попробуй короче или по-английски</div>';
    const total = data.counts[st().cat] ?? data.names.length;
    col.querySelector('.chm-scene-shown').textContent = list.length === total ? `${total}` : `${list.length} из ${total}`;
    scrollActivePose();
}

function updatePoseLabel() {
    const el = col?.querySelector('.chm-pose-current-name');
    if (!el) return;
    el.textContent = st().pose;
    el.parentElement.title = st().pose;
    // выбранная категория видна на поле: она сужает «Случайную сцену» и ‹ ›
    const chip = col.querySelector('.chm-pose-filter');
    if (chip) {
        const cat = CATS.find((c) => c.id === st().cat);
        chip.hidden = st().cat === 'all';
        chip.textContent = cat ? `${cat.label} ✕` : '';
    }
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

// ----- «Детали»: группы-категории и чипы со своим «＋» -----

function chipHtml(text, group, custom, chosen) {
    const on = chosen.has(text);
    const main = `<button type="button" class="chm-det${custom ? ' chm-custom' : ''}${on ? ' chm-active' : ''}" data-d="${escapeHtml(text)}" aria-pressed="${on}">${escapeHtml(text)}</button>`;
    if (!custom) return main;
    return `<span class="chm-det-wrap">${main}<button type="button" class="chm-det-x" data-group="${escapeHtml(group)}" data-d="${escapeHtml(text)}" title="Удалить свой тег" aria-label="Удалить свой тег ${escapeHtml(text)}">✕</button></span>`;
}

function chipEditorHtml(group) {
    return `<span class="chm-det-edit" data-group="${escapeHtml(group)}">
        <input type="text" class="text_pole chm-det-input" placeholder="свой тег…" maxlength="80" spellcheck="false" autocomplete="off" aria-label="Свой тег">
        <button type="button" class="chm-det-ok" title="Сохранить">✓</button>
        <button type="button" class="chm-det-cancel" title="Отмена">✕</button>
    </span>`;
}

function chipsBodyHtml(group) {
    const chosen = new Set(st().details);
    const builtin = data.detGroups[group] || [];
    const own = customList(group);
    const add = chipEditor === group
        ? chipEditorHtml(group)
        : '<button type="button" class="chm-det chm-det-add" title="Добавить свой тег">＋</button>';
    return `<div class="chm-scene-chips">
            ${builtin.map((d) => chipHtml(d, group, false, chosen)).join('')}
            ${own.map((d) => chipHtml(d, group, true, chosen)).join('')}
            ${add}
        </div>
        <div class="chm-set-hint chm-det-hint" hidden></div>`;
}

function groupCount(group) {
    const chosen = new Set(st().details);
    const all = [...(data.detGroups[group] || []), ...customList(group)];
    return { n: all.filter((d) => chosen.has(d)).length, total: all.length };
}

function groupHtml(group) {
    const open = isGroupOpen(group);
    const { n, total } = groupCount(group);
    return `
        <div class="chm-catbox chm-scene-grp${open ? ' chm-open' : ''}" data-group="${escapeHtml(group)}">
            <div class="chm-catbox-head">
                <button type="button" class="chm-catbox-toggle" aria-expanded="${open}">
                    <i class="fa-solid fa-chevron-down chm-chev"></i>
                    <span class="chm-catbox-title">${escapeHtml(group)}</span>
                    <span class="chm-catbox-mode">· мультивыбор</span>
                </button>
                <span class="chm-catbox-count${n ? ' chm-has' : ''}">${n ? `${n} / ${total}` : total}</span>
            </div>
            <div class="chm-catbox-body">${chipsBodyHtml(group)}</div>
        </div>`;
}

function detailsHtml() {
    return Object.keys(data.detGroups).map(groupHtml).join('');
}

/** Обновить одну группу деталей (счётчик и чипы), не трогая остальной экран. */
function renderGroup(group) {
    const el = [...(col?.querySelectorAll('.chm-scene-grp') || [])].find((x) => x.dataset.group === group);
    if (!el) return;
    const { n, total } = groupCount(group);
    const count = el.querySelector('.chm-catbox-count');
    count.textContent = n ? `${n} / ${total}` : String(total);
    count.classList.toggle('chm-has', Boolean(n));
    el.querySelector('.chm-catbox-body').innerHTML = chipsBodyHtml(group);
    if (chipEditor === group) el.querySelector('.chm-det-input')?.focus({ preventScroll: true });
}

function lockBtn(key) {
    const on = Boolean(st().locks[key]);
    return `<button type="button" class="chm-lock${on ? ' chm-active' : ''}" data-lock="${key}" aria-pressed="${on}" title="Закреплённое при рандоме не трогаем"><i class="fa-solid ${on ? 'fa-lock' : 'fa-lock-open'}"></i></button>`;
}

// ----- «Персонажи» -----

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
            <input type="text" class="text_pole chm-slot-name" placeholder="Имя в промте, например Veyne" value="${escapeHtml(slot.name || '')}" spellcheck="false" autocomplete="off" aria-label="Имя в промте">
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

/** Переключатель комикса: у позы с сюжетом он активен и показывает число кадров; в комиксе «Ракурс» неактивен. */
function renderComicRow() {
    if (!col) return;
    const a = data?.poses[st().pose];
    const story = hasStory(a);
    const on = story && st().comic !== false;
    const toggle = col.querySelector('.chm-comic-toggle');
    if (!toggle) return;
    toggle.disabled = !story;
    toggle.checked = on;
    col.querySelector('.chm-comic-count').textContent = story ? plural(a.story.length, 'кадр', 'кадра', 'кадров') : '';
    col.querySelector('.chm-comic-hint').textContent = !story
        ? 'У этой позы нет сюжета — одна картинка'
        : (on ? 'В комиксе ракурс задаёт сам кадр' : '');
    const shot = col.querySelector('.chm-scene-shot');
    if (shot) shot.disabled = on;
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

// ----- Разделы -----

function sectionHtml(sec, body) {
    const open = isSecOpen(sec.id);
    return `
        <section class="chm-sec chm-scene-sec${open ? ' chm-open' : ''}" data-sec="${sec.id}"${isHidden(sec.id) ? ' hidden' : ''}>
            <button type="button" class="chm-sec-head" aria-expanded="${open}">
                <span class="chm-sec-title">${sec.title}</span>
                <span class="chm-sec-line"></span>
                <span class="chm-sec-en">${sec.en}</span>
                <i class="fa-solid fa-chevron-down chm-chev"></i>
            </button>
            <div class="chm-sec-body">${body}</div>
        </section>`;
}

function anyGroupOpen() {
    return !isHidden('details') && isSecOpen('details') && Object.keys(data.detGroups).some(isGroupOpen);
}

function anySectionOpen() {
    return SECTIONS.some((x) => !isHidden(x.id) && isSecOpen(x.id));
}

/** Подпись кнопки сворачивания — как в «Персонаже»: «Свернуть всё» → «Свернуть разделы» → «Развернуть разделы». */
function renderCollapseLabel() {
    const btn = col?.querySelector('.chm-scene-collapse');
    if (!btn) return;
    if (anyGroupOpen()) btn.innerHTML = '<i class="fa-solid fa-compress"></i> Свернуть всё';
    else if (anySectionOpen()) btn.innerHTML = '<i class="fa-solid fa-angles-up"></i> Свернуть разделы';
    else btn.innerHTML = '<i class="fa-solid fa-angles-down"></i> Развернуть разделы';
}

/** Привести DOM в соответствие с состоянием «развёрнуто / свёрнуто / скрыто». */
function applyOpenStates() {
    if (!col) return;
    for (const sec of col.querySelectorAll('.chm-scene-sec')) {
        const id = sec.dataset.sec;
        const open = isSecOpen(id);
        sec.classList.toggle('chm-open', open);
        sec.querySelector('.chm-sec-head').setAttribute('aria-expanded', String(open));
        sec.hidden = isHidden(id);
    }
    for (const grp of col.querySelectorAll('.chm-scene-grp')) {
        const open = isGroupOpen(grp.dataset.group);
        grp.classList.toggle('chm-open', open);
        grp.querySelector('.chm-catbox-toggle').setAttribute('aria-expanded', String(open));
    }
    renderCollapseLabel();
}

function collapseStep() {
    const ui = st().ui;
    if (anyGroupOpen()) ui.groups = {};
    else if (anySectionOpen()) for (const x of SECTIONS) ui.open[x.id] = false;
    else for (const x of SECTIONS) ui.open[x.id] = true;
    saveSettings();
    applyOpenStates();
}

function sectionCount(id) {
    if (id === 'chars') return SLOT_KEYS.filter((k) => slotFilled(k)).length;
    if (id === 'details') return st().details.length;
    return 0;
}

/** Меню «Разделы»: галочки показывать/скрыть и счётчики выбранного. */
function renderSecMenu() {
    const menu = col?.querySelector('.chm-secmenu');
    if (!menu) return;
    menu.innerHTML = `
        ${SECTIONS.map((x) => `
            <label class="chm-secmenu-item${x.hideable ? '' : ' chm-disabled'}" ${x.hideable ? '' : 'title="Основа сцены — скрыть нельзя"'}>
                <input type="checkbox" data-sec="${x.id}" ${isHidden(x.id) ? '' : 'checked'} ${x.hideable ? '' : 'disabled'}>
                <span class="chm-secmenu-name">${x.title}</span>
                <span class="chm-secmenu-n">${x.hideable && sectionCount(x.id) ? sectionCount(x.id) : ''}</span>
            </label>`).join('')}
        <div class="chm-set-hint">Скрытые разделы в промте не участвуют, цифра — сколько в них выбрано</div>`;
    menu.hidden = !secMenuOpen;
    col.querySelector('.chm-scene-eye')?.setAttribute('aria-expanded', String(secMenuOpen));
}

function setSecMenu(open) {
    secMenuOpen = open;
    renderSecMenu();
}

// ----- Библиотека поз (выпадающая панель) -----

function setLib(open) {
    const was = libOpen;
    libOpen = open;
    const lib = col?.querySelector('.chm-poselib');
    if (!lib) return;
    lib.hidden = !open;
    if (was && !open && st().q) {
        // закрыли библиотеку — поиск сбрасывается (иначе скрытая строка тихо сужала бы рандом и ‹ ›)
        st().q = '';
        col.querySelector('.chm-scene-q').value = '';
        renderPoseList();
        saveSettings();
    }
    col.querySelector('.chm-pose-current')?.setAttribute('aria-expanded', String(open));
    if (open) {
        scrollActivePose();
        col.querySelector('.chm-scene-q')?.focus({ preventScroll: true });
    }
}

/** Закрыть всплывающее (библиотеку, меню «Разделы», ввод чипа). true — если что-то закрыли: тогда Esc окно не закрывает. */
export function closeSceneOverlays() {
    let closed = false;
    if (libOpen) { setLib(false); closed = true; }
    if (secMenuOpen) { setSecMenu(false); closed = true; }
    if (chipEditor) { const g = chipEditor; chipEditor = ''; renderGroup(g); closed = true; }
    return closed;
}

export function isSceneOverlayOpen() {
    return libOpen || secMenuOpen || Boolean(chipEditor);
}

function setPose(name) {
    const s = st();
    s.pose = name;
    col?.querySelectorAll('.chm-pose').forEach((b) => {
        const on = b.dataset.pose === name;
        b.classList.toggle('chm-active', on);
        b.setAttribute('aria-selected', String(on));
    });
    updatePoseLabel();
    renderSlots();
    renderComicRow();
    save();
}

/** ‹ › — соседняя поза в текущем списке (с учётом категории и поиска). */
function stepPose(dir) {
    const list = filteredPoses();
    if (!list.length) return;
    let i = list.indexOf(st().pose);
    i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    setPose(list[i]);
    scrollActivePose();
}

function colHtml() {
    const s = st();
    const cats = CATS.map((c) => `<button type="button" class="chm-chip chm-scene-cat${c.id === s.cat ? ' chm-active' : ''}" data-cat="${c.id}">${escapeHtml(c.label)} <span class="chm-scene-cat-n">${data.counts[c.id] || 0}</span></button>`).join('');

    const chars = `
        <div class="chm-slots-head">
            <button type="button" class="chm-btn chm-slot-swap" title="Поменять A и B местами: актив остаётся активом, меняются люди"><i class="fa-solid fa-right-left"></i> Поменять местами</button>
        </div>
        <div class="chm-slots-body"></div>
        <div class="chm-set-hint">«Имя в промте» — латиницей, например Veyne. Нужно, чтобы панели комикса ссылались на персонажей. У персонажа из «Моих» подставляется его имя, если оно латиницей.</div>`;

    const pose = `
        <div class="chm-frame-grid">
            <div class="chm-frame-cell chm-frame-pose">
                <div class="chm-frame-label"><i class="fa-solid fa-people-arrows"></i> Поза / действие <button type="button" class="chm-pose-filter" hidden title="Сбросить категорию (она сужает «Случайную сцену» и ‹ ›)"></button> ${lockBtn('pose')}</div>
                <div class="chm-pose-picker">
                    <button type="button" class="chm-btn chm-pose-prev" title="Предыдущая поза в списке" aria-label="Предыдущая поза">‹</button>
                    <button type="button" class="text_pole chm-pose-current" aria-haspopup="listbox" aria-expanded="false" title="Открыть библиотеку поз">
                        <span class="chm-pose-current-name"></span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                    </button>
                    <button type="button" class="chm-btn chm-pose-next" title="Следующая поза в списке" aria-label="Следующая поза">›</button>
                </div>
            </div>
            <div class="chm-frame-cell">
                <div class="chm-frame-label"><i class="fa-solid fa-location-dot"></i> Место ${lockBtn('place')}</div>
                <select class="text_pole chm-scene-place" title="«${NO_PLACE_LABEL}» — у многих поз есть своё место. Выбранное здесь перебьёт место позы.">${placeOptions()}</select>
            </div>
            <div class="chm-frame-cell">
                <div class="chm-frame-label"><i class="fa-solid fa-camera"></i> Ракурс ${lockBtn('shot')}</div>
                <select class="text_pole chm-scene-shot">${shotOptions()}</select>
            </div>
            <div class="chm-poselib" hidden>
                <div class="chm-card-head"><i class="fa-solid fa-book-open"></i> Библиотека поз <span class="chm-scene-shown"></span></div>
                <label class="chm-search chm-scene-search">
                    <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                    <input type="search" class="chm-search-input chm-scene-q" placeholder="Найти позу…" autocomplete="off" spellcheck="false" value="${escapeHtml(s.q)}">
                </label>
                <div class="chm-scene-cats">${cats}</div>
                <div class="chm-scene-poses" role="listbox" aria-label="Поза"></div>
            </div>
        </div>
        <div class="chm-comic-row">
            <label class="chm-switch">
                <input type="checkbox" class="chm-comic-toggle">
                <span class="chm-switch-track"></span>
                <span class="chm-switch-label">Комикс по сюжету позы</span>
            </label>
            <span class="chm-comic-count"></span>
        </div>
        <div class="chm-set-hint chm-comic-hint"></div>`;

    const details = `
        <div class="chm-details-head">
            <span class="chm-set-hint">выбранное идёт в общий блок промта</span>
            ${lockBtn('details')}
        </div>
        <div class="chm-scene-groups">${detailsHtml()}</div>`;

    return `
        <div class="chm-scene-bar">
            <button type="button" class="chm-btn chm-scene-roll" title="Перебросить всё, что не закреплено замочком"><i class="fa-solid fa-dice"></i> Случайная сцена</button>
            <button type="button" class="chm-btn chm-scene-reset" title="Сбросить место, ракурс и детали (поза остаётся)"><i class="fa-solid fa-rotate-left"></i> Очистить</button>
        </div>
        <div class="chm-scene-tools">
            <button type="button" class="chm-btn chm-scene-collapse"></button>
            <span class="chm-scene-secwrap">
                <button type="button" class="chm-btn chm-scene-eye" title="Показать / скрыть разделы" aria-expanded="false" aria-label="Разделы"><i class="fa-solid fa-eye"></i></button>
                <div class="chm-secmenu" hidden></div>
            </span>
        </div>
        ${sectionHtml(SECTIONS[0], chars)}
        ${sectionHtml(SECTIONS[1], pose)}
        ${sectionHtml(SECTIONS[2], details)}
`;
}

function partsHtml(built) {
    if (!built.parts.length) return '<span class="chm-prompt-empty">// выбери позу слева</span>';
    const comma = '<span class="chm-pcomma">, </span>';
    return built.parts.map((p) => `
        <div class="chm-scene-part">
            <div class="chm-scene-part-l">${escapeHtml(p.label)}${p.who ? ` · ${escapeHtml(p.who)}` : ''}</div>
            <div class="chm-scene-text">${[...(p.lead ? [p.lead] : []), ...p.tags].map((t) => `<span class="chm-ptag${/^panel \d+:/.test(t) ? ' chm-ptag-panel' : ''}">${escapeHtml(t)}</span>`).join(comma)}</div>
        </div>`).join('');
}

// Внимание: panel.js ищет в правой колонке `.chm-prompt-text` и `.chm-panel-count` через querySelector (первое совпадение).
// Блок сцены лежит выше настоящего промта персонажа, поэтому у него СВОИ классы (chm-scene-text, chm-scene-count).
function sideHtml() {
    return `
        <div class="chm-scene-head">
            <span class="chm-panel-title">Сцена</span>
            <span class="chm-scene-count">0 тег.</span>
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
    libOpen = false;
    chipEditor = '';
    secMenuOpen = false;
    col.innerHTML = colHtml();
    renderSlots();
    renderComicRow();
    renderPoseList();
    updatePoseLabel();
    renderSecMenu();
    renderCollapseLabel();
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
    if (!L.details && !isHidden('details')) {
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

/** Сохранить свой чип (один тег, без запятых). */
function commitChip(group) {
    const grp = [...col.querySelectorAll('.chm-scene-grp')].find((x) => x.dataset.group === group);
    const input = grp?.querySelector('.chm-det-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) {
        chipEditor = '';
        renderGroup(group);
        return;
    }
    if (text.includes(',')) {
        const hint = grp.querySelector('.chm-det-hint');
        hint.textContent = 'Один тег на чип — без запятых';
        hint.hidden = false;
        input.focus({ preventScroll: true });
        return;
    }
    const s = st();
    const all = [...(data.detGroups[group] || []), ...customList(group)];
    const existing = all.find((x) => x.toLowerCase() === text.toLowerCase());   // такой уже есть — просто выбираем его
    const value = existing || text;
    if (!existing) {
        if (!s.customChips[group]) s.customChips[group] = [];
        s.customChips[group].push(value);
    }
    if (!s.details.includes(value)) s.details.push(value);
    chipEditor = '';
    renderGroup(group);
    renderSecMenu();
    save();
}

function onClick(e) {
    if (!data) return;
    const s = st();
    const t = e.target;

    // Ввод своего чипа открыт, а кликнули мимо него: отменяем ввод (клик съедаем, чтобы не промахнуться по чипам)
    if (chipEditor && !t.closest('.chm-det-edit')) {
        const g = chipEditor;
        chipEditor = '';
        renderGroup(g);
        return;
    }
    // Меню «Разделы» и библиотека закрываются кликом мимо
    if (secMenuOpen && !t.closest('.chm-scene-secwrap')) setSecMenu(false);
    if (libOpen && !t.closest('.chm-poselib') && !t.closest('.chm-frame-pose')) setLib(false);

    if (t.closest('.chm-scene-roll')) {
        rollScene();
        return;
    }
    if (t.closest('.chm-slot-swap')) {
        swapSlots();
        return;
    }

    // Разделы и группы
    const secHead = t.closest('.chm-sec-head');
    if (secHead) {
        const id = secHead.closest('.chm-scene-sec').dataset.sec;
        s.ui.open[id] = !isSecOpen(id);
        saveSettings();
        applyOpenStates();
        return;
    }
    const grpToggle = t.closest('.chm-catbox-toggle');
    if (grpToggle) {
        const g = grpToggle.closest('.chm-scene-grp').dataset.group;
        s.ui.groups[g] = !isGroupOpen(g);
        saveSettings();
        applyOpenStates();
        return;
    }
    if (t.closest('.chm-scene-collapse')) {
        collapseStep();
        return;
    }
    if (t.closest('.chm-scene-eye')) {
        setSecMenu(!secMenuOpen);
        return;
    }

    const lock = t.closest('.chm-lock');
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

    // Поза: фильтр-чип, поле, ‹ ›, библиотека
    if (t.closest('.chm-pose-filter')) {
        s.cat = 'all';
        col.querySelectorAll('.chm-scene-cat').forEach((b) => b.classList.toggle('chm-active', b.dataset.cat === 'all'));
        renderPoseList();
        updatePoseLabel();
        saveSettings();
        return;
    }
    if (t.closest('.chm-pose-current')) {
        setLib(!libOpen);
        return;
    }
    if (t.closest('.chm-pose-prev')) {
        stepPose(-1);
        return;
    }
    if (t.closest('.chm-pose-next')) {
        stepPose(1);
        return;
    }
    const cat = t.closest('[data-cat]');
    if (cat) {
        s.cat = cat.dataset.cat;
        col.querySelectorAll('.chm-scene-cat').forEach((b) => b.classList.toggle('chm-active', b === cat));
        const list = filteredPoses();
        if (list.length && !list.includes(s.pose)) s.pose = list[0];   // как у подруги: если позы нет в разделе, встаёт первая
        renderPoseList();
        updatePoseLabel();
        renderSlots();
        renderComicRow();
        save();
        return;
    }
    const pose = t.closest('.chm-pose');
    if (pose) {
        setPose(pose.dataset.pose);
        setLib(false);
        return;
    }

    // Детали: свои чипы
    const del = t.closest('.chm-det-x');
    if (del) {
        const g = del.dataset.group;
        const d = del.dataset.d;
        s.customChips[g] = customList(g).filter((x) => x !== d);
        s.details = s.details.filter((x) => x !== d);
        renderGroup(g);
        renderSecMenu();
        save();
        return;
    }
    const add = t.closest('.chm-det-add');
    if (add) {
        chipEditor = add.closest('.chm-scene-grp').dataset.group;
        renderGroup(chipEditor);
        return;
    }
    if (t.closest('.chm-det-ok')) {
        commitChip(t.closest('.chm-det-edit').dataset.group);
        return;
    }
    if (t.closest('.chm-det-cancel')) {
        const g = t.closest('.chm-det-edit').dataset.group;
        chipEditor = '';
        renderGroup(g);
        return;
    }

    // Детали: выбор чипа
    const det = t.closest('.chm-det');
    if (det) {
        const d = det.dataset.d;
        const set = new Set(s.details);
        if (set.has(d)) set.delete(d);
        else set.add(d);
        s.details = [...set];
        renderGroup(det.closest('.chm-scene-grp').dataset.group);
        renderSecMenu();
        save();
        return;
    }

    if (t.closest('.chm-scene-reset')) {
        s.place = '';
        s.shot = '';
        s.details = [];
        renderCol();
        save();
    }
}

/** Enter сохраняет свой чип, Esc отменяет ввод (и не закрывает окно). */
function onKeydown(e) {
    const input = e.target.closest?.('.chm-det-input');
    if (!input) return;
    if (e.key === 'Enter') {
        e.preventDefault();
        commitChip(input.closest('.chm-det-edit').dataset.group);
    } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        const g = chipEditor;
        chipEditor = '';
        if (g) renderGroup(g);
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
        return;
    }
    const name = e.target.closest('.chm-slot-name');
    if (name) {
        st().slots[name.closest('.chm-slot').dataset.slot].name = name.value;
        save();
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
            // имя в промте: имя персонажа, если оно латиницей, иначе пусто (впишут руками)
            slot.name = latinName((getSettings().characters || []).find((c) => c.id === slot.charId)?.name);
            card.querySelector('.chm-slot-name').value = slot.name;
        } else {
            slot.src = '';
            slot.charId = '';
        }
        card.querySelector('.chm-slot-text').hidden = slot.src !== 'text';
        card.querySelector('.chm-slot-empty').hidden = Boolean(slot.src);
        save();
    } else if (e.target.closest('.chm-secmenu input[data-sec]')) {
        const id = e.target.dataset.sec;
        st().ui.hidden[id] = !e.target.checked;
        applyOpenStates();
        renderSecMenu();
        save();   // скрытый раздел не участвует в промте
    } else if (e.target.closest('.chm-comic-toggle')) {
        st().comic = e.target.checked;
        renderComicRow();
        save();
    } else if (e.target.closest('.chm-slot-gender')) {
        st().slots[e.target.closest('.chm-slot').dataset.slot].gender = e.target.value;
        save();
    }
}

/** Быстрый поиск по позам: «/» в режиме «Сцена». */
export function focusPoseSearch() {
    if (!data || !col) return;
    const sec = col.querySelector('.chm-scene-sec[data-sec="pose"]');
    if (sec && !sec.classList.contains('chm-open')) {
        st().ui.open.pose = true;
        saveSettings();
        applyOpenStates();
    }
    setLib(true);
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
    col.addEventListener('keydown', onKeydown);
    // Клик мимо колонки тоже закрывает библиотеку, меню «Разделы» и ввод чипа
    document.addEventListener('click', (e) => {
        // composedPath: к этому моменту кликнутый элемент мог быть уже перерисован (отцеплен), contains() ошибся бы
        if (col && !e.composedPath().includes(col)) closeSceneOverlays();
    });

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
