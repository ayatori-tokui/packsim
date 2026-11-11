(() => {
  'use strict';
  const KEY = 'tcg-box-sim-v2';
  const KEY_V1 = 'tcg-box-sim-v1';
  const uid = () => Math.random().toString(36).slice(2, 10);
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  const newRarity = (name = '') => ({ id: uid(), name, perBox: 1, total: 10, others: 0, open: true, cards: [] });
  const newCard = () => ({ id: uid(), name: '', price: '', mode: 'uniform', every: '' });
  const defaults = () => ({
    meta: { name: '', date: todayStr(), memo: '' },
    box: { price: 5400, flea: '', count: 1 },
    cost: { fee: 10, ship: 210 },
    rarities: [newRarity('SR枠')],
  });

  let state;
  let history = [];
  loadAll();

  const $ = (s) => document.querySelector(s);
  const yen = (n) => (n < 0 ? '-' : '') + '¥' + Math.round(Math.abs(n)).toLocaleString('ja-JP');
  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const pct = (p) => (p >= 99.95 ? '100' : p.toFixed(1)) + '%';

  // ---------- 保存 / 読込 ----------
  function sanitize(d) {
    const base = defaults();
    if (!d || typeof d !== 'object') return base;
    return {
      meta: { ...base.meta, ...(d.meta || {}) },
      box: { ...base.box, ...(d.box || {}) },
      cost: { ...base.cost, ...(d.cost || {}) },
      rarities: Array.isArray(d.rarities) ? d.rarities.map((r) => ({
        id: r.id || uid(), name: r.name ?? '', perBox: r.perBox ?? 1, total: r.total ?? 1,
        others: r.others ?? 0, open: r.open !== false,
        cards: Array.isArray(r.cards) ? r.cards.map((c) => ({
          id: c.id || uid(), name: c.name ?? '', price: c.price ?? '',
          mode: c.mode === 'rate' ? 'rate' : 'uniform', every: c.every ?? '',
        })) : [],
      })) : base.rarities,
    };
  }
  function sanitizeSnap(s) {
    if (!s || typeof s !== 'object' || !s.input || !s.result) return null;
    const input = sanitize(s.input);
    delete input.meta;
    return {
      id: s.id || uid(), savedAt: s.savedAt || new Date().toISOString(),
      date: s.date || todayStr(), name: s.name || '(名称未設定)', memo: s.memo || '',
      input, result: s.result,
    };
  }
  function loadAll() {
    state = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        state = sanitize(d.current);
        history = (d.history || []).map(sanitizeSnap).filter(Boolean);
      } else if (localStorage.getItem(KEY_V1)) { // 旧バージョンからの移行
        state = sanitize(JSON.parse(localStorage.getItem(KEY_V1)));
      }
    } catch { /* 破損時は初期値 */ }
    state.meta.date = todayStr();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ current: state, history })); } catch { /* ignore */ }
  }

  // ---------- 計算 ----------
  // 確率指定カードの1箱あたり出現確率 q = 1 / (何箱に1枚)
  const rateQ = (c) => { const x = num(c.every); return x > 0 ? Math.min(1, 1 / x) : 0; };

  function calc(s) {
    const price = num(s.box.price);
    const fee = num(s.cost.fee);
    const ship = num(s.cost.ship);
    const boxes = Math.max(1, Math.floor(num(s.box.count)) || 1);
    const hasFlea = String(s.box.flea).trim() !== '';
    const net = (p) => Math.max(0, num(p) * (1 - fee / 100) - ship); // 手順A
    const unopenedProfit = hasFlea ? (num(s.box.flea) - ship) * (1 - fee / 100) - price : null;

    let ev = 0;
    const probs = [];
    const rows = s.rarities.map((r) => {
      const N = Math.max(0, Math.floor(num(r.total)));
      const k = Math.max(0, num(r.perBox));
      const fixed = r.cards.filter((c) => c.mode === 'rate');
      const uni = r.cards.filter((c) => c.mode !== 'rate');
      // 確率指定カードの出現数合計が封入枚数を超える場合は按分
      const sumQ = fixed.reduce((a, c) => a + rateQ(c), 0);
      const scale = sumQ > k && sumQ > 0 ? k / sumQ : 1;
      const kEff = Math.max(0, k - sumQ * scale); // 通常排出に回る枚数
      let rev = 0;
      fixed.forEach((c) => {
        const q = rateQ(c) * scale;
        rev += q * net(c.price);
        probs.push({ rarity: r.name, name: c.name, p: (1 - Math.pow(1 - q, boxes)) * 100, rate: true });
      });
      if (N > 0) {
        const cardSum = uni.reduce((a, c) => a + net(c.price), 0);
        const otherCnt = Math.max(0, N - uni.length);
        rev += (cardSum + net(r.others) * otherCnt) / N * kEff; // 手順B
        const miss = Math.max(0, (N - kEff) / N);
        uni.forEach((c) => probs.push({ rarity: r.name, name: c.name, p: (1 - Math.pow(miss, boxes)) * 100, rate: false }));
      }
      ev += rev;
      return { name: r.name, rev };
    });
    return { price, boxes, unopenedProfit, ev, openProfit: ev - price, rows, probs };
  }

  function judge(c) {
    const U = c.unopenedProfit;
    if (U !== null && U > 0 && U >= c.openProfit)
      return { label: '📦 未開封推奨', cls: 'bg-emerald-500 text-white', note: '未開封で売る方が利益が大きい' };
    if (c.openProfit > 0)
      return { label: '🎉 開封推奨（アド箱）', cls: 'bg-amber-500 text-white', note: '開封してシングル売却する方が有利' };
    return { label: '🛒 シングル買い推奨', cls: 'bg-sky-500 text-white', note: '箱買いは期待値割れ。欲しいカードはシングルで購入' };
  }

  // ---------- シミュレーション画面 描画 ----------
  const inp = 'rounded-lg border border-slate-300 px-3 py-2 text-base w-full';
  const numAttr = 'type="number" pattern="\\d*" inputmode="numeric" min="0"';

  function cardHtml(c) {
    const rate = c.mode === 'rate';
    return `<div class="flex items-start gap-2 ml-4 pl-3 py-2 pr-1 ${rate ? 'bg-amber-50 border-amber-300' : 'bg-indigo-50 border-indigo-300'} border-l-4 rounded-r-lg" data-card="${c.id}">
      <div class="flex-1 min-w-0 space-y-2">
        <label class="block text-xs">カード名
          <input data-f="card.name" type="text" value="${esc(c.name)}" placeholder="例: リザードンSAR" class="${inp} mt-1"></label>
        <div class="grid grid-cols-2 gap-2">
          <label class="block text-xs">相場（円）
            <input data-f="card.price" ${numAttr} value="${esc(c.price)}" class="${inp} mt-1"></label>
          <label class="block text-xs">出現方式
            <select data-f="card.mode" class="${inp} mt-1 bg-white">
              <option value="uniform" ${rate ? '' : 'selected'}>通常（均等）</option>
              <option value="rate" ${rate ? 'selected' : ''}>確率指定（ハイレア）</option>
            </select></label>
        </div>
        ${rate ? `<label class="block text-xs">何箱に1枚の割合で出現（例: 4〜5箱に1枚なら 4.5）
          <input data-f="card.every" type="number" step="any" inputmode="decimal" min="0" value="${esc(c.every)}" placeholder="例: 4.5" class="${inp} mt-1"></label>` : ''}
      </div>
      <button data-act="delCard" aria-label="カード削除" class="shrink-0 ml-2 mr-1 w-11 h-11 rounded-lg bg-red-100 text-red-600 text-lg active:bg-red-200">🗑</button>
    </div>`;
  }
  function rarityHtml(r) {
    return `<div class="bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden ${r.open ? '' : 'collapsed'}" data-rarity="${r.id}">
      <div class="flex items-center bg-indigo-100">
        <button data-act="toggle" class="flex-1 flex items-center gap-2 px-4 py-3 text-left min-w-0">
          <span class="chev text-indigo-600">▼</span>
          <span class="font-bold truncate rname">${esc(r.name) || '（名称未設定）'}</span>
          <span class="text-xs text-slate-500 ml-auto shrink-0 rsum"></span>
        </button>
        <button data-act="delRarity" aria-label="枠を削除" class="shrink-0 mx-3 w-11 h-11 rounded-lg bg-red-100 text-red-600 text-lg active:bg-red-200">🗑</button>
      </div>
      <div class="body p-4 space-y-3">
        <label class="block text-xs">レアリティ名
          <input data-f="name" type="text" value="${esc(r.name)}" placeholder="例: SR枠, AR枠" class="${inp} mt-1"></label>
        <div class="grid grid-cols-2 gap-3">
          <label class="block text-xs">1箱あたり確定封入枚数
            <input data-f="perBox" ${numAttr} value="${esc(r.perBox)}" class="${inp} mt-1"></label>
          <label class="block text-xs">全種類数（通常排出）
            <input data-f="total" ${numAttr} value="${esc(r.total)}" class="${inp} mt-1"></label>
        </div>
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-indigo-700">特定の当たりカード</span>
            <button data-act="addCard" class="text-sm bg-indigo-500 text-white rounded-lg px-3 py-2 active:bg-indigo-600">＋カード追加</button>
          </div>
          <div class="cards space-y-2">${r.cards.map(cardHtml).join('')}</div>
        </div>
        <label class="block text-xs">その他のカード（ハズレ枠）の平均相場（円）
          <input data-f="others" ${numAttr} value="${esc(r.others)}" class="${inp} mt-1"></label>
      </div>
    </div>`;
  }

  function renderAll() {
    document.querySelectorAll('[data-bind]').forEach((el) => {
      const [g, k] = el.dataset.bind.split('.');
      el.value = state[g][k];
    });
    $('#rarities').innerHTML = state.rarities.length
      ? state.rarities.map(rarityHtml).join('')
      : '<p class="text-sm text-slate-500 text-center py-4">レアリティ枠がありません。「＋追加」から作成してください。</p>';
    update();
  }

  function update() {
    save();
    const c = calc(state);
    const j = judge(c);
    const v = $('#verdict');
    v.className = 'flex-1 min-w-0 truncate font-bold text-base rounded-lg px-3 py-1 ' + j.cls;
    v.textContent = j.label;
    $('#resBody').innerHTML = resultHtml(c, j);
    c.rows.forEach((row, i) => {
      const el = document.querySelector(`[data-rarity="${state.rarities[i].id}"] .rsum`);
      if (el) el.textContent = '期待値 ' + yen(row.rev);
    });
  }

  const col = (n) => (n >= 0 ? 'text-emerald-600' : 'text-red-600');
  function resultHtml(c, j) {
    const probHtml = c.probs.length
      ? c.probs.map((p) => `<div class="flex justify-between"><span class="truncate">${esc(p.name) || '（名称未設定）'}<span class="text-xs text-slate-400"> ${esc(p.rarity)}${p.rate ? ' ・確率指定' : ''}</span></span><b>${pct(p.p)}</b></div>`).join('')
      : '<div class="text-xs text-slate-400">当たりカード未登録</div>';
    return `
      <div class="text-xs text-slate-500">${j.note}</div>
      <div class="flex justify-between"><span>未開封販売の実利益</span><b class="${c.unopenedProfit === null ? 'text-slate-400' : col(c.unopenedProfit)}">${c.unopenedProfit === null ? '相場未入力' : yen(c.unopenedProfit)}</b></div>
      <div class="flex justify-between"><span>1箱あたり開封期待値（手残り）</span><b>${yen(c.ev)}</b></div>
      <div class="flex justify-between"><span>開封期待損益（購入価格 ${yen(c.price)}）</span><b class="${col(c.openProfit)}">${yen(c.openProfit)}</b></div>
      <div class="flex justify-between"><span>${c.boxes}箱開封の期待損益</span><b class="${col(c.openProfit)}">${yen(c.openProfit * c.boxes)}</b></div>
      <div class="border-t pt-1 mt-1 text-xs font-semibold text-slate-600">${c.boxes}箱開封で1枚以上引ける確率</div>
      ${probHtml}`;
  }

  // ---------- 履歴 ----------
  const ordered = () => [...history].sort((a, b) => (a.date + a.savedAt).localeCompare(b.date + b.savedAt));

  function snapshot(name) {
    const c = calc(state);
    const j = judge(c);
    const input = clone({ box: state.box, cost: state.cost, rarities: state.rarities });
    return {
      id: uid(), savedAt: new Date().toISOString(),
      date: state.meta.date || todayStr(), name, memo: state.meta.memo || '',
      input,
      result: {
        price: c.price, boxes: c.boxes, unopenedProfit: c.unopenedProfit, ev: c.ev, openProfit: c.openProfit,
        verdict: j.label, verdictCls: j.cls, note: j.note,
        probs: c.probs.map((p) => ({ rarity: p.rarity, name: p.name, p: p.p, rate: p.rate })),
      },
    };
  }
  function saveSnapshot() {
    let name = (state.meta.name || '').trim();
    if (!name) {
      name = (prompt('商品名（ボックス名）を入力してください') || '').trim();
      if (!name) return toast('商品名が未入力のため保存しませんでした');
      state.meta.name = name; renderAll();
    }
    history.push(snapshot(name));
    save(); renderHistory();
    toast(`保存しました: ${state.meta.date} ${name}`);
  }

  function renderHistory() {
    $('#histCount').textContent = history.length;
    const names = [...new Set(history.map((h) => h.name))].sort();
    $('#nameList').innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');
    const sel = $('#histFilter');
    const cur = sel.value || '';
    sel.innerHTML = `<option value="">すべて（${history.length}件）</option>` +
      names.map((n) => `<option value="${esc(n)}">${esc(n)}（${history.filter((h) => h.name === n).length}件）</option>`).join('');
    sel.value = names.includes(cur) ? cur : '';

    // 同一商品の1つ前の履歴（前回比用）
    const prev = {}; const last = {};
    ordered().forEach((h) => { prev[h.id] = last[h.name] || null; last[h.name] = h; });

    let list = ordered();
    if (sel.value) list = list.filter((h) => h.name === sel.value);
    if ($('#histSort').value === 'desc') list.reverse();

    $('#histList').innerHTML = list.length ? list.map((h) => historyItemHtml(h, prev[h.id])).join('')
      : '<p class="text-sm text-slate-500 text-center py-8">履歴はまだありません。<br>シミュレーション画面の「💾 保存」で追加できます。</p>';
  }

  function diffHtml(cur, old, label) {
    if (old == null || cur == null) return '';
    const d = cur - old;
    if (Math.round(d) === 0) return `<span class="text-xs text-slate-400">${label} ±0</span>`;
    return `<span class="text-xs ${d > 0 ? 'text-emerald-600' : 'text-red-600'}">${label} ${d > 0 ? '+' : '-'}${yen(Math.abs(d)).replace('-', '')}</span>`;
  }

  function historyItemHtml(h, p) {
    const r = h.result;
    const i = h.input;
    const detailRarities = i.rarities.map((ra) => `
      <div class="mt-2"><b>${esc(ra.name) || '（名称未設定）'}</b>
        <span class="text-slate-500">封入 ${esc(ra.perBox)}枚/箱・全${esc(ra.total)}種・その他平均 ${yen(num(ra.others))}</span>
        ${ra.cards.map((c) => `<div class="ml-3 text-slate-600">・${esc(c.name) || '（名称未設定）'}　${yen(num(c.price))}${c.mode === 'rate' ? `（${esc(c.every)}箱に1枚）` : ''}</div>`).join('')}
      </div>`).join('');
    const probs = r.probs.map((x) => `<div class="flex justify-between"><span class="truncate">${esc(x.name) || '（名称未設定）'}<span class="text-xs text-slate-400"> ${esc(x.rarity)}${x.rate ? ' ・確率指定' : ''}</span></span><b>${pct(x.p)}</b></div>`).join('') || '<div class="text-xs text-slate-400">当たりカード未登録</div>';
    return `<article class="bg-white rounded-xl shadow p-4 space-y-2" data-hist="${h.id}">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="text-xs text-slate-500">${esc(h.date)}</div>
          <div class="font-bold break-words">${esc(h.name)}</div>
        </div>
        <span class="shrink-0 text-xs font-bold rounded-lg px-2 py-1 ${esc(r.verdictCls || 'bg-slate-200')}">${esc(r.verdict)}</span>
      </div>
      ${h.memo ? `<div class="text-sm text-slate-600 bg-slate-50 rounded p-2 whitespace-pre-wrap break-words">${esc(h.memo)}</div>` : ''}
      <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <span class="text-slate-500">購入価格</span><b class="text-right">${yen(r.price)}</b>
        <span class="text-slate-500">開封期待値/箱</span><span class="text-right"><b>${yen(r.ev)}</b> ${diffHtml(r.ev, p && p.result.ev, '前回比')}</span>
        <span class="text-slate-500">開封期待損益/箱</span><b class="text-right ${col(r.openProfit)}">${yen(r.openProfit)}</b>
        <span class="text-slate-500">未開封の実利益</span><b class="text-right ${r.unopenedProfit == null ? 'text-slate-400' : col(r.unopenedProfit)}">${r.unopenedProfit == null ? '相場未入力' : yen(r.unopenedProfit)}</b>
      </div>
      <details class="text-sm">
        <summary class="cursor-pointer text-indigo-600 py-1">入力内容・確率の詳細</summary>
        <div class="mt-1 text-xs space-y-1">
          <div>手数料 ${esc(i.cost.fee)}% ／ 送料 ${yen(num(i.cost.ship))} ／ 未開封相場 ${String(i.box.flea).trim() === '' ? '未入力' : yen(num(i.box.flea))}</div>
          ${detailRarities}
          <div class="border-t mt-2 pt-1 font-semibold text-slate-600">${r.boxes}箱開封で1枚以上引ける確率</div>
          <div class="text-sm">${probs}</div>
        </div>
      </details>
      <div class="flex gap-2 pt-1">
        <button data-hact="load" class="flex-1 bg-indigo-600 text-white rounded-lg py-2 text-sm active:bg-indigo-700">この条件を読み込む</button>
        <button data-hact="del" aria-label="削除" class="shrink-0 w-12 rounded-lg bg-red-100 text-red-600 active:bg-red-200">🗑</button>
      </div>
    </article>`;
  }

  $('#histList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hact]');
    if (!b) return;
    const id = b.closest('[data-hist]').dataset.hist;
    const h = history.find((x) => x.id === id);
    if (!h) return;
    if (b.dataset.hact === 'del') {
      if (confirm(`${h.date}「${h.name}」の履歴を削除しますか？`)) { history = history.filter((x) => x.id !== id); save(); renderHistory(); }
    } else {
      if (!confirm('現在の入力内容を、この履歴の条件で置き換えます。よろしいですか？\n（必要なら先に保存してください）')) return;
      state = sanitize({ ...clone(h.input), meta: { name: h.name, date: todayStr(), memo: '' } });
      renderAll(); showTab('sim');
      toast('履歴の条件を読み込みました（日付は今日に設定）');
    }
  });
  $('#histFilter').addEventListener('change', renderHistory);
  $('#histSort').addEventListener('change', renderHistory);

  // ---------- 入力イベント ----------
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.bind) {
      const [g, k] = t.dataset.bind.split('.');
      state[g][k] = t.value;
      return update();
    }
    const rEl = t.closest('[data-rarity]');
    if (!rEl || !t.dataset.f) return;
    const r = state.rarities.find((x) => x.id === rEl.dataset.rarity);
    if (!r) return;
    if (t.dataset.f.startsWith('card.')) {
      const c = r.cards.find((x) => x.id === t.closest('[data-card]').dataset.card);
      if (!c) return;
      const key = t.dataset.f.slice(5);
      c[key] = t.value;
      if (key === 'mode') return renderAll(); // 入力欄の出し分け
    } else {
      r[t.dataset.f] = t.value;
      if (t.dataset.f === 'name') rEl.querySelector('.rname').textContent = t.value || '（名称未設定）';
    }
    update();
  });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const rEl = b.closest('[data-rarity]');
    const r = rEl && state.rarities.find((x) => x.id === rEl.dataset.rarity);
    switch (b.dataset.act) {
      case 'toggle': r.open = !r.open; rEl.classList.toggle('collapsed', !r.open); save(); break;
      case 'delRarity':
        if (confirm(`「${r.name || '名称未設定'}」を削除しますか？`)) { state.rarities = state.rarities.filter((x) => x !== r); renderAll(); }
        break;
      case 'addCard': r.cards.push(newCard()); renderAll(); break;
      case 'delCard': {
        const id = b.closest('[data-card]').dataset.card;
        r.cards = r.cards.filter((c) => c.id !== id); renderAll(); break;
      }
    }
  });

  $('#addRarity').addEventListener('click', () => { state.rarities.push(newRarity()); renderAll(); });
  $('#btnSnapshot').addEventListener('click', saveSnapshot);
  $('#btnQuickSave').addEventListener('click', saveSnapshot);
  $('#resToggle').addEventListener('click', () => $('#resBody').classList.toggle('hidden'));

  // ---------- タブ / トースト ----------
  function showTab(t) {
    ['sim', 'hist', 'set'].forEach((n) => $('#view-' + n).classList.toggle('hidden', n !== t));
    $('#result').classList.toggle('hidden', t !== 'sim');
    document.querySelectorAll('.tab-btn').forEach((b) => {
      const on = b.dataset.tab === t;
      b.classList.toggle('border-white', on);
      b.classList.toggle('border-transparent', !on);
      b.classList.toggle('opacity-70', !on);
    });
    if (t === 'hist') renderHistory();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  let toastTimer;
  function toast(t) {
    const el = $('#toast');
    el.textContent = t; el.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
  }

  // ---------- 設定画面 ----------
  const msg = (t, ok = true) => { const m = $('#msg'); m.textContent = t; m.className = 'text-sm ' + (ok ? 'text-emerald-600' : 'text-red-600'); };
  function download(text, filename, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  $('#btnReset').addEventListener('click', () => {
    if (!confirm('入力中の内容を初期化します（履歴は残ります）。よろしいですか？')) return;
    state = defaults(); renderAll(); msg('入力内容を初期化しました');
  });
  $('#btnClearHist').addEventListener('click', () => {
    if (!history.length) return msg('履歴はありません', false);
    if (!confirm(`履歴 ${history.length} 件をすべて削除します。元に戻せません。よろしいですか？`)) return;
    history = []; save(); renderHistory(); msg('履歴を削除しました');
  });

  $('#btnExport').addEventListener('click', () => {
    const data = { app: 'tcg-box-sim', version: 2, exportedAt: new Date().toISOString(), current: state, history };
    download(JSON.stringify(data, null, 2), `tcg-sim-backup-${todayStr()}.json`, 'application/json');
    msg(`バックアップを保存しました（履歴 ${history.length} 件）`);
  });

  $('#btnCsv').addEventListener('click', () => {
    if (!history.length) return msg('履歴がありません', false);
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['日付', '商品名', '購入価格', '箱数', '開封期待値/箱', '開封期待損益/箱', '未開封の実利益', '判定', 'メモ', '保存日時'];
    const rows = ordered().map((h) => [h.date, h.name, h.result.price, h.result.boxes, Math.round(h.result.ev), Math.round(h.result.openProfit),
      h.result.unopenedProfit == null ? '' : Math.round(h.result.unopenedProfit), h.result.verdict, h.memo, h.savedAt]);
    download('\ufeff' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n'), `tcg-sim-history-${todayStr()}.csv`, 'text/csv');
    msg('CSVを保存しました');
  });

  $('#fileImport').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const mode = document.querySelector('input[name=impMode]:checked').value;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (!d || typeof d !== 'object') throw new Error('形式が不正です');
        if (d.current || d.history) { // v2
          const incoming = (Array.isArray(d.history) ? d.history : []).map(sanitizeSnap).filter(Boolean);
          if (mode === 'overwrite') {
            if (!confirm('履歴と入力中の内容をすべて上書きします。よろしいですか？')) return;
            history = incoming;
            if (d.current) state = sanitize(d.current);
            state.meta.date = todayStr();
            msg(`上書き復元しました（履歴 ${history.length} 件）`);
          } else {
            const map = new Map(history.map((h) => [h.id, h]));
            let added = 0;
            incoming.forEach((h) => { if (!map.has(h.id)) added++; map.set(h.id, h); });
            history = [...map.values()];
            msg(`マージしました（履歴 ${added} 件追加、合計 ${history.length} 件）`);
          }
        } else if (d.box && d.cost && Array.isArray(d.rarities)) { // v1形式（入力内容のみ）
          if (!confirm('旧形式のバックアップです。入力中の内容を置き換えます。よろしいですか？')) return;
          state = sanitize(d); state.meta.date = todayStr();
          msg('旧形式のバックアップを入力内容に読み込みました（履歴は変更なし）');
        } else throw new Error('対応していないファイルです');
        renderAll(); renderHistory();
      } catch (err) { msg('復元に失敗しました: ' + err.message, false); }
      e.target.value = '';
    };
    reader.onerror = () => msg('ファイルを読み込めませんでした', false);
    reader.readAsText(f);
  });

  showTab('sim');
  renderAll();
  renderHistory();
})();
