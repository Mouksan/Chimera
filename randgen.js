// Chimera — «Рандом всего», «Просто рандом», пресеты-архетипы и «Новая палитра».
//
// Порядок сборки: пол → раса и звериные части (или пресет) → обязательное
// (телосложение, кожа, цвет глаз, длина и цвет волос, причёска) → необязательные
// категории по детализации → цвета частей → лёгкие веса.
// Закреплённое не трогаем, забаненное не берём, чужой пол и конфликты не собираем.

import { getSettings, saveSettings } from './store.js';
import { bannedSet, isBanned } from './bans.js';
import { wouldConflict } from './conflicts.js';
import { isIncompatible, isPart, isMulti, MULTI_MAX } from './builder.js';
import { pickWeighted, tagChance, pushHistory } from './random.js';

const LOG = '[Chimera]';

// ---------- Справочники для интерфейса ----------

export const MODES = [
    { id: 'main', label: 'Основной', hint: 'Умный рандом: все правила работают. Звериные уши и хвост — примерно у каждого третьего.' },
    { id: 'random', label: 'Рандом', hint: 'Чистый случай: правила выключены, сочетания любые. Баны, закрепы и конфликты всё равно соблюдаются.' },
    { id: 'wild', label: 'Удивительное', hint: 'В сторону не-хуманов: расы, звериные и фэнтези-части, необычная кожа и глаза выпадают заметно чаще.' },
];

export const WITHOUT = [
    { id: 'ears', label: 'ушей' },
    { id: 'wings', label: 'крыльев' },
    { id: 'tail', label: 'хвоста' },
    { id: 'horns', label: 'рогов' },
    { id: 'antennae', label: 'усиков' },
    { id: 'beastLegs', label: 'звериных ног' },
    { id: 'beastTraits', label: 'звериных черт' },
    { id: 'beastRaces', label: 'зверорас' },
    { id: 'fur', label: 'меха' },
    { id: 'human', label: 'обычный человек', title: 'Всё вышеперечисленное разом и никаких рас' },
];

export const SCHEMES = [
    { id: 'auto', label: 'Авто' },
    { id: 'mono', label: 'Монохром' },
    { id: 'adjacent', label: 'Соседние' },
    { id: 'split', label: 'Сплит' },
    { id: 'contrast', label: 'Контраст' },
    { id: 'triad', label: 'Триада' },
];

/**
 * Пресеты: основа, которую пресет держит при каждом нажатии рандома.
 *   gender — пол; race — 'none' | 'species' | [id…] | { subs: [...] };
 *   species — уши и хвост одного зверя; must — [[варианты…]] обязательно по одному;
 *   maybe — [[[варианты…], шанс]].
 */
export const PRESETS = [
    { id: 'girl', label: 'Девушка', icon: 'fa-venus', gender: 'f', race: 'none' },
    { id: 'man', label: 'Мужчина', icon: 'fa-mars', gender: 'm', race: 'none' },
    { id: 'other', label: 'Другое', icon: 'fa-genderless', gender: 'o' },
    {
        id: 'centaur', label: 'Кентавр', icon: 'fa-horse',
        race: ['race/centaur', 'race/centauroid'],
        must: [['legs/animal legs', 'legs/animal legs, fluffy legs']],
        maybe: [[['tails/horse tail'], 0.8], [['ears/horse ears'], 0.3]],
    },
    { id: 'kemono', label: 'Кемономими', icon: 'fa-cat', race: 'none', species: { ears: 1, tail: 1, race: 0 } },
    {
        id: 'winged', label: 'Крылатые', icon: 'fa-feather',
        must: [{ cat: 'wings', subs: ['b', 'c'] }],
    },
    {
        id: 'furry', label: 'Фурри', icon: 'fa-paw', race: 'species',
        species: { ears: 1, tail: 1, race: 1, marks: 0.5 },
        must: [['beast_traits/furry']],
        maybe: [[['beast_traits/body fur'], 0.6], [['beast_traits/paws', 'beast_traits/claws'], 0.5], [['legs/animal legs', 'legs/animal legs, fluffy legs'], 0.4]],
    },
    {
        id: 'beast', label: 'Цельный зверь', icon: 'fa-dog', race: 'species',
        species: { ears: 1, tail: 1, race: 1, marks: 0.8 },
        must: [['beast_traits/furry'], ['beast_traits/body fur'], ['legs/animal legs', 'legs/animal legs, fluffy legs']],
        maybe: [[['beast_traits/paws'], 0.7], [['beast_traits/claws'], 0.5], [['beast_traits/whiskers'], 0.3]],
    },
    {
        id: 'angel', label: 'Ангел', icon: 'fa-dove', race: { subs: ['c'] },
        must: [['wings/angel wings', 'wings/feathered wings', 'wings/seraph wings']],
        maybe: [[['halo/halo', 'halo/traditional halo', 'halo/glowing halo', 'halo/winged halo'], 0.8]],
    },
    {
        id: 'demon', label: 'Демон', icon: 'fa-fire', race: { subs: ['d'] },
        must: [['horns/demon horns', 'horns/curled horns', 'horns/oni horns']],
        maybe: [[['tails/demon tail', 'tails/heart tail'], 0.7], [['wings/demon wings', 'wings/bat wings'], 0.45], [['mouth/fangs', 'mouth/fang'], 0.3]],
    },
    {
        id: 'android', label: 'Андроид', icon: 'fa-robot', race: 'none',
        must: [['fantasy_parts/robot joints']],
        pick: [2, ['ears/robot ears', 'ears/mechanical ears', 'eye_features/mechanical eyes', 'legs/mechanical legs', 'skin_special/cyborg skin', 'horns/mechanical horns', 'wings/mechanical wings', 'halo/mechanical halo', 'tails/mechanical tail', 'skin_special/metal skin', 'tails/cable tail']],
    },
    {
        id: 'mushroom', label: 'Грибоголовые', icon: 'fa-seedling', race: 'none',
        must: [['mushroom_cap/mushroom hat']],
        maybe: [[['race/mushroom girl', 'race/mushroom boy'], 0.7], [['skin_special/mushrooms on body', 'skin_special/mushrooms on face'], 0.25]],
    },
    {
        id: 'fairy', label: 'Фея', icon: 'fa-wand-magic-sparkles', race: ['race/fairy'],
        must: [['wings/fairy wings', 'wings/butterfly wings', 'wings/dragonfly wings', 'wings/moth wings']],
        maybe: [[['ears/pointy ears', 'ears/long pointy ears'], 0.6]],
    },
    {
        id: 'mermaid', label: 'Русалка', icon: 'fa-fish', race: ['race/mermaid', 'race/merman'],
        must: [['tails/fish tail']],
        maybe: [[['beast_traits/fins'], 0.4], [['beast_traits/gills'], 0.25], [['beast_traits/scales'], 0.35]],
    },
    {
        id: 'dragon', label: 'Дракон', icon: 'fa-dragon', race: { subs: ['e'] },
        must: [['horns/dragon horns', 'horns/eastern dragon horns']],
        maybe: [[['tails/dragon tail', 'tails/eastern dragon tail'], 0.85], [['wings/dragon wings'], 0.5], [['beast_traits/scales'], 0.45], [['ears/dragon ears'], 0.25]],
    },
];

