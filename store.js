// Chimera — настройки и мелкие помощники.
// От чата ничего не зависит: всё живёт в extension_settings, смена чата ничего не сбрасывает.

export const MODULE = 'chimera';     // ключ в extension_settings
export const TOAST_TITLE = 'Chimera';

export const DEFAULT_SETTINGS = Object.freeze({
    version: 1,

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

    // Этап 5: генерация и стили
    provider: 'nai',         // 'nai' | 'naistera'
    naiKey: '',
    naisteraKey: '',
    size: 'portrait',        // 'portrait' | 'square' | 'landscape'
    styles: [],
    activeStyleId: null,
    previews: [],

    // Этап 6: сохранённые персонажи
    characters: [],
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
    for (const key of ['toggles', 'custom', 'rnd']) {
        for (const [k, v] of Object.entries(DEFAULT_SETTINGS[key])) {
            if (s[key][k] === undefined) s[key][k] = structuredClone(v);
        }
    }
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS.rnd.rules)) {
        if (s.rnd.rules[k] === undefined) s.rnd.rules[k] = v;
    }
    delete s.randomMode;   // старый задел этапа 1, заменён на rnd.mode
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
