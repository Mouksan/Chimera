// Chimera — окошко «Бан-лист» поверх окна: всё забаненное, «вернуть» по одному и «очистить всё».

import { getSettings, saveSettings, escapeHtml } from './store.js';
import { describeBan, removeBan } from './bans.js';

let db = null;
let onChanged = () => {};

const GROUPS = [
    { kind: 'cat', title: 'Категории' },
    { kind: 'sub', title: 'Подгруппы' },
    { kind: 'tag', title: 'Теги' },
];

function modalEl() {
    return document.querySelector('#chm-overlay .chm-modal-wrap');
}

export function isBanListOpen() {
    return Boolean(modalEl());
}

function listHtml() {
    const keys = getSettings().banned;
    const items = keys
        .map((key) => ({ key, ...describeBan(db, key) }))
        .filter((x) => x.kind);
    if (!items.length) {
        return '<div class="chm-prompt-empty">// бан-лист пуст. Банить можно правым кликом по тегу (на телефоне — долгим нажатием), 🚫 у подгруппы или в шапке категории.</div>';
    }
    return GROUPS.map((g) => {
        const list = items.filter((x) => x.kind === g.kind);
        if (!list.length) return '';
        return `<div class="chm-bl-group">
            <div class="chm-mono-label">${g.title} · ${list.length}</div>
            ${list.map((x) => `
                <div class="chm-bl-row" data-key="${escapeHtml(x.key)}">
                    <span class="chm-bl-title">${escapeHtml(x.title)}</span>
                    <span class="chm-bl-note">${escapeHtml(x.note)}</span>
                    <button type="button" class="chm-btn chm-bl-back" title="Вернуть в рандом"><i class="fa-solid fa-rotate-left"></i> Вернуть</button>
                </div>`).join('')}
        </div>`;
    }).join('');
}

function render() {
    const wrap = modalEl();
    if (!wrap) return;
    wrap.querySelector('.chm-bl-list').innerHTML = listHtml();
    const n = getSettings().banned.length;
    wrap.querySelector('.chm-bl-clear').disabled = n === 0;
    wrap.querySelector('.chm-modal-count').textContent = n ? String(n) : '';
}

export function openBanList() {
    if (isBanListOpen()) return;
    const win = document.querySelector('#chm-overlay .chm-window');
    if (!win) return;
    const wrap = document.createElement('div');
    wrap.className = 'chm-modal-wrap';
    wrap.innerHTML = `
        <div class="chm-modal" role="dialog" aria-label="Бан-лист">
            <div class="chm-modal-head">
                <span class="chm-modal-title"><i class="fa-solid fa-ban"></i> Бан-лист <span class="chm-modal-count"></span></span>
                <button type="button" class="chm-icon-btn chm-modal-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="chm-set-hint chm-bl-hint">Это не предлагает рандом. Руками выбрать забаненное можно всегда.</div>
            <div class="chm-bl-list"></div>
            <div class="chm-modal-foot">
                <button type="button" class="chm-btn chm-bl-clear"><i class="fa-solid fa-broom"></i> Очистить всё</button>
            </div>
        </div>`;
    win.appendChild(wrap);

    wrap.addEventListener('mousedown', (e) => {
        if (e.target === wrap) closeBanList();
    });
    wrap.addEventListener('click', (e) => {
        if (e.target.closest('.chm-modal-close')) {
            closeBanList();
            return;
        }
        const back = e.target.closest('.chm-bl-back');
        if (back) {
            removeBan(back.closest('.chm-bl-row').dataset.key);
            render();
            onChanged();
            return;
        }
        const clear = e.target.closest('.chm-bl-clear');
        if (clear) {
            if (clear.dataset.confirm !== '1') {
                // Двойное нажатие вместо системного confirm (диалоги таверны тут лишние)
                clear.dataset.confirm = '1';
                clear.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Точно очистить? Нажми ещё раз';
                setTimeout(() => {
                    if (!clear.isConnected) return;
                    clear.dataset.confirm = '';
                    clear.innerHTML = '<i class="fa-solid fa-broom"></i> Очистить всё';
                }, 3000);
                return;
            }
            getSettings().banned = [];
            saveSettings();
            render();
            onChanged();
        }
    });
    render();
}

export function closeBanList() {
    modalEl()?.remove();
}

export function initBanList(database, changed) {
    db = database;
    onChanged = changed || (() => {});
}
