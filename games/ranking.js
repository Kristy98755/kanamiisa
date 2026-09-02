/**
 * Rankings client — shared by all 3 games
 * Handles ID generation, localStorage, server sync, and UI overlay.
 *
 * Usage in game:
 *   rankingInit('flappy')   // or 'piano' or 'hearts'
 *   rankingSave()           // syncs all games' bests from localStorage
 *   rankingOpen()           // open leaderboard overlay
 */

let RANKING_GAME = '';
let RANKING_ID = localStorage.getItem('ranking_id') || null;
let RANKING_NAME = localStorage.getItem('ranking_name') || null;
let RANKING_OVERLAY = null;

function xor4(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return ('0000' + ((h >>> 0) % 0xFFFF).toString(16)).slice(-4);
}

function generateId(name) {
    return Date.now().toString(36) + xor4(name);
}

function ensureRankingIdentity() {
    if (!RANKING_ID) {
        RANKING_ID = generateId(`${Date.now()}-${Math.random()}`);
        localStorage.setItem('ranking_id', RANKING_ID);
    }
    if (!RANKING_NAME) {
        const guestNumber = (parseInt(xor4(RANKING_ID), 16) % 9999) + 1;
        RANKING_NAME = `Гость ${guestNumber}`;
        localStorage.setItem('ranking_name', RANKING_NAME);
    }
}

function rankingInit(game) {
    RANKING_GAME = game;
    ensureRankingIdentity();
    rankingSave();
}

function getPianoAggregate() {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('mikupiano_') && k !== 'mikupiano_total') {
            try {
                const v = JSON.parse(localStorage.getItem(k));
                if (v && typeof v.score === 'number') total += v.score;
            } catch (e) {}
        }
    }
    return total;
}

