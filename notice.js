// Chimera — полоска внизу окна: «Тег в бане · Отменить» и короткие подсказки.
// Живёт внутри окна (тосты таверны прячутся под нашим слоем на телефоне).

import { escapeHtml } from './store.js';

const UNDO_MS = 5000;
const TOAST_MS = 2600;

let timer = null;

function bar() {
    const win = document.querySelector('#chm-overlay .chm-window');
    if (!win) return null;
    let el = win.querySelector('.chm-notice');
    if (!el) {
        el = document.createElement('div');
        el.className = 'chm-notice';
        el.setAttribute('role', 'status');
        el.hidden = true;
        win.appendChild(el);
    }
    return el;
}

function hide() {
    const el = bar();
    if (el) el.hidden = true;
}

function show(html, ms) {
    const el = bar();
    if (!el) return null;
    clearTimeout(timer);
    el.innerHTML = html;
    el.hidden = false;
    timer = setTimeout(hide, ms);
    return el;
}

/** Сообщение с кнопкой «Отменить». */
export function showUndo(text, onUndo) {
    const el = show(
        `<span class="chm-notice-text">${escapeHtml(text)}</span>`
        + '<button type="button" class="chm-notice-undo"><i class="fa-solid fa-rotate-left"></i> Отменить</button>',
        UNDO_MS,
    );
    el?.querySelector('.chm-notice-undo').addEventListener('click', () => {
        clearTimeout(timer);
        hide();
        onUndo();
    }, { once: true });
}

/** Короткая подсказка без кнопок. ms — сколько держать (ошибки провайдера держим дольше). */
export function toast(text, ms = TOAST_MS) {
    show(`<span class="chm-notice-text">${escapeHtml(text)}</span>`, ms);
}
