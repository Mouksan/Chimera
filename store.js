// Chimera — настройки и мелкие помощники.
// От чата ничего не зависит: всё живёт в extension_settings, смена чата ничего не сбрасывает.

export const MODULE = 'chimera';     // ключ в extension_settings
export const TOAST_TITLE = 'Chimera';

export const DEFAULT_SETTINGS = Object.freeze({
    version: 2,

    // Кнопка запуска: 'menu' | 'bar' | 'floating' | 'both' (пункт в меню расширений есть всегда)
    launcherMode: 'bar',

    // Какая колонка открыта на телефоне: 'catalog' | 'panel'
    mobileTab: 'catalog',

    // Каталог: какие категории раскрыты (поверх «open» из базы) и какие разделы свёрнуты
    catOpen: {},
    sectionClosed: {},

    // ---- Заделы под следующие этапы (структура сразу, чтобы потом не переливать) ----

    // Текущая сборка — [{ id, weight, pinned, color, colors }]:
    //   id — тег из базы; weight — 0.5…2; pinned — закреп (рандом не трогает);
    //   color — { c, s } цвет и оттенок части (уши, рога…) или оттенок цветного тега;
    //   colors — [c, c, c] цвета многоцветного тега (гетерохромия, двухцветные волосы)
    build: [],
    // Снятые руками общие теги «само» (animal ears, horns…), пока их повод в сборке
    autoOff: [],
    // Тумблеры над промтом
    toggles: {
        clothing: true,      // одежда: + clothed, fashion
        weights: true,       // писать веса
        colorOneTag: true,   // цвет одним тегом: pink cat ears
        naiWeights: true,    // веса как в NovelAI: 1.2::tag::
        otherGender: true,   // показывать теги чужого пола
        genericTags: true,   // общие теги: animal ears, horns…
    },
    negative: '',
    // Свои готовые теги текущей сборки (как вставлены) — встают в конец персонажа
    ownTags: '',
    custom: { text: '', place: 'start' },   // 'start' | 'end' | 'split'

    // Этап 4: рандом
    banned: [],              // ключи бана: id тега, «sub:кат:подгр», «cat:кат» (см. bans.js)
    rnd: {
        mode: 'main',        // 'main' — умный | 'random' — чистый случай | 'wild' — удивительное
        without: [],         // «рандом без…»: ears, wings, tail, horns, antennae, beastLegs, beastTraits, beastRaces, fur, human
        detail: 6,           // детализация 1–10: сколько необязательных категорий заполнять
        preset: null,        // активный пресет-архетип (id) или null
        rules: {
            kinship: true,   // родство видов: уши, хвост, раса и окрас от одного зверя
            hair: true,      // стрижка по длине и осознанная причёска
            skin: true,      // осознанная кожа: необычная — редко
            sheets: true,    // страховка от листов: без reference sheet и т.п.
            partColor: 'generous', // цвет частей: 'generous' | 'stingy' | 'off'
            palette: true,   // подбирать цвета волос, глаз и частей друг к другу
            scheme: 'auto',  // 'auto' | 'mono' | 'adjacent' | 'split' | 'contrast' | 'triad'
        },
    },

    // Этап 5: генерация и стили (порт из Комы)
    provider: 'novelai',     // 'novelai' — подписка напрямую | 'naistera'
    naiKey: '',              // Persistent API Token (pst-…)
    naiModel: 'nai-diffusion-5-full',
    naisteraKey: '',
    naisteraEndpoint: '',    // пусто — https://naistera.org
    aspectMap: { portrait: '2:3', square: '1:1', landscape: '16:9' },   // рамки для наистеры
    naiFine: { sampler: 'k_euler_ancestral', schedule: 'karras', steps: 28, scale: 5, rescale: 0 },
    size: 'portrait',        // 'portrait' | 'square' | 'landscape'
    styles: [],              // { id, name, tags, negative, fineOn, fine }
    activeStyleId: '',       // '' — без стиля
    previews: [],            // { id, path, prompt, negative, styleName, size, provider, model, seed, charIds, createdAt }
    currentPreviewId: null,  // какая картинка показана в панели

    // Этап 6: сохранённые персонажи — { id, name, build, autoOff, ownTags, gender, coverId, createdAt, updatedAt }
    //   gender: 'm' | 'f' | 'x' (футанари) | '' — не указан
    characters: [],
    loadedCharId: null,      // какой персонаж сейчас загружен (null — никакой)

    // «Сцена 18+»: тумблер в настройках (по умолчанию выключено) и режим окна
    sceneEnabled: false,
    mode: 'character',       // 'character' | 'scene' (сцена — только при включённом тумблере)
    // Последний выбор в режиме «Сцена»: категория поз, поза, место, ракурс, детали, строка поиска
    // slots: кто в сцене (src: '' | 'char' | 'text'); locks: что рандом не трогает
    scene: {
        cat: 'all', pose: '', place: '', shot: '', details: [], q: '',
        slots: {
            A: { src: '', charId: '', text: '', gender: '' },
            B: { src: '', charId: '', text: '', gender: '' },
            C: { src: '', charId: '', text: '', gender: '' },
        },
        locks: { pose: false, place: false, shot: false, details: false },
    },
});

export function ctx() {
    return SillyTavern.getContext();
}

export function getSettings() {
    const c = ctx();
    if (!c.extensionSettings[MODULE] || typeof c.extensionSettings[MODULE] !== 'object') {
        c.extensionSettings[MODULE] = structuredClone(DEFAULT_SETTINGS);
    }
    const s = c.extensionSettings[MODULE];
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (s[key] === undefined) s[key] = structuredClone(value);
    }
    // Вложенные объекты тоже дотягиваем до текущей версии
    for (const key of ['toggles', 'custom', 'rnd', 'scene']) {
        for (const [k, v] of Object.entries(DEFAULT_SETTINGS[key])) {
            if (s[key][k] === undefined) s[key][k] = structuredClone(v);
        }
    }
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS.rnd.rules)) {
        if (s.rnd.rules[k] === undefined) s.rnd.rules[k] = v;
    }
    delete s.randomMode;   // старый задел этапа 1, заменён на rnd.mode
    if (s.provider === 'nai') s.provider = 'novelai';   // заглушка этапа 1
    if (s.activeStyleId === null) s.activeStyleId = '';
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS.aspectMap)) {
        if (!s.aspectMap[k]) s.aspectMap[k] = v;
    }
    // «Персонажи 2.0»: у превью вместо одного charId — список charIds, у персонажа свои теги и пол
    if ((Number(s.version) || 1) < 2) {
        for (const p of s.previews) {
            if (!Array.isArray(p.charIds)) p.charIds = p.charId ? [p.charId] : [];
            delete p.charId;
        }
        for (const c of s.characters) {
            if (typeof c.ownTags !== 'string') c.ownTags = '';
            if (!['m', 'f', 'x'].includes(c.gender)) c.gender = '';
            if (!Array.isArray(c.build)) c.build = [];
        }
        s.version = 2;
    }
    if (typeof s.ownTags !== 'string') s.ownTags = '';
    // Режим «Сцена» живёт только при включённом тумблере
    if (!s.sceneEnabled || s.mode !== 'scene') s.mode = 'character';
    if (!Array.isArray(s.scene.details)) s.scene.details = [];
    return s;
}

export function saveSettings() {
    ctx().saveSettingsDebounced();
}

export function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function makeId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
