// Chimera — карточка «Рандом и пресеты»: режимы, «Рандом без…», детализация,
// настройки рандома, большие кнопки, кнопки сброса/отката и пресеты-архетипы.
// Кнопки Сброс / ⟲ / Снять закрепы / Бан-лист обрабатывает index.js (классы chm-act-*).

import { getSettings, saveSettings, escapeHtml } from './store.js';
import { MODES, WITHOUT, SCHEMES, PRESETS, presetById, rollAll, rollPreset, clearPreset, rerollPalette } from './randgen.js';
import { toast } from './notice.js';
import { PART_COLORS } from './builder.js';

const RU_COLOR = Object.fromEntries(PART_COLORS.map((c) => [c.key, c.ru]));

let db = null;
let card = null;
let onChange = () => {};

const PART_COLOR = [
    { id: 'generous', label: 'щедро' },
    { id: 'stingy', label: 'скупо' },
    { id: 'off', label: 'выкл' },
];

const RULES = [
    { key: 'kinship', label: 'Родство видов', hint: 'Уши, хвост, раса и окрас — от одного зверя: лисьи уши с лисьим хвостом, а не с коровьим' },
    { key: 'hair', label: 'Причёска по длине', hint: 'Короткие волосы не получат косы и пучки, длинные — пикси и «ёжик»; у лысых нет причёски и чёлки' },
    { key: 'skin', label: 'Осознанная кожа', hint: 'Обычно натуральные оттенки; синяя, зелёная и прочая необычная кожа — редко (в «Удивительном» чаще)' },
    { key: 'sheets', label: 'Страховка от листов', hint: 'Не брать референс-лист, лист персонажа, таблицу эмоций и несколько видов — превью от них рассыпается на кадры' },
];

function sw(key, checked, label, hint) {
    return `
        <label class="chm-switch" title="${escapeHtml(hint)}">
            <input type="checkbox" data-rule="${key}" ${checked ? 'checked' : ''}>
            <span class="chm-switch-track"></span>
            <span class="chm-switch-label">${escapeHtml(label)}</span>
        </label>`;
}

function html() {
    const r = getSettings().rnd;
    const preset = presetById(r.preset);
    const mode = MODES.find((m) => m.id === r.mode) || MODES[0];
    return `
        <div class="chm-card-head">
            <i class="fa-solid fa-dice"></i> Рандом и пресеты
            <span class="chm-preset-badge"${preset ? '' : ' hidden'}>активен: ${escapeHtml(preset?.label || '')}</span>
        </div>

        <div class="chm-modes">
            ${MODES.map((m) => `<button type="button" class="chm-mode${m.id === r.mode ? ' chm-active' : ''}" data-mode="${m.id}">${escapeHtml(m.label)}</button>`).join('')}
        </div>
        <div class="chm-mode-hint">${escapeHtml(mode.hint)}</div>

        <div class="chm-chiprow">
            <span class="chm-chiprow-label">// рандом без</span>
            ${WITHOUT.map((w) => `<button type="button" class="chm-chip${r.without.includes(w.id) ? ' chm-active' : ''}${w.id === 'human' ? ' chm-chip-sep' : ''}" data-without="${w.id}"${w.title ? ` title="${escapeHtml(w.title)}"` : ''}>${escapeHtml(w.label)}</button>`).join('')}
        </div>

        <div class="chm-detail">
            <span class="chm-chiprow-label">детализация</span>
            <input type="range" class="chm-detail-range" min="1" max="10" step="1" value="${r.detail}" aria-label="Детализация" title="Сколько необязательных категорий заполнять: 1 — почти голая основа, 10 — по полной">
            <span class="chm-detail-val">${r.detail}</span>
        </div>

        <details class="chm-rules">
            <summary class="chm-mono-label">настройки рандома</summary>
            <div class="chm-rules-note">${r.mode === 'random' ? 'Сейчас режим «Рандом» — правила не действуют, это чистый случай. В «Основном» и «Удивительном» работают.' : 'Работают в «Основном» и «Удивительном». В «Рандоме» выключены.'}</div>
            <div class="chm-switches chm-rules-grid">
                ${RULES.map((x) => sw(x.key, r.rules[x.key], x.label, x.hint)).join('')}
            </div>
            <div class="chm-rule-line">
                <span class="chm-rule-name" title="Как часто рандом сам красит уши, рога, крылья, хвосты и нимб">Цвет частей</span>
                <div class="chm-seg">
                    ${PART_COLOR.map((p) => `<button type="button" class="chm-seg-btn${r.rules.partColor === p.id ? ' chm-active' : ''}" data-partcolor="${p.id}">${p.label}</button>`).join('')}
                </div>
            </div>
            <div class="chm-rule-line">
                ${sw('palette', r.rules.palette, 'Палитра', 'Цвета волос, глаз и частей подбираются друг к другу по схеме')}
                <div class="chm-schemes"${r.rules.palette ? '' : ' hidden'}>
                    ${SCHEMES.map((x) => `<button type="button" class="chm-chip${r.rules.scheme === x.id ? ' chm-active' : ''}" data-scheme="${x.id}">${x.label}</button>`).join('')}
                </div>
            </div>
            <button type="button" class="chm-act chm-new-palette" title="Перекрасить волосы, глаза и цветные части по новой палитре — остальное не трогать"><i class="fa-solid fa-palette"></i> Новая палитра</button>
        </details>

        <div class="chm-rnd-main">
            <button type="button" class="chm-big chm-roll-all" title="${preset ? `Случайный персонаж по пресету «${escapeHtml(preset.label)}»` : 'Полный персонаж: внешность, поза, эмоция, взгляд, ракурс и фон'}"><i class="fa-solid fa-dice"></i> Рандом всего</button>
            <button type="button" class="chm-big chm-big-soft chm-roll-simple" title="То же, но без поз, эмоций, взгляда, ракурса и фона"><i class="fa-solid fa-dice-two"></i> Просто рандом</button>
        </div>

        <div class="chm-rnd-actions">
            <button type="button" class="chm-act chm-act-reset" title="Убрать всё незакреплённое"><i class="fa-solid fa-rotate-left"></i> Сброс</button>
            <button type="button" class="chm-act chm-act-undo" title="Откатить последний рандом или сброс" disabled><i class="fa-solid fa-clock-rotate-left"></i></button>
            <button type="button" class="chm-act chm-act-unpin" title="Открепить все теги"><i class="fa-solid fa-thumbtack"></i> Снять закрепы</button>
            <button type="button" class="chm-act chm-act-banlist" title="Всё, что не предлагает рандом"><i class="fa-solid fa-ban"></i> Бан-лист <span class="chm-banlist-count"></span></button>
        </div>

        <div class="chm-presets">
            ${PRESETS.map((p) => `<button type="button" class="chm-preset${p.id === r.preset ? ' chm-active' : ''}" data-preset="${p.id}" title="Случайный полный персонаж: ${escapeHtml(p.label)}"><i class="fa-solid ${p.icon}"></i> ${escapeHtml(p.label)}</button>`).join('')}
            ${preset ? '<button type="button" class="chm-preset chm-preset-off" title="Выключить пресет — рандом снова собирает кого угодно"><i class="fa-solid fa-xmark"></i> Сброс</button>' : ''}
        </div>`;
}

