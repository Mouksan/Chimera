// Chimera — настройки. Живут в самом окне (шестерёнка в шапке),
// в ящике расширений — только кнопка «Открыть Chimera». Порт схемы из Junket.

import { getSettings, saveSettings, escapeHtml } from './store.js';
import { LAUNCHER_MODES, launcherMode, syncLaunchers } from './launcher.js';

function categoryHtml(icon, title, body, open = false) {
    return `
        <div class="chm-cat">
            <button type="button" class="chm-cat-head" aria-expanded="${open}">
                <span><i class="fa-solid ${icon} fa-fw"></i> ${title}</span>
                <i class="fa-solid fa-chevron-down chm-cat-chevron"></i>
            </button>
            <div class="chm-cat-body" ${open ? '' : 'hidden'}>${body}</div>
        </div>`;
}

/** Содержимое экрана настроек в окне. */
export function settingsPaneHtml() {
    const launch = `
        <label class="chm-label" for="chm_launcher">Кнопка запуска</label>
        <select id="chm_launcher" class="text_pole">
            ${LAUNCHER_MODES.map((m) => `<option value="${m.id}" ${m.id === launcherMode() ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
        </select>
        <div class="chm-set-hint">Пункт «Chimera» в меню расширений есть всегда. Плавающую кнопку можно перетащить куда удобно.</div>`;

    return `
        <div class="chm-settings chm-settings-window" id="chm_settings_root">
            ${categoryHtml('fa-rocket', 'Запуск', launch, true)}
        </div>`;
}

function drawerHtml() {
    return `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><i class="fa-solid fa-dragon" style="margin-right: 6px;"></i>「 CHIMERA 」</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="chm-settings">
                    <div class="chm-drawer-hint">Конструктор персонажа по тегам. Настройки — под шестерёнкой в окне.</div>
                    <button class="menu_button chm-open-btn" type="button">
                        <i class="fa-solid fa-dragon"></i>
                        <span>Открыть Chimera</span>
                    </button>
                </div>
            </div>
        </div>`;
}

/** Ящик в расширениях таверны: только кнопка открытия окна. */
export function addSettingsDrawer(onOpenWindow) {
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host || document.getElementById('chm-settings')) return;

    const wrap = document.createElement('div');
    wrap.id = 'chm-settings';
    wrap.innerHTML = drawerHtml();
    host.appendChild(wrap);

    wrap.querySelector('.chm-open-btn').addEventListener('click', () => onOpenWindow());
}

/** Оживить экран настроек. Вызывается один раз, когда окно уже в документе. */
export function bindSettingsPane() {
    const root = document.getElementById('chm_settings_root');
    if (!root) return;

    // Категории сворачиваются
    root.addEventListener('click', (e) => {
        const head = e.target.closest('.chm-cat-head');
        if (!head) return;
        const expanded = head.getAttribute('aria-expanded') === 'true';
        head.setAttribute('aria-expanded', String(!expanded));
        const body = head.nextElementSibling;
        if (body) body.hidden = expanded;
    });

    document.getElementById('chm_launcher').addEventListener('change', (e) => {
        getSettings().launcherMode = LAUNCHER_MODES.some((m) => m.id === e.target.value) ? e.target.value : 'bar';
        saveSettings();
        syncLaunchers();
    });
}
