// Chimera — настройки. Живут в самом окне (шестерёнка в шапке),
// в ящике расширений — только кнопка «Открыть Chimera». Порт схемы из Junket.

import { getSettings, saveSettings, escapeHtml, makeId } from './store.js';
import { LAUNCHER_MODES, launcherMode, syncLaunchers } from './launcher.js';
import {
    NAI_MODELS, NAI_SAMPLERS, NAI_SCHEDULES, NAI_FINE_RANGES, RATIO_CHOICES, SIZE_LABELS,
    normalizeFine, checkNovelAiKey, checkNaisteraKey, komaSettings, copyDrawingFromKoma,
} from './gen.js';
import { toast } from './notice.js';

let onStylesChanged = () => {};

/** Кто перерисовывает выбор стиля в панели, когда стили поменялись. */
export function setStylesListener(fn) {
    onStylesChanged = fn || (() => {});
}

let onSceneToggled = () => {};

/** Кто перерисовывает шапку и экран, когда тумблер «Сцена 18+» переключили. */
export function setSceneListener(fn) {
    onSceneToggled = fn || (() => {});
}

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

    const s = getSettings();
    const draw = `
        <label class="chm-label" for="chm_provider">Провайдер</label>
        <select id="chm_provider" class="text_pole">
            <option value="novelai" ${s.provider !== 'naistera' ? 'selected' : ''}>NovelAI (подписка)</option>
            <option value="naistera" ${s.provider === 'naistera' ? 'selected' : ''}>Наистера</option>
        </select>

        <div id="chm_prov_novelai" class="chm-subsection" ${s.provider === 'naistera' ? 'hidden' : ''}>
            <label class="chm-label" for="chm_nai_key">Ключ NovelAI</label>
            <input type="password" id="chm_nai_key" class="text_pole" autocomplete="off" value="${escapeHtml(s.naiKey)}">
            <div class="chm-set-hint">Persistent API Token из настроек аккаунта NovelAI, начинается с pst-</div>
            <label class="chm-label" for="chm_nai_model">Модель</label>
            <select id="chm_nai_model" class="text_pole">
                ${NAI_MODELS.map((m) => `<option value="${m.id}" ${s.naiModel === m.id ? 'selected' : ''}>${m.label}</option>`).join('')}
            </select>
            <div class="chm-set-hint">Размеры только бесплатные для Opus: 832×1216, 1024×1024, 1216×832.</div>
            <button type="button" class="menu_button menu_button_icon chm-check" data-check="novelai"><i class="fa-solid fa-key"></i><span>Проверить ключ</span></button>
        </div>

        <div id="chm_prov_naistera" class="chm-subsection" ${s.provider === 'naistera' ? '' : 'hidden'}>
            <label class="chm-label" for="chm_naistera_key">Ключ наистеры</label>
            <input type="password" id="chm_naistera_key" class="text_pole" autocomplete="off" value="${escapeHtml(s.naisteraKey)}">
            <label class="chm-label" for="chm_naistera_endpoint">Endpoint URL</label>
            <input type="text" id="chm_naistera_endpoint" class="text_pole" placeholder="https://naistera.org" value="${escapeHtml(s.naisteraEndpoint)}">
            <div class="chm-set-hint">Пусто — https://naistera.org</div>
            <div class="chm-label">Рамки</div>
            <div class="chm-aspect-grid">
                ${Object.keys(SIZE_LABELS).map((a) => `
                    <span>${SIZE_LABELS[a]}</span>
                    <select class="text_pole" data-aspect="${a}">
                        ${RATIO_CHOICES.map((r) => `<option value="${r}" ${s.aspectMap[a] === r ? 'selected' : ''}>${r}</option>`).join('')}
                    </select>`).join('')}
            </div>
            <button type="button" class="menu_button menu_button_icon chm-check" data-check="naistera"><i class="fa-solid fa-key"></i><span>Проверить ключ</span></button>
        </div>

        <button type="button" class="menu_button menu_button_icon chm-from-koma"><i class="fa-solid fa-file-import"></i><span>Взять из Комы</span></button>
        <div class="chm-set-hint">Перенесёт провайдера, ключи, модель, адрес наистеры, рамки и тонкую настройку из Комы. Своё в Химере перезапишется.</div>`;

    const fine = `
        <div class="chm-set-hint">Только для NovelAI напрямую. Стиль может перебить своей галочкой «Свои настройки NovelAI».</div>
        <div id="chm_fine_global">${fineFieldsHtml(s.naiFine)}</div>`;

    const styles = `
        <div class="chm-set-hint">Теги стиля встают в начало промта (повторы из промта выкидываются). Негатив стиля, если заполнен, заменяет negative.txt.</div>
        <div id="chm_styles_list" class="chm-styles-list"></div>
        <div class="chm-style-btns">
            <button type="button" class="menu_button menu_button_icon" id="chm_style_add"><i class="fa-solid fa-plus"></i><span>Новый стиль</span></button>
            <button type="button" class="menu_button menu_button_icon" id="chm_style_import"><i class="fa-solid fa-file-import"></i><span>Импорт из Комы</span></button>
        </div>`;

    const scene = `
        <label class="chm-switch">
            <input type="checkbox" id="chm_scene_enabled" ${s.sceneEnabled ? 'checked' : ''}>
            <span class="chm-switch-track"></span>
            <span class="chm-switch-label">Сцена 18+</span>
        </label>
        <div class="chm-set-hint">Показывает в шапке переключатель режимов и режим «Сцена»: позы, место, ракурс, детали. По умолчанию выключено. Каталог поз загружается только когда режим открыт.</div>
        <div class="chm-set-hint">В режиме «Сцена» защита «только взрослые» вшита и не отключается: в промте всегда adult, в негативе всегда анти-детские теги — даже если у стиля свой негатив.</div>`;

    return `
        <div class="chm-settings chm-settings-window" id="chm_settings_root">
            ${categoryHtml('fa-rocket', 'Запуск', launch, true)}
            ${categoryHtml('fa-paintbrush', 'Рисование', draw)}
            ${categoryHtml('fa-sliders', 'Тонкая настройка NovelAI', fine)}
            ${categoryHtml('fa-palette', 'Стили', styles)}
            ${categoryHtml('fa-film', 'Сцена 18+', scene)}
        </div>`;
}

