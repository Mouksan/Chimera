// Chimera — база тегов: загрузка и разбор data/tags.txt
// Формат описан в шапке самого файла. Разбор терпимый: кривая строка пишется в консоль и пропускается.

const LOG = '[Chimera]';

/** Палитра для кружков-цветов: имя → цвет. Можно писать и #rrggbb. */
export const PALETTE = Object.freeze({
    aqua: '#4fd1c5',
    black: '#26262b',
    blue: '#4a7cf0',
    brown: '#8b5a2b',
    green: '#3cb15a',
    grey: '#9a9a9a',
    orange: '#f0902a',
    purple: '#9b5bd8',
    pink: '#ee8fb8',
    red: '#e04848',
    white: '#f4f4f4',
    yellow: '#f2d23c',
    blonde: '#ecd27f',
    silver: '#c0c4cc',
    gold: '#e0b23c',
});

const RAINBOW = 'conic-gradient(#e04848, #f0902a, #f2d23c, #3cb15a, #4a7cf0, #9b5bd8, #e04848)';
const CHECKER = 'repeating-conic-gradient(#cfcfcf 0 25%, #ffffff 0 50%) 0 0 / 8px 8px';

function colorOf(token) {
    const t = token.trim().toLowerCase();
    if (PALETTE[t]) return PALETTE[t];
    if (/^#?[0-9a-f]{6}$/.test(t)) return t.startsWith('#') ? t : `#${t}`;
    return null;
}

/** «#pink», «#a/b», «#a>b», «#rainbow», «#checker» → CSS background для кружка. */
export function swatchCss(spec) {
    if (!spec) return null;
    const s = spec.replace(/^#/, '');
    if (s === 'rainbow') return RAINBOW;
    if (s === 'checker') return CHECKER;
    if (s.includes('/')) {
        const [a, b] = s.split('/').map(colorOf);
        if (a && b) return `linear-gradient(90deg, ${a} 50%, ${b} 50%)`;
    }
    if (s.includes('>')) {
        const [a, b] = s.split('>').map(colorOf);
        if (a && b) return `linear-gradient(135deg, ${a}, ${b})`;
    }
    return colorOf(s);
}

/**
 * Разобрать текст базы.
 * @returns {{ sections: object[], cats: Map<string, object>, tags: Map<string, object>, warnings: string[] }}
 */
export function parseTags(text) {
    const sections = [];
    const cats = new Map();
    const tags = new Map();
    const warnings = [];

    let section = null;
    let cat = null;

    const lines = String(text).split(/\r?\n/);
    lines.forEach((raw, i) => {
        const line = raw.trim();
        const where = `строка ${i + 1}`;
        if (!line || line.startsWith('#')) return;

        if (line.startsWith('==')) {
            const [id, title, en] = line.slice(2).split('|').map((p) => p.trim());
            if (!id || !title) {
                warnings.push(`${where}: раздел без id или названия`);
                return;
            }
            section = { id, title, en: en || '', cats: [] };
            sections.push(section);
            cat = null;
            return;
        }

        if (line.startsWith('--')) {
            const [id, title, modeRaw = '', ...flags] = line.slice(2).split('|').map((p) => p.trim());
            if (!section) {
                warnings.push(`${where}: категория вне раздела`);
                return;
            }
            if (!id || !title || cats.has(id)) {
                warnings.push(`${where}: категория без id/названия или id повторяется (${id})`);
                return;
            }
            const mode = /^(один|one|single)$/i.test(modeRaw) ? 'one' : 'multi';
            cat = {
                id,
                title,
                mode,
                open: flags.some((f) => /^open$/i.test(f)),
                sectionId: section.id,
                subs: [],
                tags: [],
            };
            section.cats.push(cat);
            cats.set(id, cat);
            return;
        }

        if (line.startsWith('~')) {
            if (!cat) return;
            for (const part of line.slice(1).split(';')) {
                const m = part.trim().match(/^([a-z0-9_]+)\s*=\s*(.+)$/i);
                if (m) cat.subs.push({ key: m[1], title: m[2].trim() });
            }
            return;
        }

        // Строка тега: «ru | en | метки». Делим именно по « | », чтобы «:|» не ломал разбор.
        if (!cat) {
            warnings.push(`${where}: тег вне категории`);
            return;
        }
        const parts = raw.split(' | ').map((p) => p.trim());
        if (parts.length < 2 || !parts[0] || !parts[1]) {
            warnings.push(`${where}: не вижу «по-русски | english»`);
            return;
        }
        const [ru, en, flagStr = ''] = parts;
        const tag = {
            id: `${cat.id}/${en}`,
            ru,
            en,
            catId: cat.id,
            sub: null,
            rare: false,
            swatch: null,
            sex: null,      // 'f' | 'm' — только для этого пола
            gender: null,   // 'f' | 'm' | 'o' — сам выбор пола
        };
        for (const f of flagStr.split(/\s+/).filter(Boolean)) {
            if (f.startsWith('@')) tag.sub = f.slice(1);
            else if (f === '*') tag.rare = true;
            else if (f.startsWith('#')) tag.swatch = f;
            else if (f === 'F') tag.sex = 'f';
            else if (f === 'M') tag.sex = 'm';
            else if (/^=[fmo]$/.test(f)) tag.gender = f[1];
            else warnings.push(`${where}: непонятная метка «${f}»`);
        }
        if (tag.sub && !cat.subs.some((s) => s.key === tag.sub)) {
            warnings.push(`${where}: подгруппы @${tag.sub} нет в категории ${cat.id}`);
            tag.sub = null;
        }
        if (tags.has(tag.id)) {
            warnings.push(`${where}: тег «${en}» уже есть в категории ${cat.id}`);
            return;
        }
        tag.search = `${ru} ${en}`.toLowerCase().replace(/ё/g, 'е');
        cat.tags.push(tag);
        tags.set(tag.id, tag);
    });

    return { sections, cats, tags, warnings };
}

let cache = null;

/** Загрузить базу один раз за сессию. */
export async function loadTags() {
    if (cache) return cache;
    const url = new URL('./data/tags.txt', import.meta.url);
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`tags.txt: HTTP ${res.status}`);
    cache = parseTags(await res.text());
    if (cache.warnings.length) {
        console.warn(LOG, `В базе тегов есть замечания (${cache.warnings.length}):\n` + cache.warnings.join('\n'));
    }
    return cache;
}

/** Нормализовать строку поиска так же, как теги. */
export function normalizeQuery(q) {
    return String(q || '').trim().toLowerCase().replace(/ё/g, 'е');
}