async function rankingSave() {
    ensureRankingIdentity();

    const body = {
        id: RANKING_ID,
        name: RANKING_NAME,
        flappy_best: parseInt(localStorage.getItem('flappy_best') || '0', 10) || 0,
        piano_best: getPianoAggregate(),
        hearts_best: parseInt(localStorage.getItem('hearts_best') || '0', 10) || 0
    };

    try {
        await fetch('/api/rankings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    } catch (e) {}
}

function rankingSetName(name) {
    ensureRankingIdentity();
    RANKING_NAME = name;
    localStorage.setItem('ranking_name', name);
}

async function rankingOpen() {
    if (RANKING_OVERLAY) return;
    if (RANKING_ID && RANKING_NAME) await rankingSave();
    createOverlay();
    loadTop();
}

function createOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'ranking-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(10,10,18,0.95);display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;color:#fff';

    const box = document.createElement('div');
    box.style.cssText = 'background:#12121e;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:28px 24px;width:90%;max-width:380px;max-height:80vh;overflow-y:auto;position:relative';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:20px;font-weight:700;color:#19e6f5;margin-bottom:16px;text-align:center';
    title.textContent = 'Рейтинг';

    const tabs = document.createElement('div');
    tabs.style.cssText = 'display:flex;gap:6px;margin-bottom:14px';
    const tabGames = [['flappy', 'Flappy'], ['piano', 'Piano'], ['hearts', 'Hearts']];
    const tabBtns = {};
    tabGames.forEach(([g, label]) => {
        const t = document.createElement('button');
        t.textContent = label;
        t.style.cssText = 'flex:1;padding:7px 0;border-radius:8px;font-size:13px;cursor:pointer;font-family:Inter,sans-serif;border:1px solid rgba(255,255,255,0.15)';
        const active = g === RANKING_GAME;
        t.style.background = active ? '#19e6f5' : 'rgba(255,255,255,0.05)';
        t.style.color = active ? '#0a0a12' : '#ccc';
        t.style.fontWeight = active ? '600' : '400';
        t.style.borderColor = active ? '#19e6f5' : 'rgba(255,255,255,0.15)';
        t.onclick = () => {
            RANKING_GAME = g;
            Object.values(tabBtns).forEach(b => {
                b.style.background = 'rgba(255,255,255,0.05)';
                b.style.color = '#ccc';
                b.style.fontWeight = '400';
                b.style.borderColor = 'rgba(255,255,255,0.15)';
            });
            t.style.background = '#19e6f5';
            t.style.color = '#0a0a12';
            t.style.fontWeight = '600';
            t.style.borderColor = '#19e6f5';
            loadTop();
        };
        tabBtns[g] = t;
        tabs.appendChild(t);
    });

    const topList = document.createElement('div');
    topList.id = 'ranking-top-list';
    topList.style.cssText = 'margin-bottom:16px;max-height:50vh;overflow-y:auto';

    const nameSection = document.createElement('div');
    nameSection.style.cssText = 'border-top:1px solid rgba(255,255,255,0.08);padding-top:14px;text-align:center';

    if (RANKING_NAME) {
        const yourName = document.createElement('div');
        yourName.style.cssText = 'font-size:13px;color:#888;margin-bottom:8px';
        yourName.textContent = 'Ваш ник: ' + RANKING_NAME;
        nameSection.appendChild(yourName);

        const changeBtn = document.createElement('button');
        changeBtn.style.cssText = 'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#ccc;padding:8px 18px;border-radius:8px;font-size:13px;cursor:pointer;font-family:Inter,sans-serif';
        changeBtn.textContent = 'Изменить имя';
        changeBtn.onclick = () => showNameInput(nameSection);
        nameSection.appendChild(changeBtn);
    } else {
        const saveBtn = document.createElement('button');
        saveBtn.style.cssText = 'background:#19e6f5;border:none;color:#0a0a12;padding:10px 22px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif';
        saveBtn.textContent = 'Сохранить рейтинг';
        saveBtn.onclick = () => showNameInput(nameSection);
        nameSection.appendChild(saveBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'position:absolute;top:12px;right:14px;background:none;border:none;color:#666;font-size:22px;cursor:pointer;line-height:1';
    closeBtn.textContent = '\u00d7';
    closeBtn.onclick = rankingClose;

    box.appendChild(closeBtn);
    box.appendChild(title);
    box.appendChild(tabs);
    box.appendChild(topList);
    box.appendChild(nameSection);
    overlay.appendChild(box);
    overlay.onclick = (e) => { if (e.target === overlay) rankingClose(); };
    document.body.appendChild(overlay);
    RANKING_OVERLAY = overlay;
}

function showNameInput(container) {
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:center;margin-top:8px';

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 20;
    input.placeholder = 'Ваш ник...';
    input.value = RANKING_NAME || '';
    input.style.cssText = 'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#fff;padding:8px 12px;border-radius:8px;font-size:14px;font-family:Inter,sans-serif;width:160px;outline:none';
    input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); };

    const btn = document.createElement('button');
    btn.style.cssText = 'background:#19e6f5;border:none;color:#0a0a12;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif';
    btn.textContent = 'Сохранить';
    btn.onclick = () => {
        const name = input.value.trim();
        if (!name) return;
        rankingSetName(name);
        rankingSave();
        rankingClose();
        createOverlay();
        loadTop();
    };

    wrap.appendChild(input);
    wrap.appendChild(btn);
    container.appendChild(wrap);
    input.focus();
}

async function loadTop() {
    const list = document.getElementById('ranking-top-list');
    if (!list) return;

    list.innerHTML = '<div style="text-align:center;color:#666;font-size:13px">Загрузка...</div>';

    try {
        const params = new URLSearchParams({ game: RANKING_GAME });
        if (RANKING_ID) params.set('id', RANKING_ID);
        const res = await fetch('/api/rankings/top?' + params.toString());
        const data = await res.json();

        if (!data.top || data.top.length === 0) {
            list.innerHTML = '<div style="text-align:center;color:#666;font-size:13px">Пока пусто</div>';
            return;
        }

        list.innerHTML = '';
        getRankingRows(data).forEach((r, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;padding:8px 4px;border-bottom:1px solid rgba(255,255,255,0.04)';
            if (r.pinned) {
                row.style.background = 'rgba(25,230,245,0.06)';
                row.style.borderBottom = '1px solid rgba(25,230,245,0.25)';
                row.style.marginBottom = '4px';
            }

            const rank = Number(r.rank) || i + 1;
            const medal = rank === 1 ? '\uD83E\uDD47' : rank === 2 ? '\uD83E\uDD48' : rank === 3 ? '\uD83E\uDD49' : rank;
            const isMe = r.id === RANKING_ID;

            row.innerHTML = `
              <span style="width:30px;text-align:center;font-size:${rank <= 3 ? '18px' : '14px'};color:${rank <= 3 ? '#ffd700' : '#666'}">${medal}</span>
              <span style="flex:1;font-size:14px;color:${isMe ? '#19e6f5' : '#ddd'};font-weight:${isMe ? '600' : '400'}">${escHtml(String(r.name))}</span>
              <span style="font-size:14px;font-weight:600;color:${isMe ? '#19e6f5' : '#fff'}">${r.score}</span>
            `;
            list.appendChild(row);
        });
    } catch (e) {
        list.innerHTML = '<div style="text-align:center;color:#666;font-size:13px">Ошибка загрузки</div>';
    }
}

function getRankingRows(data) {
    const top = (data.top || []).map((row, index) => ({
        ...row,
        rank: Number(row.rank) || index + 1,
        pinned: false
    }));
    const current = data.current;
    if (!current || Number(current.rank) <= 4) return top;
    return [
        { ...current, rank: Number(current.rank), pinned: true },
        ...top.filter(row => row.id !== current.id)
    ];
}

function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function rankingClose() {
    if (RANKING_OVERLAY) {
        RANKING_OVERLAY.remove();
        RANKING_OVERLAY = null;
    }
}
