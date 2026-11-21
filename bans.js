// Chimera — бан-лист.
// В settings.banned лежат ключи трёх видов:
//   «ears/cat ears»   — тег (id тега всегда содержит «/»)
//   «sub:ears:c»      — подгруппа категории целиком
//   «cat:ears»        — категория целиком
// Бан — про то, что предлагает рандом. Руками выбрать забаненное можно всегда.

import { getSettings, saveSettings } from './store.js';

export const subKey = (catId, sub) => `sub:${catId}:${sub}`;
export const catKey = (catId) => `cat:${catId}`;

export function bannedSet() {
    return new Set(getSettings().banned);
}

/** Тег забанен сам по себе (не через подгруппу или категорию). */
export function isDirectBan(tag, set = bannedSet()) {
    return set.has(tag.id);
}

/** Тег забанен любым способом: сам, подгруппой или категорией. */
export function isBanned(tag, set = bannedSet()) {
    return set.has(tag.id)
        || set.has(catKey(tag.catId))
        || Boolean(tag.sub && set.has(subKey(tag.catId, tag.sub)));
}

export function isKeyBanned(key) {
    return getSettings().banned.includes(key);
}

/** Добавить или убрать ключ. Возвращает true, если теперь в бане. */
export function toggleBanKey(key) {
    const s = getSettings();
    const i = s.banned.indexOf(key);
    if (i >= 0) s.banned.splice(i, 1);
    else s.banned.push(key);
    saveSettings();
    return i < 0;
}

export function addBan(key) {
    const s = getSettings();
    if (!s.banned.includes(key)) s.banned.push(key);
    saveSettings();
}

export function removeBan(key) {
    const s = getSettings();
    s.banned = s.banned.filter((k) => k !== key);
    saveSettings();
}

/** Человеческое описание ключа для бан-листа. */
export function describeBan(db, key) {
    if (key.startsWith('cat:')) {
        const cat = db.cats.get(key.slice(4));
        return cat ? { kind: 'cat', title: cat.title, note: 'категория целиком' } : null;
    }
    if (key.startsWith('sub:')) {
        const [, catId, sub] = key.split(':');
        const cat = db.cats.get(catId);
        const s = cat?.subs.find((x) => x.key === sub);
        return s ? { kind: 'sub', title: s.title, note: `подгруппа · ${cat.title}` } : null;
    }
    const tag = db.tags.get(key);
    if (!tag) return null;
    return { kind: 'tag', title: tag.ru, note: `${tag.en} · ${db.cats.get(tag.catId).title}` };
}

/** Ключ ещё существует в базе (для чистки после правки tags.txt). */
export function banKeyValid(db, key) {
    return Boolean(describeBan(db, key));
}