// ---------- Что приносят с собой фэнтези-расы ----------

const RACE_EXTRAS = {
    angel: [[['wings/angel wings', 'wings/feathered wings'], 0.8], [['halo/halo', 'halo/glowing halo'], 0.55]],
    archangel: [[['wings/angel wings', 'wings/multiple wings'], 0.9], [['halo/halo', 'halo/glowing halo'], 0.7]],
    seraph: [[['wings/seraph wings', 'wings/multiple wings'], 0.9], [['halo/halo'], 0.6]],
    cherub: [[['wings/angel wings', 'wings/mini wings'], 0.9], [['halo/halo'], 0.5]],
    valkyrie: [[['wings/feathered wings', 'wings/head wings'], 0.6]],
    demon: [[['horns/demon horns', 'horns/curled horns'], 0.85], [['tails/demon tail'], 0.6], [['wings/demon wings', 'wings/bat wings'], 0.35]],
    'demon girl': [[['horns/demon horns', 'horns/curled horns'], 0.85], [['tails/demon tail'], 0.6], [['wings/demon wings'], 0.35]],
    'demon boy': [[['horns/demon horns', 'horns/curled horns'], 0.85], [['tails/demon tail'], 0.6], [['wings/demon wings'], 0.35]],
    succubus: [[['horns/demon horns', 'horns/curled horns'], 0.8], [['tails/demon tail', 'tails/heart tail'], 0.75], [['wings/demon wings', 'wings/bat wings'], 0.6]],
    incubus: [[['horns/demon horns', 'horns/curled horns'], 0.8], [['tails/demon tail'], 0.7], [['wings/demon wings', 'wings/bat wings'], 0.55]],
    oni: [[['horns/oni horns'], 0.9]],
    'red oni': [[['horns/oni horns'], 0.9]],
    'blue oni': [[['horns/oni horns'], 0.9]],
    dragon: [[['horns/dragon horns'], 0.8], [['tails/dragon tail'], 0.8], [['wings/dragon wings'], 0.45], [['beast_traits/scales'], 0.4]],
    'eastern dragon': [[['horns/eastern dragon horns'], 0.85], [['tails/eastern dragon tail'], 0.8], [['beast_traits/scales'], 0.4]],
    'western dragon': [[['horns/dragon horns'], 0.8], [['tails/dragon tail'], 0.8], [['wings/dragon wings'], 0.6]],
    'dragon girl': [[['horns/dragon horns'], 0.85], [['tails/dragon tail'], 0.8], [['wings/dragon wings'], 0.4], [['beast_traits/scales'], 0.35]],
    'dragon boy': [[['horns/dragon horns'], 0.85], [['tails/dragon tail'], 0.8], [['wings/dragon wings'], 0.4], [['beast_traits/scales'], 0.35]],
    wyvern: [[['wings/dragon wings'], 0.9], [['tails/dragon tail'], 0.7]],
    elf: [[['ears/pointy ears', 'ears/long pointy ears'], 0.9]],
    'dark elf': [[['ears/pointy ears', 'ears/long pointy ears'], 0.9]],
    'blood elf': [[['ears/long pointy ears'], 0.9]],
    fairy: [[['wings/fairy wings', 'wings/butterfly wings'], 0.9], [['ears/pointy ears'], 0.5]],
    vampire: [[['mouth/fangs', 'mouth/fang'], 0.6], [['ears/pointy ears'], 0.35]],
    kitsune: [[['ears/fox ears'], 0.9], [['tails/kitsune tails', 'tails/fox tail'], 0.9], [['tails/multiple tails'], 0.3]],
    kyuubi: [[['ears/fox ears'], 0.9], [['tails/kitsune tails'], 0.9]],
    werewolf: [[['ears/wolf ears'], 0.85], [['tails/wolf tail'], 0.8], [['beast_traits/claws'], 0.4]],
    tanuki: [[['ears/raccoon ears'], 0.7], [['tails/raccoon tail'], 0.7]],
    nekomata: [[['ears/cat ears'], 0.9], [['tails/cat tail'], 0.8], [['tails/forked tail'], 0.4]],
    bakeneko: [[['ears/cat ears'], 0.9], [['tails/cat tail'], 0.8]],
    mermaid: [[['tails/fish tail'], 0.85], [['beast_traits/fins'], 0.3]],
    merman: [[['tails/fish tail'], 0.85], [['beast_traits/fins'], 0.3]],
    lamia: [[['beast_traits/scales'], 0.5]],
    harpy: [[['wings/bird wings', 'wings/feathered wings'], 0.85]],
    tengu: [[['wings/crow wings', 'wings/feathered wings'], 0.6]],
    minotaur: [[['horns/bull horns'], 0.85], [['tails/bull tail'], 0.5]],
    satyr: [[['horns/goat horns'], 0.75], [['legs/animal legs'], 0.5]],
    faun: [[['horns/goat horns'], 0.65], [['legs/animal legs'], 0.5]],
    salamander: [[['tails/lizard tail'], 0.6], [['beast_traits/scales'], 0.4]],
    shinigami: [[['wings/skeletal wings'], 0.2]],
};

