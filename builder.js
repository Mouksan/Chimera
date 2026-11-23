// Chimera — сборка промта из выбранных тегов.
// Чистые функции: на вход база и настройки, на выход строки для панели и текст промта.

import { getSettings } from './store.js';

// ---------- Порядок в промте (как на сайте: персонаж, потом поза, фон в конце) ----------

const SECTION_ORDER = ['who', 'body', 'head', 'eyes', 'face', 'hair', 'wings_tails', 'pose', 'franchise', 'scene'];

// ---------- Цвета частей и оттенки ----------

export const PART_COLORS = [
    { key: 'red', ru: 'красный', css: '#e04848' },
    { key: 'orange', ru: 'оранжевый', css: '#f0902a' },
    { key: 'yellow', ru: 'жёлтый', css: '#f2d23c' },
    { key: 'green', ru: 'зелёный', css: '#3cb15a' },
    { key: 'aqua', ru: 'бирюзовый', css: '#4fd1c5' },
    { key: 'blue', ru: 'синий', css: '#4a7cf0' },
    { key: 'purple', ru: 'фиолетовый', css: '#9b5bd8' },
    { key: 'pink', ru: 'розовый', css: '#ee8fb8' },
    { key: 'brown', ru: 'коричневый', css: '#8b5a2b' },
    { key: 'black', ru: 'чёрный', css: '#26262b' },
    { key: 'grey', ru: 'серый', css: '#9a9a9a' },
    { key: 'white', ru: 'белый', css: '#f4f4f4' },
    { key: 'silver', ru: 'серебряный', css: '#c0c4cc' },
    { key: 'gold', ru: 'золотой', css: '#e0b23c' },
    { key: 'rainbow', ru: 'радужный', css: 'conic-gradient(#e04848, #f0902a, #f2d23c, #3cb15a, #4a7cf0, #9b5bd8, #e04848)' },
];

export const SHADES = [
    { key: 'light', ru: 'светло-' },
    { key: 'dark', ru: 'тёмно-' },
    { key: 'pale', ru: 'бледно-' },
    { key: 'pastel', ru: 'пастельно-' },
    { key: 'neon', ru: 'неоново-' },
];

const COLOR = Object.fromEntries(PART_COLORS.map((c) => [c.key, c]));
const SHADE = Object.fromEntries(SHADES.map((s) => [s.key, s]));

// Части, которым можно дать цвет, и как они зовутся отдельным тегом при «цвет одним тегом» = выкл
const PART_NOUN = {
    ears: 'ears',
    horns: 'horns',
    wings: 'wings',
    tails: 'tail',
    halo: 'halo',
    mushroom_cap: 'mushroom hat',
};
// Подгруппы внутри частей, которые не красим (действия и аксессуары — не сама часть)
const NOT_PART_SUBS = new Set(['Действия', 'Аксессуары', 'Украшения', 'Предметы']);

// Многоцветные теги: выбранные цвета уходят отдельными тегами «<цвет> <это>»
const MULTI_NOUN = {
    eye_color: 'eyes',
    hair_pattern: 'hair',
    skin_special: 'skin',
    lip_makeup: 'lips',
    eye_makeup: 'eyeshadow',
};
export const MULTI_MAX = 3;

// Общие теги «само»: к виду части сам добавляется общий тег.
// Как на сайте — только уши и рога (к хвостам и крыльям сайт ничего не добавляет).
const GENERIC = {
    ears: { en: 'animal ears', ru: 'звериные уши', when: (t) => t.sub === 'a' && t.en !== 'animal ears' },
    horns: { en: 'horns', ru: 'рога', when: (t) => (t.sub === 'b' || t.sub === 'd') && t.en !== 'horns' },
};

const CLOTHING = ['clothed', 'fashion'];

/** Какие общие теги сейчас вызваны сборкой (для чистки «снятых руками»). */
export function triggeredGenerics(db, build) {
    const out = new Set();
    for (const b of build) {
        const tag = db.tags.get(b.id);
        const gen = tag && GENERIC[tag.catId];
        if (gen && gen.when(tag)) out.add(gen.en);
    }
    return out;
}

// ---------- Что умеет тег ----------

