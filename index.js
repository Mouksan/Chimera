// Chimera — конструктор персонажа по тегам
// Этап 1: каркас — окно во весь экран в две колонки, кнопки запуска, настройки под шестерёнкой
// Этап 2: каталог тегов — разделы, категории, подгруппы, поиск, выбор «один / мульти»

import { getSettings, saveSettings, escapeHtml, TOAST_TITLE } from './store.js';
import { addSettingsDrawer, settingsPaneHtml, bindSettingsPane } from './settings.js';
import { initLaunchers } from './launcher.js';
import { loadTags } from './data.js';
import { initCatalog, bindGlobalSearch, getDb, refreshAllSelection } from './catalog.js';

// ---------- Окно ----------

let overlayEl = null;
let settingsOpen = false;

function buildWindow() {
    const overlay = document.createElement('div');
    overlay.id = 'chm-overlay';
    overlay.className = 'chm-overlay';
    overlay.innerHTML = `
        <div class="chm-window" role="dialog" aria-label="Chimera">
            <div class="chm-header">
                <div class="chm-title"><i class="fa-solid fa-dragon"></i><span>「 CHIMERA 」</span></div>
                <div class="chm-search-wrap">
                    <label class="chm-search">
                        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                        <input type="search" class="chm-search-input" placeholder="найти тег по названию или по-английски" autocomplete="off" spellcheck="false">
                        <kbd class="chm-kbd" title="Быстрый поиск">/</kbd>
                    </label>
                    <div class="chm-search-results" hidden></div>
                </div>
                <button class="chm-icon-btn chm-gear" type="button" title="Настройки" aria-pressed="false"><i class="fa-solid fa-gear"></i></button>
                <button class="chm-icon-btn chm-close" type="button" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <div class="chm-mtabs" role="tablist">
                <button class="chm-mtab" type="button" data-mtab="catalog">Каталог</button>
                <button class="chm-mtab" type="button" data-mtab="panel">Персонаж <span class="chm-mtab-count">0</span></button>
            </div>

            <div class="chm-body">
                <div class="chm-main">
                    <section class="chm-col chm-catalog" data-col="catalog">
                        <div class="chm-card chm-random-card">
                            <div class="chm-card-head"><i class="fa-solid fa-dice"></i> Рандом и пресеты</div>
                            <div class="chm-stub">Режимы, «рандом без…» и пресеты-архетипы появятся на этапе 4.</div>
                        </div>
                        <div class="chm-catalog-list">
                            <div class="chm-stub chm-stub-big"><i class="fa-solid fa-spinner fa-spin"></i> Загружаю теги…</div>
                        </div>
                    </section>

                    <aside class="chm-col chm-panel" data-col="panel">
                        <div class="chm-panel-head">
                            <span class="chm-panel-title">Собранный персонаж</span>
                            <span class="chm-panel-count">0 тег.</span>
                        </div>
                        <div class="chm-card chm-prompt-card">
                            <div class="chm-mono-label">prompt</div>
                            <div class="chm-prompt-text"></div>
                        </div>
                        <div class="chm-stub">Пока это черновой просмотр выбранного. Веса, закрепы, тумблеры и копирование — этап 3; стиль и генерация — этап 5.</div>
                    </aside>
                </div>

                <section class="chm-settings-pane">
                    <div class="chm-viewer-bar">
                        <button class="chm-btn chm-settings-back" type="button"><i class="fa-solid fa-arrow-left"></i> Назад</button>
                        <span class="chm-settings-heading">Настройки</span>
                    </div>
                    ${settingsPaneHtml()}
                </section>
            </div>
        </div>`;

    overlay.querySelector('.chm-close').addEventListener('click', closeWindow);
    overlay.querySelector('.chm-gear').addEventListener('click', () => (settingsOpen ? closeSettings() : openSettings()));
    overlay.querySelector('.chm-settings-back').addEventListener('click', closeSettings);

    overlay.querySelectorAll('.chm-mtab').forEach((btn) => {
        btn.addEventListener('click', () => {
            getSettings().mobileTab = btn.dataset.mtab === 'panel' ? 'panel' : 'catalog';
            saveSettings();
            renderMobileTabs();
        });
    });

    document.body.appendChild(overlay);
    bindSettingsPane();
    renderPanel(overlay);
    return overlay;
}

// ---------- Каталог и правая панель ----------

let catalogReady = false;
let catalogLoading = false;

async function ensureCatalog() {
    if (catalogReady || catalogLoading || !overlayEl) return;
    catalogLoading = true;
    const list = overlayEl.querySelector('.chm-catalog-list');
    try {
        const db = await loadTags();
        initCatalog(list, db, () => renderPanel());
        bindGlobalSearch(
            overlayEl.querySelector('.chm-search-input'),
            overlayEl.querySelector('.chm-search-results'),
            () => {
                getSettings().mobileTab = 'catalog';
                saveSettings();
                renderMobileTabs();
            },
        );
        catalogReady = true;
        dropUnknownTags(db);
        renderPanel();
    } catch (error) {
        console.error('[Chimera] Не удалось загрузить базу тегов', error);
        list.innerHTML = `<div class="chm-stub chm-stub-big">Не удалось загрузить базу тегов.<br><small>${escapeHtml(error?.message || error)}</small></div>`;
        window.toastr?.error('Не удалось загрузить базу тегов — подробности в консоли.', TOAST_TITLE);
    } finally {
        catalogLoading = false;
    }
}

/** Если тег удалили или переименовали в tags.txt — молча выкинуть его из сборки. */
function dropUnknownTags(db) {
    const s = getSettings();
    const before = s.build.length;
    s.build = s.build.filter((b) => db.tags.has(b.id));
    if (s.build.length !== before) {
        saveSettings();
        refreshAllSelection();
    }
}