// Расы, которые в «Основном» выпадают чаще прочих фэнтези-рас
const COMMON_FANTASY = new Set(['elf', 'dark elf', 'demon', 'angel', 'vampire', 'dragon girl', 'dragon boy', 'fairy', 'kitsune', 'oni', 'succubus', 'incubus', 'werewolf', 'mermaid', 'merman', 'demon girl', 'demon boy']);
// Звери, чьи уши и хвост в «Основном» встречаются чаще
const COMMON_SPECIES = new Set(['cat', 'fox', 'wolf', 'dog', 'rabbit', 'mouse', 'bear', 'tiger', 'lion', 'horse', 'cow', 'sheep', 'deer', 'raccoon', 'squirrel', 'leopard', 'snow leopard', 'goat', 'bat', 'dragon']);

const ZOO_RACE_SUBS = new Set(['b', 'o', 'p', 'q', 'r', 's', 't']);
const SPECIES_FALLBACK = { o: 'cat', p: 'dog', q: 'bird', s: 'fish', t: 'lizard' };

// ---------- Категории ----------

/** Необязательные категории и их вес в «Основном». */
const OPTIONAL = {
    figure: 3, marks: 3, tattoos: 1.5, piercing: 2, pupils: 2, sclera: 0.5, eye_features: 2,
    eye_state: 1, gaze: 3, emotions: 3, smiles: 3, emoticons: 0.6, eyebrows: 1, mouth: 2, face_misc: 0.8,
    makeup: 1, lip_makeup: 1.5, eye_makeup: 1.5, nails: 1, hair_pattern: 1.5, hair_texture: 2, bangs: 3,
    crown: 1.5, hair_misc: 2, pose: 3, arms_torso: 2, head_pose: 1, pose_misc: 0.8, gestures: 2,
    view: 3, background: 3, breasts: 3, archetype: 1, skin_special: 0.4,
};
// В «Удивительном» эти тянут сильнее
const WILD_BOOST = { skin_special: 3, eye_features: 3, sclera: 2.5, pupils: 3, face_misc: 1.2, marks: 3.5, tattoos: 2 };
// «Просто рандом» не трогает
const SIMPLE_SKIP = new Set(['pose', 'arms_torso', 'head_pose', 'pose_misc', 'gestures', 'emotions', 'smiles', 'emoticons', 'gaze', 'eye_state', 'view', 'background']);
// Части: в «Основном» и «Удивительном» ими управляет раса или пресет, не общий пул
const PART_CATS = ['ears', 'horns', 'wings', 'tails', 'halo', 'antennae', 'legs', 'beast_traits', 'fantasy_parts', 'mushroom_cap', 'headless'];
// Не трогаем вовсе (кроме чистого случая)
const NEVER = new Set(['franchise_traits']);
// В мультикатегориях этих иногда берём два тега
const DOUBLE_OK = new Set(['marks', 'piercing', 'tattoos', 'eye_features', 'hair_misc', 'gestures', 'figure', 'makeup']);

/**
 * Что из категории годится в «Основном» (в «Удивительном» и чистом случае — всё).
 * Звериный окрас приходит только со своим зверем, странные материалы волос и лишние глаза — экзотика.
 */
const MAIN_FILTER = {
    marks: (t) => t.sub !== 'f',
    hair_misc: (t) => t.sub !== 'd' && t.sub !== 'f',
    eye_features: (t) => t.sub !== 'g' && t.sub !== 'e',
    skin_special: (t) => t.sub !== 'a',
    face_misc: (t, ctx) => t.sub === 'b' && ctx.gender === 'm',
};
const WILD_FILTER = {
    marks: (t) => t.sub !== 'f',
    face_misc: (t, ctx) => t.sub !== 'b' || ctx.gender === 'm',
};

const SHEETS = new Set(['view/expression chart', 'view/multiple views', 'view/reference sheet', 'view/character sheet']);

// ---------- Волосы ----------

const LENGTH_W = {
    'very short hair': 1, 'short hair': 3, 'medium hair': 3, 'long hair': 4, 'very long hair': 3,
    'absurdly long hair': 0.6, 'big hair': 0.5, bald: 0.12, 'bald female': 0.12, balding: 0.1, 'bald spot': 0.1,
};
const TRUE_BALD = new Set(['bald', 'bald female']);
const SHORTISH = new Set(['very short hair', 'short hair', 'balding', 'bald spot']);
const SHORT_CUTS = new Set(['buzz cut', 'crew cut', 'pixie cut', 'bowl cut', 'flattop', 'bob cut', 'inverted bob']);
const ANY_CUTS = new Set(['undercut', 'sidecut', 'mohawk', 'afro', 'huge afro', 'quiff', 'pompadour', 'oseledets']);
const HAIR_FAMILY = [['haircut', 3], ['ponytails', 2.5], ['braids', 1.5], ['buns', 1.5], [null, 1.5]];
const HAIR_EXTRAS = ['hair_pattern', 'hair_texture', 'bangs', 'crown', 'hair_misc'];