export function renderRandomCard() {
    if (!card) return;
    const rulesOpen = card.querySelector('.chm-rules')?.open;
    card.innerHTML = html();
    if (rulesOpen) card.querySelector('.chm-rules').open = true;
}

function changed(opts = { random: true }) {
    onChange(opts);
}

function onClick(e) {
    const s = getSettings();
    const r = s.rnd;

    const mode = e.target.closest('[data-mode]');
    if (mode) {
        r.mode = mode.dataset.mode;
        saveSettings();
        renderRandomCard();
        return;
    }
    const w = e.target.closest('[data-without]');
    if (w) {
        const id = w.dataset.without;
        r.without = r.without.includes(id) ? r.without.filter((x) => x !== id) : [...r.without, id];
        saveSettings();
        renderRandomCard();
        return;
    }
    const pc = e.target.closest('[data-partcolor]');
    if (pc) {
        r.rules.partColor = pc.dataset.partcolor;
        saveSettings();
        renderRandomCard();
        return;
    }
    const sc = e.target.closest('[data-scheme]');
    if (sc) {
        r.rules.scheme = sc.dataset.scheme;
        saveSettings();
        renderRandomCard();
        return;
    }
    if (e.target.closest('.chm-new-palette')) {
        const pal = rerollPalette(db);
        changed();
        toast(`Новая палитра: ${pal.hues.map((h) => RU_COLOR[h] || h).join(' · ')}`);
        return;
    }
    if (e.target.closest('.chm-roll-all')) {
        rollAll(db, {});
        changed();
        return;
    }
    if (e.target.closest('.chm-roll-simple')) {
        rollAll(db, { simple: true });
        changed();
        return;
    }
    if (e.target.closest('.chm-preset-off')) {
        clearPreset();
        renderRandomCard();
        changed({ preset: true });
        return;
    }
    const p = e.target.closest('[data-preset]');
    if (p) {
        rollPreset(db, p.dataset.preset);
        renderRandomCard();
        changed();
    }
}

function onInput(e) {
    const range = e.target.closest('.chm-detail-range');
    if (!range) return;
    getSettings().rnd.detail = Number(range.value) || 6;
    card.querySelector('.chm-detail-val').textContent = range.value;
    saveSettings();
}

function onChangeEvt(e) {
    const t = e.target.closest('[data-rule]');
    if (!t) return;
    getSettings().rnd.rules[t.dataset.rule] = t.checked;
    saveSettings();
    if (t.dataset.rule === 'palette') renderRandomCard();
}

/**
 * @param {HTMLElement} el — .chm-random-card
 * @param {object} database
 * @param {(opts) => void} onBuildChanged
 */
export function initRandomCard(el, database, onBuildChanged) {
    card = el;
    db = database;
    onChange = onBuildChanged || (() => {});
    renderRandomCard();
    card.addEventListener('click', onClick);
    card.addEventListener('input', onInput);
    card.addEventListener('change', onChangeEvt);
}
