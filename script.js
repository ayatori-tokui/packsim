(() => {
  'use strict';
  const KEY = 'tcg-box-sim-v1';
  const uid = () => Math.random().toString(36).slice(2, 10);
  const defaults = () => ({
    box: { price: 5400, flea: '', count: 1 },
    cost: { fee: 10, ship: 210 },
    rarities: [newRarity('SR枠')],
  });
  function newRarity(name = '') {
    return { id: uid(), name, perBox: 1, total: 10, others: 0, open: true, cards: [] };
  }
  const newCard = () => ({ id: uid(), name: '', price: '' });

  let state = load();

  const $ = (s) => document.querySelector(s);
  const yen = (n) => (n < 0 ? '-' : '') + '¥' + Math.round(Math.abs(n)).toLocaleString('ja-JP');
  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- 保存 / 読込 ----------
  function sanitize(d) {
    const base = defaults();
    if (!d || typeof d !== 'object') return base;
    const out = {
      box: { ...base.box, ...(d.box || {}) },
      cost: { ...base.cost, ...(d.cost || {}) },
      rarities: Array.isArray(d.rarities) ? d.rarities.map((r) => ({
        id: r.id || uid(), name: r.name ?? '', perBox: r.perBox ?? 1, total: r.total ?? 1,
        others: r.others ?? 0, open: r.open !== false,
        cards: Array.isArray(r.cards) ? r.cards.map((c) => ({ id: c.id || uid(), name: c.name ?? '', price: c.price ?? '' })) : [],
      })) : base.rarities,
    };
    return out;
  }
  function load() {
    try { const raw = localStorage.getItem(KEY); return raw ? sanitize(JSON.parse(raw)) : defaults(); }
    catch { return defaults(); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } }

  // ---------- 計算 ----------
  function calc() {
    const price = num(state.box.price);
    const fee = num(state.cost.fee);
    const ship = num(state.cost.ship);
    const boxes = Math.max(1, Math.floor(num(state.box.count)) || 1);
    const hasFlea = String(state.box.flea).trim() !== '';
    const net = (p) => Math.max(0, num(p) * (1 - fee / 100) - ship); // 手順A
    const unopenedProfit = hasFlea ? (num(state.box.flea) - ship) * (1 - fee / 100) - price : null;

    let ev = 0;
    const probs = [];
    const rows = state.rarities.map((r) => {
      const total = Math.max(0, Math.floor(num(r.total)));
      const per = Math.max(0, num(r.perBox));
      let rev = 0;
      if (total > 0) {
        const cardSum = r.cards.reduce((s, c) => s + net(c.price), 0);
        const otherCnt = Math.max(0, total - r.cards.length);
        rev = (cardSum + net(r.others) * otherCnt) / total * per; // 手順B
        const miss = Math.max(0, (total - per) / total);
        const p = (1 - Math.pow(miss, boxes)) * 100;
        r.cards.forEach((c) => probs.push({ rarity: r.name, name: c.name, p }));
      }
      ev += rev;
      return { name: r.name, rev };
    });
    const openProfit = ev - price;
    return { price, boxes, unopenedProfit, ev, openProfit, rows, probs };
  }

  function judge(c) {
    const U = c.unopenedProfit;
    if (U !== null && U > 0 && U >= c.openProfit)
      return { label: '📦 未開封推奨', cls: 'bg-emerald-500 text-white', note: '未開封で売る方が利益が大きい' };
    if (c.openProfit > 0)
      return { label: '🎉 開封推奨（アド箱）', cls: 'bg-amber-500 text-white', note: '開封してシングル売却する方が有利' };
    return { label: '🛒 シングル買い推奨', cls: 'bg-sky-500 text-white', note: '箱買いは期待値割れ。欲しいカードはシングルで購入' };
  }

  // ---------- 描画 ----------
  const inp = 'rounded-lg border border-slate-300 px-3 py-2 text-base w-full';
  const numAttr = 'type="number" pattern="\\d*" inputmode="numeric" min="0"';

  function cardHtml(r, c) {
    return `<div class="flex items-end gap-2 ml-4 pl-3 py-2 pr-1 bg-indigo-50 border-l-4 border-indigo-300 rounded-r-lg" data-card="${c.id}">
      <label class="flex-1 min-w-0 text-xs">カード名
        <input data-f="card.name" type="text" value="${esc(c.name)}" placeholder="例: リザードンSAR" class="${inp} mt-1"></label>
      <label class="w-28 shrink-0 text-xs">相場（円）
        <input data-f="card.price" ${numAttr} value="${esc(c.price)}" class="${inp} mt-1"></label>
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
          <label class="block text-xs">全種類数
            <input data-f="total" ${numAttr} value="${esc(r.total)}" class="${inp} mt-1"></label>
        </div>
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-indigo-700">特定の当たりカード</span>
            <button data-act="addCard" class="text-sm bg-indigo-500 text-white rounded-lg px-3 py-2 active:bg-indigo-600">＋カード追加</button>
          </div>
          <div class="cards space-y-2">${r.cards.map((c) => cardHtml(r, c)).join('')}</div>
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
    const c = calc();
    const j = judge(c);
    const v = $('#verdict');
    v.className = 'font-bold text-base rounded-lg px-3 py-1 ' + j.cls;
    v.textContent = j.label;
    const col = (n) => (n >= 0 ? 'text-emerald-600' : 'text-red-600');
    const probHtml = c.probs.length
      ? c.probs.map((p) => `<div class="flex justify-between"><span class="truncate">${esc(p.name) || '（名称未設定）'}<span class="text-xs text-slate-400"> ${esc(p.rarity)}</span></span><b>${p.p.toFixed(1)}%</b></div>`).join('')
      : '<div class="text-xs text-slate-400">当たりカード未登録</div>';
    $('#resBody').innerHTML = `
      <div class="text-xs text-slate-500">${j.note}</div>
      <div class="flex justify-between"><span>未開封販売の実利益</span><b class="${c.unopenedProfit === null ? 'text-slate-400' : col(c.unopenedProfit)}">${c.unopenedProfit === null ? '相場未入力' : yen(c.unopenedProfit)}</b></div>
      <div class="flex justify-between"><span>1箱あたり開封期待値（手残り）</span><b>${yen(c.ev)}</b></div>
      <div class="flex justify-between"><span>開封期待損益（購入価格 ${yen(c.price)}）</span><b class="${col(c.openProfit)}">${yen(c.openProfit)}</b></div>
      <div class="flex justify-between"><span>${c.boxes}箱開封の期待損益</span><b class="${col(c.openProfit)}">${yen(c.openProfit * c.boxes)}</b></div>
      <div class="border-t pt-1 mt-1 text-xs font-semibold text-slate-600">${c.boxes}箱開封で1枚以上引ける確率</div>
      ${probHtml}`;
    // 枠ヘッダーの期待値表示
    c.rows.forEach((row, i) => {
      const el = document.querySelector(`[data-rarity="${state.rarities[i].id}"] .rsum`);
      if (el) el.textContent = '期待値 ' + yen(row.rev);
    });
  }

  // ---------- イベント ----------
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
      if (c) c[t.dataset.f.slice(5)] = t.value;
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

  // タブ
  function showTab(t) {
    $('#view-sim').classList.toggle('hidden', t !== 'sim');
    $('#view-set').classList.toggle('hidden', t !== 'set');
    $('#result').classList.toggle('hidden', t !== 'sim');
    document.querySelectorAll('.tab-btn').forEach((b) => {
      const on = b.dataset.tab === t;
      b.classList.toggle('border-white', on);
      b.classList.toggle('border-transparent', !on);
      b.classList.toggle('opacity-70', !on);
    });
  }
  document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // 結果パネル開閉
  $('#resToggle').addEventListener('click', () => $('#resBody').classList.toggle('hidden'));

  // 設定画面
  const msg = (t, ok = true) => { const m = $('#msg'); m.textContent = t; m.className = 'text-sm ' + (ok ? 'text-emerald-600' : 'text-red-600'); };

  $('#btnReset').addEventListener('click', () => {
    if (!confirm('入力内容をすべて初期化します。よろしいですか？')) return;
    state = defaults(); renderAll(); msg('初期化しました');
  });

  $('#btnExport').addEventListener('click', () => {
    const data = { app: 'tcg-box-sim', version: 1, exportedAt: new Date().toISOString(), ...state };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tcg-sim-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    msg('バックアップを保存しました');
  });

  $('#fileImport').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (!d || typeof d !== 'object' || !d.box || !d.cost || !Array.isArray(d.rarities)) throw new Error('形式が不正です');
        state = sanitize(d); renderAll(); msg('復元しました。シミュレーション画面に反映されています');
      } catch (err) { msg('復元に失敗しました: ' + err.message, false); }
      e.target.value = '';
    };
    reader.onerror = () => msg('ファイルを読み込めませんでした', false);
    reader.readAsText(f);
  });

  showTab('sim');
  renderAll();
})();