// ---------- Тонкая настройка NovelAI (порт из Комы) ----------

function fineFieldsHtml(fine) {
    const f = normalizeFine(fine);
    const options = (list, current) => list.map((x) => `<option value="${x.id}" ${x.id === current ? 'selected' : ''}>${x.label}</option>`).join('');
    return `
        <label class="chm-label">Сэмплер</label>
        <select class="text_pole" data-fine="sampler">${options(NAI_SAMPLERS, f.sampler)}</select>
        <div class="chm-set-hint">Euler Ancestral — мягко и разнообразно, стоит по умолчанию. DPM++ 2M SDE и DPM++ SDE — чище лайн и детали. DPM++ 2M — стабильный, почти без случайности.</div>
        <label class="chm-label">Расписание шума</label>
        <select class="text_pole" data-fine="schedule">${options(NAI_SCHEDULES, f.schedule)}</select>
        <div class="chm-set-hint">Karras подходит почти всем сэмплерам. Exponential часто лучше для DPM++ 2M и DPM++ 2M SDE.</div>
        <label class="chm-label">Шаги</label>
        <input type="number" class="text_pole" data-fine="steps" min="${NAI_FINE_RANGES.steps[0]}" max="${NAI_FINE_RANGES.steps[1]}" step="1" value="${f.steps}">
        <div class="chm-set-hint">До 28 — бесплатно на Opus.</div>
        <label class="chm-label">Guidance (CFG)</label>
        <input type="number" class="text_pole" data-fine="scale" min="${NAI_FINE_RANGES.scale[0]}" max="${NAI_FINE_RANGES.scale[1]}" step="0.1" value="${f.scale}">
        <div class="chm-set-hint">Насколько строго держаться промта. Выше — жёстче и контрастнее.</div>
        <label class="chm-label">Rescale CFG</label>
        <input type="number" class="text_pole" data-fine="rescale" min="${NAI_FINE_RANGES.rescale[0]}" max="${NAI_FINE_RANGES.rescale[1]}" step="0.02" value="${f.rescale}">
        <div class="chm-set-hint">Гасит пересвет и пережжённые цвета на высоком CFG.</div>`;
}