/** Правая колонка: пока счётчик и черновой список выбранных английских тегов. */
function renderPanel(root = overlayEl) {
    if (!root) return;
    const db = getDb();
    const build = getSettings().build;
    const n = build.length;
    root.querySelector('.chm-panel-count').textContent = `${n} тег.`;
    const mcount = root.querySelector('.chm-mtab-count');
    if (mcount) mcount.textContent = String(n);
    const text = root.querySelector('.chm-prompt-text');
    if (!db || !n) {
        text.innerHTML = '<span class="chm-prompt-empty">// пусто — выбери теги слева</span>';
        return;
    }
    text.innerHTML = build
        .map((b) => db.tags.get(b.id))
        .filter(Boolean)
        .map((t) => `<span class="chm-ptag">${escapeHtml(t.en)}</span>`)
        .join('<span class="chm-pcomma">, </span>');
}

function openSettings() {
    settingsOpen = true;
    renderSettingsState();
}

function closeSettings() {
    settingsOpen = false;
    renderSettingsState();
}

function renderSettingsState() {
    if (!overlayEl) return;
    overlayEl.classList.toggle('chm-settings-on', settingsOpen);
    const gear = overlayEl.querySelector('.chm-gear');
    gear?.classList.toggle('chm-active', settingsOpen);
    gear?.setAttribute('aria-pressed', String(settingsOpen));
}

function renderMobileTabs() {
    if (!overlayEl) return;
    const tab = getSettings().mobileTab === 'panel' ? 'panel' : 'catalog';
    overlayEl.dataset.mtab = tab;
    overlayEl.querySelectorAll('.chm-mtab').forEach((btn) => {
        btn.classList.toggle('chm-active', btn.dataset.mtab === tab);
        btn.setAttribute('aria-selected', String(btn.dataset.mtab === tab));
    });
}

function isOpen() {
    return Boolean(overlayEl && overlayEl.classList.contains('chm-open'));
}

function isTyping(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function onKeyDown(e) {
    if (!isOpen()) return;
    if (e.key === 'Escape') {
        // Если поверх открыт попап таверны — пусть он сам обработает Esc
        if (document.querySelector('dialog[open]')) return;
        if (settingsOpen) {
            closeSettings();
            return;
        }
        closeWindow();
        return;
    }
    // «/» — сразу в поиск (как на сайте)
    if (e.key === '/' && !isTyping(document.activeElement) && !settingsOpen) {
        e.preventDefault();
        overlayEl.querySelector('.chm-search-input')?.focus();
    }
}

/**
 * Высота видимой части экрана → --chm-vh у подложки. На телефоне это надёжнее dvh:
 * учитывает панель браузера и открытую клавиатуру. (Порт из Junket.)
 */
function syncViewportHeight() {
    if (!overlayEl) return;
    const height = window.visualViewport?.height || window.innerHeight;
    if (height > 0) overlayEl.style.setProperty('--chm-vh', `${Math.round(height)}px`);
    keepOverlayOnScreen();
}

/** Страховка для мобильного Firefox: если страницу под окном прокрутило — возвращаем подложку наверх. */
function keepOverlayOnScreen() {
    if (!isOpen()) return;
    if (overlayEl.scrollTop || overlayEl.scrollLeft) overlayEl.scrollTo(0, 0);
    const current = parseFloat(overlayEl.style.getPropertyValue('--chm-top')) || 0;
    const drift = overlayEl.getBoundingClientRect().top;
    if (Math.abs(drift) < 1) return;
    overlayEl.style.setProperty('--chm-top', `${Math.round(current - drift)}px`);
}

let viewportBound = false;
function bindViewport() {
    if (viewportBound) return;
    viewportBound = true;
    window.addEventListener('resize', syncViewportHeight);
    window.visualViewport?.addEventListener('resize', syncViewportHeight);
    window.addEventListener('scroll', keepOverlayOnScreen, { passive: true });
    overlayEl?.addEventListener('scroll', keepOverlayOnScreen, { passive: true });
}

const FADE_MS = 150;
let closeTimer = null;

function openWindow() {
    if (!overlayEl) overlayEl = buildWindow();
    clearTimeout(closeTimer);
    overlayEl.classList.remove('chm-closing');
    syncViewportHeight();
    bindViewport();
    settingsOpen = false;
    renderSettingsState();
    renderMobileTabs();
    overlayEl.classList.add('chm-open');
    document.addEventListener('keydown', onKeyDown);
    ensureCatalog();
}

function closeWindow() {
    if (!isOpen() || overlayEl.classList.contains('chm-closing')) return;
    document.removeEventListener('keydown', onKeyDown);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
        overlayEl.classList.remove('chm-open');
        return;
    }
    // Плавно гасим, потом прячем (как fadeOut у Loom)
    overlayEl.classList.add('chm-closing');
    closeTimer = setTimeout(() => {
        overlayEl.classList.remove('chm-open', 'chm-closing');
    }, FADE_MS);
}

// ---------- Встраивание в таверну ----------

function addWandButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('chm-wand')) return;

    const item = document.createElement('div');
    item.id = 'chm-wand';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = `<div class="fa-solid fa-dragon extensionsMenuExtensionButton"></div><span>Chimera</span>`;
    item.addEventListener('click', () => openWindow());
    menu.appendChild(item);
}

jQuery(async () => {
    getSettings();
    addSettingsDrawer(() => openWindow());
    addWandButton();
    initLaunchers(() => openWindow());
    // Чат Химере не нужен — на CHAT_CHANGED ничего не сбрасываем
});