/** Цвет части: уши, рога, крылья, хвосты, нимб, шапочка гриба. */
export function isPart(tag, db) {
    if (!PART_NOUN[tag.catId] || tag.en.startsWith('no ')) return false;
    const cat = db.cats.get(tag.catId);
    const sub = cat.subs.find((s) => s.key === tag.sub);
    return !(sub && NOT_PART_SUBS.has(sub.title));
}

/** Оттенок цветного тега: у тегов с кружком из палитры (кожа, глаза, волосы…). */
export function isShadeable(tag) {
    return /^#[a-z]+$/.test(tag.swatch || '') && !['#rainbow', '#checker'].includes(tag.swatch);
}

/** Многоцветный тег: гетерохромия, двухцветные, градиентные, разноцветные. */
export function isMulti(tag) {
    return Boolean(MULTI_NOUN[tag.catId]) && /[/>]|rainbow/.test(tag.swatch || '');
}

export function colorLabel(color) {
    if (!color?.c || !COLOR[color.c]) return '';
    const base = COLOR[color.c].ru;
    return color.s && SHADE[color.s] && color.c !== 'rainbow' ? `${SHADE[color.s].ru}${base}` : base;
}

export function colorCss(key) {
    return COLOR[key]?.css || null;
}

// ---------- Пол ----------

/** 'f' | 'm' | 'o' | null — какой пол выбран в сборке. */
export function currentGender(db, build = getSettings().build) {
    for (const b of build) {
        const t = db.tags.get(b.id);
        if (t?.gender) return t.gender;
    }
    return null;
}

/** Тег не подходит выбранному полу (касается только рас и половых признаков). */
export function isIncompatible(tag, gender) {
    return Boolean(tag.sex && gender && gender !== 'o' && tag.sex !== gender);
}

/** Английский тег с учётом пола: при мужском «cat girl» → «cat boy». */
export function genderedEn(tag, gender) {
    if (gender === 'm' && tag.catId === 'race' && !tag.sex && / girl$/.test(tag.en)) {
        return tag.en.replace(/ girl$/, ' boy');
    }
    return tag.en;
}

// ---------- Веса ----------

export function formatWeight(w) {
    return String(Math.round(w * 100) / 100);
}

function weighted(text, w, toggles) {
    if (!toggles.weights || Math.abs(w - 1) < 0.001) return text;
    const n = formatWeight(w);
    return toggles.naiWeights ? `${n}::${text}::` : `(${text}:${n})`;
}

// ---------- Сборка ----------