/** Сохранение тонких полей. getTarget() — куда писать: общие настройки или стиль. */
function bindFineFields(root, getTarget) {
    for (const field of root.querySelectorAll('[data-fine]')) {
        field.addEventListener('change', (e) => {
            const target = getTarget();
            if (!target) return;
            const key = e.target.dataset.fine;
            const next = normalizeFine({ ...normalizeFine(target), [key]: e.target.value });
            Object.assign(target, next);
            e.target.value = next[key];
            saveSettings();
        });
    }
}

// ---------- Стили (порт из Комы) ----------

function renderStylesList(openId = null) {
    const list = document.getElementById('chm_styles_list');
    if (!list) return;
    const styles = getSettings().styles;
    if (!styles.length) {
        list.innerHTML = '<div class="chm-set-hint">Стилей пока нет. Создай свой или забери из Комы.</div>';
        return;
    }
    list.innerHTML = styles.map((style) => `
        <details class="chm-style-item" data-id="${escapeHtml(style.id)}" ${style.id === openId ? 'open' : ''}>
            <summary>${escapeHtml(style.name || 'Без названия')}</summary>
            <div class="chm-style-body">
                <div class="chm-style-top">
                    <input type="text" class="text_pole" data-f="name" value="${escapeHtml(style.name)}" placeholder="Название">
                    <button type="button" class="chm-icon-btn" data-act="remove" title="Удалить стиль"><i class="fa-solid fa-trash"></i></button>
                </div>
                <textarea class="text_pole chm-mono-area" data-f="tags" rows="4" spellcheck="false" placeholder="теги стиля через запятую">${escapeHtml(style.tags)}</textarea>
                <label class="chm-label">Негатив стиля</label>
                <textarea class="text_pole chm-mono-area" data-f="negative" rows="2" spellcheck="false" placeholder="пусто — идёт negative.txt">${escapeHtml(style.negative || '')}</textarea>
                <label class="checkbox_label chm-check-line">
                    <input type="checkbox" data-f="fineOn" ${style.fineOn ? 'checked' : ''}>
                    <span>Свои настройки NovelAI</span>
                </label>
                <div class="chm-subsection" data-fine-box ${style.fineOn ? '' : 'hidden'}>${fineFieldsHtml(style.fine || getSettings().naiFine)}</div>
            </div>
        </details>`).join('');

    for (const item of list.querySelectorAll('.chm-style-item')) {
        const style = () => getSettings().styles.find((x) => x.id === item.dataset.id);
        item.querySelector('[data-f="name"]').addEventListener('change', (e) => {
            const t = style();
            if (!t) return;
            t.name = String(e.target.value || '').trim() || 'Без названия';
            item.querySelector('summary').textContent = t.name;
            saveSettings();
            onStylesChanged();
        });
        for (const f of ['tags', 'negative']) {
            item.querySelector(`[data-f="${f}"]`).addEventListener('change', (e) => {
                const t = style();
                if (!t) return;
                t[f] = String(e.target.value || '').trim();
                saveSettings();
                onStylesChanged();
            });
        }
        const fineBox = item.querySelector('[data-fine-box]');
        item.querySelector('[data-f="fineOn"]').addEventListener('change', (e) => {
            const t = style();
            if (!t) return;
            t.fineOn = Boolean(e.target.checked);
            // Первое включение — отталкиваемся от общих настроек
            if (t.fineOn && !t.fine) {
                t.fine = normalizeFine(getSettings().naiFine);
                fineBox.innerHTML = fineFieldsHtml(t.fine);
                bindFineFields(fineBox, () => style()?.fine);
            }
            fineBox.hidden = !t.fineOn;
            saveSettings();
        });
        bindFineFields(fineBox, () => style()?.fine);
        const removeBtn = item.querySelector('[data-act="remove"]');
        removeBtn.addEventListener('click', () => {
            // Двойное нажатие вместо системного confirm
            if (removeBtn.dataset.confirm !== '1') {
                removeBtn.dataset.confirm = '1';
                removeBtn.classList.add('chm-danger');
                removeBtn.title = 'Нажми ещё раз — стиль удалится';
                setTimeout(() => {
                    if (!removeBtn.isConnected) return;
                    removeBtn.dataset.confirm = '';
                    removeBtn.classList.remove('chm-danger');
                    removeBtn.title = 'Удалить стиль';
                }, 3000);
                return;
            }
            const s = getSettings();
            s.styles = s.styles.filter((x) => x.id !== item.dataset.id);
            if (s.activeStyleId === item.dataset.id) s.activeStyleId = '';
            saveSettings();
            renderStylesList();
            onStylesChanged();
        });
    }
}