// ---------- Цвета ----------

const HUES = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'pink'];
const HAIR_NATURAL = { black: 3, brown: 3, blonde: 2.5, white: 1.2, grey: 0.8, red: 1 };
const EYE_NATURAL = { brown: 2, blue: 2, green: 1.5, grey: 1, black: 0.6 };
const PART_NEUTRAL = ['black', 'white', 'grey', 'gold', 'silver'];
const SHADE_KEYS = ['light', 'dark', 'pale', 'pastel', 'neon'];

function rand(p) {
    return Math.random() < p;
}

function pickOne(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function makePalette(schemeId) {
    const scheme = schemeId === 'auto' ? pickOne(['mono', 'adjacent', 'split', 'contrast', 'triad']) : schemeId;
    const b = Math.floor(Math.random() * HUES.length);
    const at = (d) => HUES[(b + d + HUES.length * 4) % HUES.length];
    const map = {
        mono: [at(0)],
        adjacent: [at(0), at(-1), at(1)],
        split: [at(0), at(3), at(5)],
        contrast: [at(0), at(4)],
        triad: [at(0), at(3), at(6)],
    };
    return { scheme, hues: map[scheme] || map.mono };
}

// ---------- Индекс видов: от зверя к его ушам, хвосту, крыльям, рогам, окрасу и расе ----------

let speciesIndex = null;
let speciesDb = null;

function strip(en, suffixes) {
    for (const s of suffixes) if (en.endsWith(s)) return en.slice(0, -s.length);
    return null;
}

function buildSpeciesIndex(db) {
    const idx = new Map();
    const put = (sp, kind, id) => {
        if (!sp) return;
        if (!idx.has(sp)) idx.set(sp, {});
        const e = idx.get(sp);
        if (!e[kind]) e[kind] = id;
    };
    for (const tag of db.tags.values()) {
        const en = tag.en;
        switch (tag.catId) {
            case 'ears': if (tag.sub === 'a') put(strip(en, [' ears']), 'ears', tag.id); break;
            case 'tails': put(strip(en, [' abdomen tail', ' tails', ' tail']), 'tail', tag.id); break;
            case 'wings': if (tag.sub === 'b') put(strip(en, [' wings']), 'wings', tag.id); break;
            case 'horns': if (tag.sub === 'b') put(strip(en, [' horns', ' horn', ' antlers']), 'horns', tag.id); break;
            case 'antennae': put(strip(en, [' antennae']), 'antennae', tag.id); break;
            case 'marks': if (tag.sub === 'f') put(en.replace(/ (spots|stripes|scales) on (the )?body$/, ''), 'marks', tag.id); break;
            case 'race':
                if (ZOO_RACE_SUBS.has(tag.sub) && !tag.sex) {
                    const sp = strip(en, [' girl']);
                    put(sp, 'race', tag.id);
                    if (sp) idx.get(sp).group = tag.sub;
                }
                break;
            default:
        }
    }
    // Породы без своих ушей/хвоста берут их у «родителя»: сиамская кошка → кошачьи уши
    for (const e of idx.values()) {
        const parent = idx.get(SPECIES_FALLBACK[e.group]);
        if (!parent) continue;
        for (const k of ['ears', 'tail', 'wings']) if (!e[k] && parent[k]) e[k] = parent[k];
    }
    return idx;
}

function species(db) {
    if (speciesDb !== db) {
        speciesIndex = buildSpeciesIndex(db);
        speciesDb = db;
    }
    return speciesIndex;
}

// ---------- Контекст одной сборки ----------

function expandWithout(list) {
    const set = new Set(list);
    if (set.has('human')) ['ears', 'wings', 'tail', 'horns', 'antennae', 'beastLegs', 'beastTraits', 'beastRaces', 'fur'].forEach((k) => set.add(k));
    return set;
}

const FUR_IDS = new Set(['beast_traits/body fur', 'beast_traits/furry', 'beast_traits/fluffy', 'legs/animal legs, fluffy legs', 'tails/fluffy tail', 'ears/ear fluff']);

/** «Рандом без…» запрещает тег? */
function withoutBlocks(tag, without) {
    if (!without.size) return false;
    const c = tag.catId;
    if (without.has('ears') && c === 'ears') return true;
    if (without.has('wings') && c === 'wings') return true;
    if (without.has('tail') && c === 'tails') return true;
    if (without.has('horns') && c === 'horns') return true;
    if (without.has('antennae') && c === 'antennae') return true;
    if (without.has('beastLegs') && c === 'legs' && tag.sub === 'a') return true;
    if (without.has('beastTraits') && c === 'beast_traits') return true;
    if (without.has('beastRaces') && ((c === 'race' && ZOO_RACE_SUBS.has(tag.sub)) || (c === 'marks' && tag.sub === 'f'))) return true;
    if (without.has('fur') && FUR_IDS.has(tag.id)) return true;
    if (without.has('human') && c === 'race') return true;
    return false;
}

function makeCtx(db, opts) {
    const s = getSettings();
    const rnd = s.rnd;
    const pure = rnd.mode === 'random' && !opts.preset;
    const rules = pure
        ? { kinship: false, hair: false, skin: false, sheets: false, partColor: 'stingy', palette: false, scheme: 'auto' }
        : { ...rnd.rules };
    const pinned = s.build.filter((b) => b.pinned).map((b) => structuredClone(b));
    const ctx = {
        db,
        mode: opts.preset ? (rnd.mode === 'random' ? 'main' : rnd.mode) : rnd.mode,
        pure,
        simple: Boolean(opts.simple),
        rules,
        detail: Math.min(10, Math.max(1, Number(rnd.detail) || 6)),
        without: expandWithout(rnd.without),
        banned: bannedSet(),
        build: pinned,
        ids: new Set(pinned.map((b) => b.id)),
        pinnedCats: new Set(pinned.map((b) => db.tags.get(b.id)?.catId).filter(Boolean)),
        gender: null,
        palette: makePalette(rules.scheme || 'auto'),
        bald: false,
        shortHair: false,
    };
    const g = pinned.map((b) => db.tags.get(b.id)).find((t) => t?.gender);
    ctx.gender = g ? g.gender : null;
    return ctx;
}

function has(ctx, catId) {
    return ctx.build.some((b) => ctx.db.tags.get(b.id)?.catId === catId);
}

/** Можно ли положить тег. force — для основы пресета: баны и «рандом без» не мешают. */
function canUse(ctx, tag, force = false) {
    if (!tag || ctx.ids.has(tag.id)) return false;
    if (isIncompatible(tag, ctx.gender)) return false;
    if (wouldConflict(tag.id, ctx.ids)) return false;
    if (ctx.rules.sheets && SHEETS.has(tag.id)) return false;
    if (force) return true;
    if (isBanned(tag, ctx.banned)) return false;
    if (withoutBlocks(tag, ctx.without)) return false;
    return true;
}

function add(ctx, tag, extra = {}) {
    const cat = ctx.db.cats.get(tag.catId);
    if (cat.mode === 'one') {
        // В «один» новый тег вытесняет незакреплённый старый
        const same = new Set(cat.tags.map((t) => t.id));
        const out = ctx.build.filter((b) => !b.pinned && same.has(b.id));
        out.forEach((b) => ctx.ids.delete(b.id));
        ctx.build = ctx.build.filter((b) => !out.includes(b));
    }
    ctx.build.push({ id: tag.id, weight: 1, ...extra });
    ctx.ids.add(tag.id);
    if (tag.gender) ctx.gender = tag.gender;
    return true;
}

function addId(ctx, id, force = false) {
    const tag = ctx.db.tags.get(id);
    if (!tag) return false;
    if (!canUse(ctx, tag, force)) return false;
    return add(ctx, tag);
}

/** Один из вариантов (в случайном порядке), который можно положить. */
function addOneOf(ctx, ids, force = false) {
    const list = ids.map((id) => ctx.db.tags.get(id)).filter((t) => t && canUse(ctx, t, force));
    const tag = pickWeighted(list, tagChance);
    return tag ? add(ctx, tag) : false;
}

/** Случайный тег из категории с фильтром и весом. */
function pickIn(ctx, catId, filter = () => true, weight = () => 1) {
    const cat = ctx.db.cats.get(catId);
    if (!cat) return null;
    const list = cat.tags.filter((t) => filter(t) && canUse(ctx, t));
    return pickWeighted(list, (t) => weight(t) * tagChance(t));
}

function addIn(ctx, catId, filter, weight) {
    const tag = pickIn(ctx, catId, filter, weight);
    return tag ? add(ctx, tag) : false;
}

/** Категория занята закреплённым — не трогаем. */
function occupied(ctx, catId) {
    return ctx.pinnedCats.has(catId);
}

// ---------- Шаги сборки ----------

function stepGender(ctx, preset) {
    if (ctx.gender) return;
    const tags = ctx.db.cats.get('gender').tags;
    // Пресет — явный выбор: он сильнее бана. Без пресета берём только пол, чей тег не в бане и не конфликтует
    let want = preset?.gender;
    if (!want) {
        const odds = [['o', 0.05], ['f', 0.475], ['m', 0.475]]
            .filter(([g]) => canUse(ctx, tags.find((t) => t.gender === g)));
        const total = odds.reduce((sum, [, w]) => sum + w, 0);
        if (!total) return;   // все полы в бане — пол в сборку не кладём
        let roll = Math.random() * total;
        want = odds.find(([, w]) => (roll -= w) < 0)?.[0] || odds[odds.length - 1][0];
    }
    const tag = tags.find((t) => t.gender === want);
    if (tag) add(ctx, tag);
}

function addMaybe(ctx, list, force = false) {
    for (const [ids, p] of list || []) if (rand(p)) addOneOf(ctx, ids, force);
}

/** Уши, хвост и прочее одного зверя. */
function addSpeciesParts(ctx, sp, want) {
    const e = species(ctx.db).get(sp);
    if (!e) return;
    const kin = ctx.rules.kinship;
    const one = (kind, cat, p) => {
        if (!p || !rand(p) || occupied(ctx, cat) || has(ctx, cat)) return;
        if (kin && e[kind]) addId(ctx, e[kind]);
        else if (cat === 'ears') addIn(ctx, 'ears', (t) => t.sub === 'a');
        else if (cat === 'tails') addIn(ctx, 'tails', (t) => t.sub === 'b');
        else if (e[kind]) addId(ctx, e[kind]);
    };
    if (want.race && e.race && !occupied(ctx, 'race') && !has(ctx, 'race') && rand(want.race)) addId(ctx, e.race);
    one('ears', 'ears', want.ears);
    one('tail', 'tails', want.tail);
    one('marks', 'marks', want.marks);
    one('wings', 'wings', want.wings);
    one('horns', 'horns', want.horns);
}

/** Выбрать зверя: из того, у кого есть и уши, и хвост (и, если нужно, раса). */
function pickSpecies(ctx, needRace = false) {
    const idx = species(ctx.db);
    const list = [];
    for (const [sp, e] of idx) {
        if (!e.ears || !e.tail) continue;
        if (needRace && !e.race) continue;
        const ears = ctx.db.tags.get(e.ears);
        if (!canUse(ctx, ears)) continue;
        if (e.race && needRace && !canUse(ctx, ctx.db.tags.get(e.race))) continue;
        list.push(sp);
    }
    return pickWeighted(list, (sp) => (COMMON_SPECIES.has(sp) && ctx.mode === 'main' ? 4 : 1)
        * tagChance(ctx.db.tags.get(idx.get(sp).ears)));
}

function addRaceExtras(ctx, raceTag) {
    const extras = RACE_EXTRAS[raceTag.en];
    if (extras) addMaybe(ctx, extras);
    // Зверораса: подтянуть уши и хвост своего зверя
    if (ZOO_RACE_SUBS.has(raceTag.sub)) {
        const sp = raceTag.en.replace(/ girl$/, '');
        addSpeciesParts(ctx, sp, { ears: 0.85, tail: 0.75, marks: ctx.mode === 'wild' ? 0.5 : 0.15 });
    }
}

function stepRaceAndParts(ctx, preset) {
    if (preset) return applyPreset(ctx, preset);
    if (ctx.without.has('human')) return;

    if (ctx.pure) {
        // Чистый случай: раса в половине случаев, любая
        if (!has(ctx, 'race') && !occupied(ctx, 'race') && rand(0.5)) addIn(ctx, 'race');
        return;
    }

    const raceTaken = has(ctx, 'race');
    const r = Math.random();
    const wild = ctx.mode === 'wild';
    const pKemono = wild ? 0.45 : 0.35;
    const pFantasy = wild ? 0.45 : 0.12;

    if (r < pKemono) {
        // Звериные части (в «Основном» — примерно каждый третий)
        const sp = pickSpecies(ctx);
        if (sp) {
            const raceP = raceTaken ? 0 : (wild ? 0.7 : 0.3);
            addSpeciesParts(ctx, sp, { race: raceP, ears: 0.92, tail: 0.7, marks: wild ? 0.35 : 0.08 });
        }
    } else if (r < pKemono + pFantasy && !raceTaken && !occupied(ctx, 'race')) {
        const tag = pickIn(ctx, 'race', (t) => !ZOO_RACE_SUBS.has(t.sub) && t.sub !== 'a',
            (t) => (!wild && COMMON_FANTASY.has(t.en) ? 5 : 1));
        if (tag) {
            add(ctx, tag);
            addRaceExtras(ctx, tag);
        }
    }

    if (wild) {
        // Удивительное: сверху ещё случайные фэнтези-части
        for (const [cat, p] of [['wings', 0.3], ['horns', 0.3], ['halo', 0.18], ['antennae', 0.1], ['beast_traits', 0.25], ['legs', 0.12], ['fantasy_parts', 0.12], ['mushroom_cap', 0.04]]) {
            if (!has(ctx, cat) && !occupied(ctx, cat) && rand(p)) addIn(ctx, cat, (t) => !t.en.startsWith('no '));
        }
    }
}

function applyPreset(ctx, p) {
    // Раса
    if (!has(ctx, 'race') && !occupied(ctx, 'race')) {
        if (Array.isArray(p.race)) addOneOf(ctx, p.race, true);
        else if (p.race?.subs) {
            const list = ctx.db.cats.get('race').tags.filter((t) => p.race.subs.includes(t.sub) && canUse(ctx, t, true));
            const tag = pickWeighted(list, (t) => (COMMON_FANTASY.has(t.en) ? 4 : 1) * tagChance(t));
            if (tag) add(ctx, tag);
        }
    }
    if (p.species) {
        const sp = pickSpecies(ctx, p.race === 'species');
        if (sp) addSpeciesParts(ctx, sp, p.species);
    }
    for (const req of p.must || []) {
        if (Array.isArray(req)) {
            if (!req.some((id) => ctx.ids.has(id))) addOneOf(ctx, req, true);
        } else if (req.cat) {
            if (!has(ctx, req.cat)) addIn(ctx, req.cat, (t) => !req.subs || req.subs.includes(t.sub));
        }
    }
    addMaybe(ctx, p.maybe, true);
    if (p.pick) {
        const [n, ids] = p.pick;
        for (let i = 0; i < n; i++) addOneOf(ctx, ids, true);
    }
}

function stepRequired(ctx) {
    const wild = ctx.mode === 'wild';

    // Телосложение
    if (!occupied(ctx, 'build') && !has(ctx, 'build')) addIn(ctx, 'build');

    // Кожа: натуральная, необычная — редко (в «Удивительном» чаще)
    if (!occupied(ctx, 'skin') && !has(ctx, 'skin')) {
        const pOdd = !ctx.rules.skin ? 0.5 : (wild ? 0.35 : 0.06);
        const odd = rand(pOdd);
        if (!addIn(ctx, 'skin', (t) => t.sub === (odd ? 'b' : 'a'))) addIn(ctx, 'skin');
    }

    // Цвет глаз — из палитры
    if (!occupied(ctx, 'eye_color') && !has(ctx, 'eye_color')) {
        const multi = rand(wild ? 0.25 : 0.08);
        if (multi) {
            const tag = pickIn(ctx, 'eye_color', (t) => t.sub === 'b');
            if (tag) add(ctx, tag, colorsFor(ctx, tag));
        } else {
            addColorTag(ctx, 'eye_color', EYE_NATURAL, ctx.palette.hues[1] || ctx.palette.hues[0], 0.7);
        }
    }

    stepHair(ctx);

    // Грудь — у женского пола почти всегда
    if (ctx.gender === 'f' && !occupied(ctx, 'breasts') && !has(ctx, 'breasts') && rand(0.75)) addIn(ctx, 'breasts');
}

/** Цветной тег (волосы, глаза) с оглядкой на палитру. */
function addColorTag(ctx, catId, natural, hue, pHue) {
    const pool = (t) => (t.swatch || '').slice(1);
    if (ctx.rules.palette && hue && rand(pHue)) {
        if (addIn(ctx, catId, (t) => pool(t) === hue)) return;
    }
    if (ctx.pure) {
        addIn(ctx, catId, (t) => !t.sub || t.sub === 'a');
        return;
    }
    addIn(ctx, catId, (t) => (!t.sub || t.sub === 'a') && pool(t) !== 'rainbow', (t) => natural[pool(t)] || 0.35);
}

function stepHair(ctx) {
    const smart = ctx.rules.hair;
    const lenTag = ctx.build.map((b) => ctx.db.tags.get(b.id)).find((t) => t?.catId === 'hair_length');
    let len = lenTag?.en;
    if (!len && !occupied(ctx, 'hair_length')) {
        const tag = pickIn(ctx, 'hair_length', () => true, (t) => (smart ? (LENGTH_W[t.en] ?? 1) : 1));
        if (tag) {
            add(ctx, tag);
            len = tag.en;
        }
    }
    ctx.bald = smart && TRUE_BALD.has(len);
    ctx.shortHair = SHORTISH.has(len);
    if (ctx.bald) return;

    if (!occupied(ctx, 'hair_color') && !has(ctx, 'hair_color')) {
        addColorTag(ctx, 'hair_color', HAIR_NATURAL, ctx.palette.hues[0], 0.5);
    }

    // Причёска: одна семья — стрижка, хвосты, косы или пучки
    const families = HAIR_FAMILY.filter(([cat]) => !cat || (!occupied(ctx, cat) && !has(ctx, cat)));
    if (families.length < HAIR_FAMILY.length) return;   // что-то из причёски уже закреплено
    let list = families;
    if (smart && ctx.shortHair) list = families.filter(([cat]) => !cat || cat === 'haircut');
    const fam = pickWeighted(list, ([, w]) => w)?.[0];
    if (!fam) return;
    if (fam === 'haircut' && smart) {
        addIn(ctx, 'haircut', (t) => (ctx.shortHair ? (SHORT_CUTS.has(t.en) || ANY_CUTS.has(t.en)) : !SHORT_CUTS.has(t.en)),
            (t) => (t.sub === 'b' ? 0.4 : 1));
    } else {
        addIn(ctx, fam);
    }
}

function stepOptional(ctx) {
    const wild = ctx.mode === 'wild';
    const pool = [];
    const catIds = ctx.pure
        ? [...ctx.db.cats.keys()].filter((c) => !['gender', 'race', 'build', 'skin', 'eye_color', 'hair_color', 'hair_length'].includes(c) && !NEVER.has(c))
        : Object.keys(OPTIONAL);
    for (const c of catIds) {
        if (ctx.simple && SIMPLE_SKIP.has(c)) continue;
        if (occupied(ctx, c) || has(ctx, c)) continue;
        if (ctx.bald && HAIR_EXTRAS.includes(c)) continue;
        if (c === 'breasts' && ctx.gender !== 'f') continue;
        let w = ctx.pure ? 1 : OPTIONAL[c];
        if (wild && WILD_BOOST[c]) w = WILD_BOOST[c];
        if (!ctx.pure && !ctx.rules.skin && c === 'skin_special') w = 1.5;
        pool.push([c, w]);
    }
    let k = Math.round(ctx.detail * (ctx.simple ? 0.9 : 1.2));
    while (k > 0 && pool.length) {
        const pick = pickWeighted(pool, ([, w]) => w);
        pool.splice(pool.indexOf(pick), 1);
        const c = pick[0];
        if (c === 'background') {
            if (stepBackground(ctx)) k--;
            continue;
        }
        const special = ctx.pure ? null : (wild ? WILD_FILTER[c] : MAIN_FILTER[c]);
        const filter = (t) => (ctx.pure || !t.en.startsWith('no ')) && (!special || special(t, ctx));
        if (addIn(ctx, c, filter)) {
            k--;
            const cat = ctx.db.cats.get(c);
            if (cat.mode === 'multi' && DOUBLE_OK.has(c) && rand(0.25)) addIn(ctx, c, filter);
        }
    }
}

/** Фон из слоёв: место + время + погода (или однотонный). */
function stepBackground(ctx) {
    if (ctx.pure) return addIn(ctx, 'background');
    if (rand(0.35)) return addIn(ctx, 'background', (t) => t.sub === 'a');
    let any = false;
    if (rand(0.85)) any = addIn(ctx, 'background', (t) => t.sub === 'c') || any;
    if (!any || rand(0.25)) any = addIn(ctx, 'background', (t) => t.sub === 'b') || any;
    if (rand(0.4)) any = addIn(ctx, 'background', (t) => t.sub === 'd') || any;
    if (rand(0.25)) any = addIn(ctx, 'background', (t) => t.sub === 'e') || any;
    return any;
}

// ---------- Цвета частей и многоцветные теги ----------

function paletteColor(ctx) {
    if (ctx.rules.palette && !rand(0.25)) return pickOne(ctx.palette.hues);
    return rand(0.5) ? pickOne(PART_NEUTRAL) : pickOne(HUES);
}

function colorsFor(ctx, tag) {
    if (!isMulti(tag) || ctx.rules.partColor === 'off') return {};
    const out = [];
    for (let i = 0; i < 2 && out.length < MULTI_MAX; i++) {
        const c = paletteColor(ctx);
        if (!out.includes(c)) out.push(c);
    }
    return out.length ? { colors: out } : {};
}

function stepPartColors(ctx) {
    const p = { generous: 0.45, stingy: 0.15, off: 0 }[ctx.rules.partColor] ?? 0;
    if (!p) return;
    const coloredCats = new Set();
    for (const b of ctx.build) {
        if (b.pinned || b.color) continue;
        const tag = ctx.db.tags.get(b.id);
        if (!tag || !isPart(tag, ctx.db) || coloredCats.has(tag.catId)) continue;
        if (!rand(p)) continue;
        // В одной категории цветная часть всегда одна
        coloredCats.add(tag.catId);
        b.color = { c: paletteColor(ctx) };
        if (rand(0.15) && b.color.c !== 'rainbow') b.color.s = pickOne(SHADE_KEYS);
    }
    for (const b of ctx.build) {
        if (b.pinned || b.colors) continue;
        const tag = ctx.db.tags.get(b.id);
        if (tag && isMulti(tag) && rand(0.7)) Object.assign(b, colorsFor(ctx, tag));
    }
}

// ---------- Лёгкие веса ----------

const NO_RANDOM_WEIGHT = new Set(['gender', 'race', 'view', 'background', 'emoticons']);
const WEIGHTS = [1.1, 1.1, 1.2, 1.2, 1.3, 0.9, 1.4];

function stepWeights(ctx) {
    for (const b of ctx.build) {
        if (b.pinned || b.weight !== 1) continue;
        const tag = ctx.db.tags.get(b.id);
        if (!tag || NO_RANDOM_WEIGHT.has(tag.catId)) continue;
        if (rand(1 / 7)) b.weight = pickOne(WEIGHTS);
    }
}

// ---------- Снаружи ----------

let lastPalette = null;

export function presetById(id) {
    return PRESETS.find((p) => p.id === id) || null;
}

/**
 * «Рандом всего» / «Просто рандом» / пресет.
 * @param {object} db
 * @param {{ simple?: boolean }} opts
 */
export function rollAll(db, opts = {}) {
    const s = getSettings();
    const preset = presetById(s.rnd.preset);
    const ctx = makeCtx(db, { simple: opts.simple, preset });
    pushHistory();
    try {
        stepGender(ctx, preset);
        stepRaceAndParts(ctx, preset);
        stepRequired(ctx);
        stepOptional(ctx);
        stepPartColors(ctx);
        stepWeights(ctx);
    } catch (error) {
        console.error(LOG, 'Рандом споткнулся', error);
    }
    lastPalette = ctx.palette;
    s.build = ctx.build;
    saveSettings();
    return { preset, palette: ctx.palette };
}

/** Включить пресет и сразу собрать по нему. */
export function rollPreset(db, presetId) {
    const s = getSettings();
    s.rnd.preset = presetId;
    saveSettings();
    return rollAll(db, {});
}

export function clearPreset() {
    const s = getSettings();
    s.rnd.preset = null;
    saveSettings();
}

/** «Новая палитра»: перекрасить волосы, глаза и части, остальное не трогать. */
export function rerollPalette(db) {
    const s = getSettings();
    const ctx = makeCtx(db, {});
    ctx.rules.palette = true;
    // В контексте нужна вся сборка, а не только закреплённое
    ctx.build = structuredClone(s.build);
    ctx.ids = new Set(ctx.build.map((b) => b.id));
    pushHistory();

    const swapColorTag = (catId, natural, hue, pHue) => {
        const entry = ctx.build.find((b) => db.tags.get(b.id)?.catId === catId);
        const tag = entry && db.tags.get(entry.id);
        if (!entry || entry.pinned || (tag.sub && tag.sub !== 'a')) return;
        ctx.build = ctx.build.filter((b) => b !== entry);
        ctx.ids.delete(entry.id);
        addColorTag(ctx, catId, natural, hue, pHue);
        if (!has(ctx, catId)) {
            ctx.build.push(entry);
            ctx.ids.add(entry.id);
        }
    };
    swapColorTag('hair_color', HAIR_NATURAL, ctx.palette.hues[0], 0.6);
    swapColorTag('eye_color', EYE_NATURAL, ctx.palette.hues[1] || ctx.palette.hues[0], 0.8);

    for (const b of ctx.build) {
        if (b.pinned) continue;
        const tag = db.tags.get(b.id);
        if (!tag) continue;
        if (b.color?.c && isPart(tag, db)) b.color = { ...b.color, c: paletteColor(ctx) };
        if (b.colors && isMulti(tag)) Object.assign(b, colorsFor(ctx, tag));
    }
    lastPalette = ctx.palette;
    s.build = ctx.build;
    saveSettings();
    return ctx.palette;
}

export function getLastPalette() {
    return lastPalette;
}

/** Проверить, что все id в пресетах и расовых довесках есть в базе (пишет в консоль). */
export function checkPresetIds(db) {
    const missing = new Set();
    const check = (id) => { if (typeof id === 'string' && id.includes('/') && !db.tags.has(id)) missing.add(id); };
    for (const p of PRESETS) {
        (Array.isArray(p.race) ? p.race : []).forEach(check);
        (p.must || []).forEach((r) => Array.isArray(r) && r.forEach(check));
        (p.maybe || []).forEach(([ids]) => ids.forEach(check));
        (p.pick?.[1] || []).forEach(check);
    }
    for (const list of Object.values(RACE_EXTRAS)) list.forEach(([ids]) => ids.forEach(check));
    for (const en of Object.keys(RACE_EXTRAS)) if (!db.tags.has(`race/${en}`)) missing.add(`race/${en}`);
    if (missing.size) console.warn(LOG, 'В пресетах есть теги, которых нет в базе:', [...missing].join(', '));
    return [...missing];
}
