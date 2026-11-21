// Chimera — рандом.
// Этап 4а: история для отката, кубик одной категории, сброс, снятие закрепов.
// Этап 4б добавит сюда «Рандом всего», режимы, пресеты и умные правила.

import { getSettings, saveSettings } from './store.js';
import { isBanned, bannedSet } from './bans.js';
import { wouldConflict } from './conflicts.js';
import { currentGender, isIncompatible } from './builder.js';

const HISTORY_MAX = 20;
const RARE_CHANCE = 0.25;    // редкий тег (<100) берём примерно в 4 раза реже

// ---------- История для ⟲ (только в памяти, на перезагрузку не переживает) ----------

const history = [];
let onHistory = () => {};

export function setHistoryListener(fn) {
    onHistory = fn || (() => {});
}

function snapshot() {
    const s = getSettings();
    return { build: structuredClone(s.build), autoOff: [...s.autoOff] };
}

export function pushHistory() {
    history.push(snapshot());
    if (history.length > HISTORY_MAX) history.shift();
    onHistory();
}

export function canUndo() {
    return history.length > 0;
}

export function undo() {
    const snap = history.pop();
    if (!snap) return false;
    const s = getSettings();
    s.build = snap.build;
    s.autoOff = snap.autoOff;
    saveSettings();
    onHistory();
    return true;
}

// ---------- Выбор с весами ----------

/** Случайный элемент; weightOf(x) — относительный шанс. */
export function pickWeighted(list, weightOf = () => 1) {
    let total = 0;
    const ws = list.map((x) => {
        const w = Math.max(0, weightOf(x));
        total += w;
        return w;
    });
    if (!total) return null;
    let r = Math.random() * total;
    for (let i = 0; i < list.length; i++) {
        r -= ws[i];
        if (r <= 0) return list[i];
    }
    return list[list.length - 1];
}

export function tagChance(tag) {
    return tag.rare ? RARE_CHANCE : 1;
}

/** Теги категории, которые рандом вообще готов предложить при текущей сборке. */
export function candidatesIn(db, cat, buildIds, gender) {
    const banned = bannedSet();
    return cat.tags.filter((t) => !buildIds.has(t.id)
        && !isBanned(t, banned)
        && !isIncompatible(t, gender)
        && !wouldConflict(t.id, buildIds));
}

// ---------- Кубик категории ----------

/**
 * Перекинуть одну категорию: незакреплённое в ней уходит, приходит один случайный тег.
 * @returns {{ ok: boolean, reason?: string, id?: string }}
 */
export function rollCategory(db, catId) {
    const cat = db.cats.get(catId);
    if (!cat) return { ok: false, reason: 'нет категории' };
    const s = getSettings();
    if (s.banned.includes(`cat:${catId}`)) return { ok: false, reason: 'Категория в бане — рандом её не трогает.' };

    const inCat = new Set(cat.tags.map((t) => t.id));
    const pinnedHere = s.build.filter((b) => inCat.has(b.id) && b.pinned);
    if (cat.mode === 'one' && pinnedHere.length) {
        return { ok: false, reason: 'Здесь закреплённый тег — открепи его, чтобы перекинуть.' };
    }

    const rest = s.build.filter((b) => !inCat.has(b.id) || b.pinned);
    const restIds = new Set(rest.map((b) => b.id));
    const gender = currentGender(db, rest);
    // Прошлый выбор не повторяем, если есть из чего выбрать
    const prev = new Set(s.build.filter((b) => inCat.has(b.id) && !b.pinned).map((b) => b.id));
    let pool = candidatesIn(db, cat, restIds, gender);
    const fresh = pool.filter((t) => !prev.has(t.id));
    if (fresh.length) pool = fresh;
    const tag = pickWeighted(pool, tagChance);
    if (!tag) return { ok: false, reason: 'Нечего предложить: всё в бане, занято или спорит с выбранным.' };

    pushHistory();
    s.build = [...rest, { id: tag.id, weight: 1 }];
    saveSettings();
    return { ok: true, id: tag.id };
}

/** «Сброс»: убрать всё незакреплённое. */
export function resetBuild() {
    const s = getSettings();
    if (!s.build.some((b) => !b.pinned)) return false;
    pushHistory();
    s.build = s.build.filter((b) => b.pinned);
    saveSettings();
    return true;
}

/** «Снять закрепы». */
export function unpinAll() {
    const s = getSettings();
    if (!s.build.some((b) => b.pinned)) return false;
    pushHistory();
    s.build.forEach((b) => { delete b.pinned; });
    saveSettings();
    return true;
}

/** Закрепить или открепить всё выбранное в категории. Возвращает новое состояние. */
export function togglePinCategory(db, catId) {
    const cat = db.cats.get(catId);
    const s = getSettings();
    const inCat = new Set(cat.tags.map((t) => t.id));
    const here = s.build.filter((b) => inCat.has(b.id));
    if (!here.length) return null;
    const pin = !here.every((b) => b.pinned);
    here.forEach((b) => {
        if (pin) b.pinned = true;
        else delete b.pinned;
    });
    saveSettings();
    return pin;
}