/** Импорт стилей из Комы: окошко с галками. Уже перенесённые (то же имя и теги) не дублируются. */
function openKomaImport() {
    const k = komaSettings();
    const incoming = (Array.isArray(k?.styles) ? k.styles : []).filter((x) => String(x?.tags || '').trim());
    if (!incoming.length) {
        toast(k ? 'В Коме нет стилей.' : 'Кома не найдена — она установлена и включена?');
        return;
    }
    const mine = getSettings().styles;
    const dup = (x) => mine.some((m) => m.name === x.name && m.tags === x.tags);

    const win = document.querySelector('#chm-overlay .chm-window');
    const wrap = document.createElement('div');
    wrap.className = 'chm-modal-wrap';
    wrap.innerHTML = `
        <div class="chm-modal" role="dialog" aria-label="Импорт стилей из Комы">
            <div class="chm-modal-head">
                <span class="chm-modal-title"><i class="fa-solid fa-file-import"></i> Стили из Комы</span>
                <button type="button" class="chm-icon-btn chm-modal-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="chm-set-hint">Импорт добавляет копии — стили Комы остаются на месте, править их можно независимо.</div>
            <div class="chm-import-list">
                ${incoming.map((x, i) => `
                    <label class="checkbox_label chm-import-item${dup(x) ? ' chm-import-dup' : ''}">
                        <input type="checkbox" data-i="${i}" ${dup(x) ? 'disabled' : 'checked'}>
                        <span>${escapeHtml(x.name || 'Без названия')}${dup(x) ? ' · уже есть' : ''}</span>
                    </label>`).join('')}
            </div>
            <div class="chm-modal-foot">
                <button type="button" class="chm-btn chm-modal-close">Отмена</button>
                <button type="button" class="chm-btn chm-btn-accent chm-import-go">Импортировать</button>
            </div>
        </div>`;
    win.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    wrap.querySelectorAll('.chm-modal-close').forEach((b) => b.addEventListener('click', close));
    wrap.querySelector('.chm-import-go').addEventListener('click', () => {
        const picked = [...wrap.querySelectorAll('input[data-i]:checked')].map((el) => incoming[Number(el.dataset.i)]);
        const s = getSettings();
        for (const x of picked) {
            s.styles.push({
                id: makeId(),
                name: String(x.name || 'Без названия'),
                tags: String(x.tags || ''),
                negative: String(x.negative || ''),
                fineOn: Boolean(x.fineOn),
                fine: x.fine ? normalizeFine(x.fine) : undefined,
            });
        }
        saveSettings();
        close();
        renderStylesList();
        onStylesChanged();
        toast(`Импортировано стилей: ${picked.length}`);
    });
}

