// Chimera — конфликты тегов: загрузка data/conflicts.txt и поиск спорящих пар в сборке.
// Конфликт ничего не снимает: только подсветка и подсказка. Рандом конфликтов не собирает.

const LOG = '[Chimera]';

let rules = [];   // [{ left: Set<tagId>, right: Set<tagId> }]

/** Разобрать сторону правила в набор id тегов. */
function resolveSide(db, text, where, warnings) {
    const include = new Set();
    const exclude = new Set();
    for (const raw of text.split(',')) {
        let tok = raw.trim();
        if (!tok) continue;
        const neg = tok.startsWith('-');
        if (neg) tok = tok.slice(1).trim();
        const target = neg ? exclude : include;

        if (tok.includes('/')) {
            if (db.tags.has(tok)) target.add(tok);
            else warnings.push(`${where}: нет тега «${tok}»`);
        } else if (tok.includes('@')) {
            const [catId, sub] = tok.split('@');
            const cat = db.cats.get(catId);
            if (!cat || !cat.subs.some((s) => s.key === sub)) {
                warnings.push(`${where}: нет подгруппы «${tok}»`);
                continue;
            }
            cat.tags.filter((t) => t.sub === sub).forEach((t) => target.add(t.id));
        } else {
            const cat = db.cats.get(tok);
            if (!cat) {
                warnings.push(`${where}: нет категории «${tok}»`);
                continue;
            }
            cat.tags.forEach((t) => target.add(t.id));
        }
    }
    exclude.forEach((id) => include.delete(id));
    return include;
}

export function parseConflicts(db, text) {
    const out = [];
    const warnings = [];
    String(text).split(/\r?\n/).forEach((raw, i) => {
        const line = raw.trim();
        if (!line || line.startsWith('#')) return;
        const where = `conflicts.txt, строка ${i + 1}`;
        const parts = line.split('<>');
        if (parts.length !== 2) {
            warnings.push(`${where}: нужно ровно одно «<>»`);
            return;
        }
        const left = resolveSide(db, parts[0], where, warnings);
        const right = resolveSide(db, parts[1], where, warnings);
        if (left.size && right.size) out.push({ left, right });
    });
    return { rules: out, warnings };
}

/** Загрузить правила. Без файла — просто без конфликтов. */
export async function loadConflicts(db) {
    try {
        const res = await fetch(new URL('./data/conflicts.txt', import.meta.url), { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = parseConflicts(db, await res.text());
        rules = parsed.rules;
        if (parsed.warnings.length) {
            console.warn(LOG, `В conflicts.txt есть замечания (${parsed.warnings.length}):\n` + parsed.warnings.join('\n'));
        }
    } catch (error) {
        rules = [];
        console.warn(LOG, 'conflicts.txt не загрузился — работаю без конфликтов', error);
    }
}

export function setRules(list) {
    rules = list;
}

/**
 * Найти спорящие пары среди id.
 * @param {Iterable<string>} ids
 * @returns {Array<[string, string]>} пары без повторов
 */
export function findConflicts(ids) {
    const list = [...ids];
    const pairs = [];
    const seen = new Set();
    for (const rule of rules) {
        const left = list.filter((id) => rule.left.has(id));
        if (!left.length) continue;
        const right = list.filter((id) => rule.right.has(id));
        for (const a of left) {
            for (const b of right) {
                if (a === b) continue;
                const key = a < b ? `${a}|${b}` : `${b}|${a}`;
                if (seen.has(key)) continue;
                seen.add(key);
                pairs.push([a, b]);
            }
        }
    }
    return pairs;
}

/** Поспорит ли тег с кем-то из уже выбранных (для рандома). */
export function wouldConflict(id, ids) {
    for (const rule of rules) {
        const inL = rule.left.has(id);
        const inR = rule.right.has(id);
        if (!inL && !inR) continue;
        for (const other of ids) {
            if (other === id) continue;
            if ((inL && rule.right.has(other)) || (inR && rule.left.has(other))) return true;
        }
    }
    return false;
}
