// Chimera — защита «только взрослые» для режима «Сцена».
// Вшита и не отключается ни настройками, ни стилем: в промт всегда идёт `adult`,
// теги про возраст вычищаются из плюса, а в негатив всегда добавляются анти-детские теги
// (даже если у стиля свой негатив, который обычно заменяет общий).

export const ADULT_TAG = 'adult';

// Всегда в негативе сцены
export const ANTI_CHILD_NEG = Object.freeze([
    'child', 'children', 'loli', 'shota', 'toddler', 'infant', 'underage', 'teen', 'kid', 'young',
]);

// Теги, которым в плюсе делать нечего (ловим и с весом: 1.2::child::)
const UNSAFE_RE = /\b(child|children|kid|kids|loli|lolicon|shota|shotacon|toddler|infant|underage|preteen|teen|teenage|teenager|minor|juvenile|schoolboy|schoolgirl|young boy|young girl)\b/i;

function bare(tag) {
    return String(tag || '').trim().replace(/^[\d.]+::/, '').replace(/::$/, '').toLowerCase();
}

/** Убрать из списка тегов всё про возраст. → { tags, removed } */
export function stripUnsafeTags(tags) {
    const kept = [];
    let removed = 0;
    for (const t of tags) {
        if (UNSAFE_RE.test(bare(t))) removed++;
        else kept.push(t);
    }
    return { tags: kept, removed };
}

/** Тот же фильтр для готового промта строкой (после добавления тегов стиля). */
export function stripUnsafeText(text) {
    const parts = String(text || '').split(',').map((x) => x.trim()).filter(Boolean);
    return stripUnsafeTags(parts).tags.join(', ');
}

/** Негатив + анти-детские теги, которых в нём ещё нет. */
export function withSafeNegative(negative) {
    const list = String(negative || '').split(',').map((x) => x.trim()).filter(Boolean);
    const have = new Set(list.map((x) => bare(x)));
    for (const t of ANTI_CHILD_NEG) {
        if (!have.has(t)) list.push(t);
    }
    return list.join(', ');
}