/** Открыто ли окошко импорта (для Esc). */
export function closeSettingsModal() {
    const el = document.querySelector('#chm-overlay .chm-modal-wrap');
    if (!el) return false;
    el.remove();
    return true;
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

    document.getElementById('chm_scene_enabled').addEventListener('change', (e) => {
        const st = getSettings();
        st.sceneEnabled = e.target.checked;
        if (!st.sceneEnabled) st.mode = 'character';   // выключили — окно возвращается в «Персонаж»
        saveSettings();
        onSceneToggled();
    });

    document.getElementById('chm_launcher').addEventListener('change', (e) => {
        getSettings().launcherMode = LAUNCHER_MODES.some((m) => m.id === e.target.value) ? e.target.value : 'bar';
        saveSettings();
        syncLaunchers();
    });

    // Рисование
    const s = () => getSettings();
    document.getElementById('chm_provider').addEventListener('change', (e) => {
        s().provider = e.target.value === 'naistera' ? 'naistera' : 'novelai';
        saveSettings();
        document.getElementById('chm_prov_novelai').hidden = s().provider === 'naistera';
        document.getElementById('chm_prov_naistera').hidden = s().provider !== 'naistera';
    });
    const bindText = (id, key) => document.getElementById(id).addEventListener('change', (e) => {
        s()[key] = String(e.target.value || '').trim();
        saveSettings();
    });
    bindText('chm_nai_key', 'naiKey');
    bindText('chm_naistera_key', 'naisteraKey');
    bindText('chm_naistera_endpoint', 'naisteraEndpoint');
    document.getElementById('chm_nai_model').addEventListener('change', (e) => {
        s().naiModel = e.target.value;
        saveSettings();
    });
    root.querySelectorAll('[data-aspect]').forEach((el) => el.addEventListener('change', (e) => {
        s().aspectMap[e.target.dataset.aspect] = e.target.value;
        saveSettings();
    }));
    root.querySelectorAll('.chm-check').forEach((btn) => btn.addEventListener('click', async () => {
        btn.disabled = true;
        const res = btn.dataset.check === 'naistera' ? await checkNaisteraKey() : await checkNovelAiKey();
        btn.disabled = false;
        toast(res.text, 4500);
    }));
    root.querySelector('.chm-from-koma').addEventListener('click', () => {
        if (!copyDrawingFromKoma()) {
            toast('Кома не найдена — она установлена и включена?');
            return;
        }
        // Поля пересобираем целиком — проще, чем обновлять по одному
        refreshDrawFields();
        toast('Настройки рисования взяты из Комы');
    });

    bindFineFields(document.getElementById('chm_fine_global'), () => s().naiFine);

    // Стили
    renderStylesList();
    document.getElementById('chm_style_add').addEventListener('click', () => {
        const style = { id: makeId(), name: 'Новый стиль', tags: '', negative: '' };
        s().styles.push(style);
        saveSettings();
        renderStylesList(style.id);
        onStylesChanged();
    });
    document.getElementById('chm_style_import').addEventListener('click', openKomaImport);
}

/** Обновить поля «Рисования» и тонкой настройки после «Взять из Комы». */
function refreshDrawFields() {
    const s = getSettings();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('chm_provider', s.provider);
    set('chm_nai_key', s.naiKey);
    set('chm_nai_model', s.naiModel);
    set('chm_naistera_key', s.naisteraKey);
    set('chm_naistera_endpoint', s.naisteraEndpoint);
    document.getElementById('chm_prov_novelai').hidden = s.provider === 'naistera';
    document.getElementById('chm_prov_naistera').hidden = s.provider !== 'naistera';
    document.querySelectorAll('#chm_settings_root [data-aspect]').forEach((el) => { el.value = s.aspectMap[el.dataset.aspect]; });
    const box = document.getElementById('chm_fine_global');
    box.innerHTML = fineFieldsHtml(s.naiFine);
    bindFineFields(box, () => getSettings().naiFine);
}