function splitList(text) {
    return String(text || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

/** Порядковый номер тега в промте: раздел → категория → место в категории. */
function makeOrder(db) {
    const order = new Map();
    let i = 0;
    const sections = [...db.sections].sort((a, b) => {
        const ia = SECTION_ORDER.indexOf(a.id);
        const ib = SECTION_ORDER.indexOf(b.id);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    for (const sec of sections) {
        for (const cat of sec.cats) {
            for (const tag of cat.tags) order.set(tag.id, i++);
        }
    }
    return order;
}

let orderCache = null;
let orderDb = null;

// Пол персонажа «из текста» → тег в начало промта
export const GENDER_FROM_CHAR = {
    m: { key: '1boy', ru: 'мужской (из карточки)', en: '1boy' },
    f: { key: '1girl', ru: 'женский (из карточки)', en: '1girl' },
    x: { key: '1girl, futanari', ru: 'футанари (из карточки)', en: '1girl, futanari' },
};

/**
 * Собрать строки панели и промт.
 * @returns {{ rows: object[], positive: string, negative: string, gender: string|null, count: number }}
 *   rows: { kind: 'tag' | 'auto' | 'clothing', ... } — в порядке промта
 */
export function buildPrompt(db, s = getSettings()) {
    if (orderDb !== db) {
        orderCache = makeOrder(db);
        orderDb = db;
    }
    const toggles = s.toggles;
    const gender = currentGender(db, s.build);
    const autoOff = new Set(s.autoOff);

    const items = s.build
        .map((b) => ({ b, tag: db.tags.get(b.id) }))
        .filter((x) => x.tag)
        .sort((x, y) => orderCache.get(x.tag.id) - orderCache.get(y.tag.id));

    const selectedEn = new Set(items.map((x) => x.tag.en));
    const rows = [];
    const autoDone = new Set();

    for (const { b, tag } of items) {
        // Общий тег «само» — перед первым тегом, который его вызвал
        const gen = GENERIC[tag.catId];
        if (toggles.genericTags && gen && gen.when(tag) && !selectedEn.has(gen.en) && !autoDone.has(gen.en)) {
            autoDone.add(gen.en);
            if (!autoOff.has(gen.en)) {
                rows.push({ kind: 'auto', key: gen.en, ru: gen.ru, text: gen.en, plain: [gen.en] });
            }
        }

        const en = genderedEn(tag, gender);
        // Пол и раса веса не получают (как на сайте)
        const noWeight = Boolean(tag.gender) || tag.catId === 'race';
        const w = noWeight ? 1 : (Number(b.weight) || 1);
        const extra = [];
        let main = en;

        if (b.color) {
            const c = COLOR[b.color.c] ? b.color.c : null;
            const shade = b.color.s && SHADE[b.color.s] && c !== 'rainbow' ? `${b.color.s} ` : '';
            if (isPart(tag, db) && c) {
                // Уши, рога, крылья…: «pink cat ears» или отдельно «cat ears, pink ears»
                const colorWord = `${shade}${c}`;
                if (toggles.colorOneTag) main = `${colorWord} ${en}`;
                else extra.push(`${colorWord} ${PART_NOUN[tag.catId]}`);
            } else if (isShadeable(tag) && shade) {
                // Цветной тег с оттенком: «dark red skin»
                main = `${shade}${en}`;
            }
        }

        if (isMulti(tag) && Array.isArray(b.colors)) {
            for (const c of b.colors.slice(0, MULTI_MAX)) {
                if (COLOR[c]) extra.push(`${c} ${MULTI_NOUN[tag.catId]}`);
            }
        }

        const text = [weighted(main, w, toggles), ...extra].join(', ');
        rows.push({ kind: 'tag', id: tag.id, tag, b, en: main, text, plain: [main, ...extra], weight: w, noWeight });
    }

    // Пол из карточки персонажа, если в сборке нет тега пола (персонажи «из текста»)
    if (!gender) {
        const ch = s.loadedCharId ? (s.characters || []).find((c) => c.id === s.loadedCharId) : null;
        const g = GENDER_FROM_CHAR[ch?.gender];
        if (g && !autoOff.has(g.key)) {
            rows.unshift({ kind: 'auto', key: g.key, ru: g.ru, text: g.en, plain: g.en.split(', '), hint: 'Пол из карточки персонажа — в сборке нет тега пола' });
        }
    }

    // Свои готовые теги персонажа — в конец его блока (дубли каталожных не повторяем)
    const already = new Set(rows.flatMap((r) => r.plain).map((x) => x.toLowerCase()));
    const own = splitList(s.ownTags).filter((t) => !already.has(t.toLowerCase()));

    // Пустую сборку одеждой не украшаем
    if (toggles.clothing && (rows.length || own.length)) {
        for (const c of CLOTHING) {
            const lc = c.toLowerCase();
            if (!selectedEn.has(c) && !own.some((x) => x.toLowerCase() === lc)) rows.push({ kind: 'clothing', key: c, text: c, plain: [c] });
        }
    }

    // Свои теги: в начало, в конец или «разделить» — до «|» в начало, после — в конец
    const custom = s.custom || {};
    let head = [];
    let tail = [];
    if (custom.place === 'split') {
        const [a, ...rest] = String(custom.text || '').split('|');
        head = splitList(a);
        tail = splitList(rest.join(','));
    } else if (custom.place === 'end') {
        tail = splitList(custom.text);
    } else {
        head = splitList(custom.text);
    }

    // Порядок: теги каталога → свои теги → одежда (она общая, не про внешность)
    const body = rows.filter((r) => r.kind !== 'clothing').map((r) => r.text);
    const dress = rows.filter((r) => r.kind === 'clothing').map((r) => r.text);
    const positive = [...head, ...body, ...own, ...dress, ...tail].join(', ');

    // Негатив: тег, выбранный в плюс, в негатив не уходит
    const plus = new Set([...head, ...tail, ...own, ...rows.flatMap((r) => r.plain)].map((x) => x.toLowerCase()));
    const negList = splitList(s.negative);
    const negKept = negList.filter((t) => !plus.has(t.toLowerCase()));
    const negative = negKept.join(', ');

    return {
        rows,
        head,
        own,
        tail,
        positive,
        negative,
        negDropped: negList.length - negKept.length,
        gender,
        count: items.length,
    };
}
