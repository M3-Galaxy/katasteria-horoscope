// =============================================================
// 画面の制御
//   条件の入力 → エンジンで検索 → 候補一覧と配置の確認パネルを描画
// =============================================================
(function (RH) {
  'use strict';

  const getChunkData = (id) => (window.RH_EPHEMERIS_CHUNKS && window.RH_EPHEMERIS_CHUNKS[id]) || window.RH_EPHEMERIS;
  let currentChunkId = RH.DEFAULT_CHUNK_ID;
  let DATA = getChunkData(currentChunkId);
  let engine = RH.createEngine(DATA);
  const PAGE = 100;
  const STORAGE_KEY = 'rh.state.v1';
  let RANGE = engine.range;

  // ---------- 状態 ----------
  const state = {
    chunkId: RH.DEFAULT_CHUNK_ID,
    conds: {},              // 天体ID → { sign: 0〜11 | null, mode: 'required' | 'preferred' }
    aspectConds: [],        // [{ id, body1, body2, aspectId, orbId, mode }]
    open: new Set(['Sun']), // 開いている天体
    sort: 'score',
    showZero: false,
    houseSystem: 'placidus', // 'placidus' | 'equal'
    locationId: RH.DEFAULT_LOCATION_ID,
    timezoneId: RH.DEFAULT_TIMEZONE_ID,
    limit: PAGE,
    result: null,           // { segments, preferred, conds, aspects, ms }
    view: [],               // 並び替え・絞り込み後の区間
    selected: null,         // 選択中の区間
    minute: null,           // 配置の確認パネルで表示している時刻
    counts: {},             // 天体ID → サイン別の残り期間数
    openSabian: new Set(),  // サビアン詳細を開いている天体IDまたはアングル名
  };
  RH.BODIES.forEach((b) => { state.conds[b.id] = { sign: null, mode: RH.MODE.REQUIRED }; });

  // ---------- 要素 ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    bodyList: $('body-list'),
    aspectSection: $('aspect-section'),
    btnAddAspect: $('btn-add-aspect'),
    aspectList: $('aspect-list'),
    btnAspectInfo: $('btn-aspect-info'),
    aspectInfoWrap: document.querySelector('.aspect-info-wrap'),
    summary: $('summary'),
    resultList: $('result-list'),
    listFooter: $('list-footer'),
    more: $('btn-more'),
    detail: $('detail'),
    toast: $('toast'),
    selectChunk: $('select-chunk'),
    selectLocation: $('select-location'),
    selectTz: $('select-tz'),
  };

  // ---------- 時刻の書式 ----------
  const pad = (n) => String(n).padStart(2, '0');
  const utcMsOf = (m) => DATA.epochUtcMs + m * 60000;

  function parts(m) {
    const d = new Date(DATA.epochUtcMs + (m + DATA.tzOffsetMinutes) * 60000);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
  }

  let START_YEAR = DATA.startYear ?? parts(0).y;
  let END_YEAR = DATA.endYear ?? parts(RANGE - 1).y;

  function fmtDateTime(m, withYear = true) {
    const p = parts(m);
    return `${withYear ? `${p.y}年` : ''}${p.mo}月${p.d}日 ${pad(p.h)}:${pad(p.mi)}`;
  }

  function fmtRange(s, e) {
    const sameYear = parts(s).y === parts(e).y;
    return `${fmtDateTime(s)}<span class="arrow">→</span>${fmtDateTime(e, !sameYear)}`;
  }

  function fmtDuration(min) {
    if (min >= 365.25 * 1440) return `約${(min / (365.25 * 1440)).toFixed(1)}年`;
    const d = Math.floor(min / 1440);
    const h = Math.floor((min % 1440) / 60);
    const mi = min % 60;
    if (d >= 30) return `${d}日`;
    if (d > 0) return `${d}日 ${h}時間`;
    if (h > 0) return `${h}時間 ${mi}分`;
    return `${mi}分`;
  }

  const fmtNum = (n) => n.toLocaleString('ja-JP');
  const fmtDeg = (p) => `${p.deg}°${pad(p.min)}′`;
  const fmtDegMin = (d) => (RH.export ? RH.export.fmtDegMin(d) : `${Math.floor(d)}°`);
  const signLabel = (i) => `<span class="glyph">${RH.SIGNS[i].glyph}</span>${RH.SIGNS[i].name}`;

  // ---------- チャンク（年代）切り替え ----------
  function switchChunk(chunkId) {
    if (chunkId === state.chunkId && currentChunkId === chunkId) return;
    const nextData = getChunkData(chunkId);
    if (!nextData) return;

    currentChunkId = chunkId;
    state.chunkId = chunkId;
    DATA = nextData;
    engine = RH.createEngine(DATA);
    RANGE = engine.range;
    START_YEAR = DATA.startYear ?? parts(0).y;
    END_YEAR = DATA.endYear ?? parts(RANGE - 1).y;

    state.selected = null;
    state.minute = null;
    save();
    update();
  }

  // ---------- 保存・復元（ブラウザ内のみ） ----------
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        chunkId: state.chunkId,
        conds: state.conds,
        aspectConds: state.aspectConds,
        sort: state.sort,
        houseSystem: state.houseSystem,
        locationId: state.locationId,
        timezoneId: state.timezoneId,
      }));
    } catch (_) { /* 保存できない環境では何もしない */ }
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved) return;
      if (saved.chunkId && RH.CHUNK_BY_ID && RH.CHUNK_BY_ID[saved.chunkId]) {
        state.chunkId = saved.chunkId;
        currentChunkId = saved.chunkId;
        const nextData = getChunkData(currentChunkId);
        if (nextData) {
          DATA = nextData;
          engine = RH.createEngine(DATA);
          RANGE = engine.range;
          START_YEAR = DATA.startYear ?? parts(0).y;
          END_YEAR = DATA.endYear ?? parts(RANGE - 1).y;
        }
      }
      for (const b of RH.BODIES) {
        const c = saved.conds && saved.conds[b.id];
        if (c && (c.sign === null || (c.sign >= 0 && c.sign < 12))) {
          state.conds[b.id] = { sign: c.sign, mode: c.mode === RH.MODE.PREFERRED ? RH.MODE.PREFERRED : RH.MODE.REQUIRED };
        }
      }
      if (Array.isArray(saved.aspectConds)) {
        state.aspectConds = saved.aspectConds.filter((a) =>
          (!a.body1 || RH.BODY_BY_ID[a.body1]) &&
          (!a.body2 || RH.BODY_BY_ID[a.body2]) &&
          RH.ASPECT_BY_ID[a.aspectId] && RH.ORB_BY_ID[a.orbId]
        );
      }
      if (saved.sort === 'time') state.sort = 'time';
      if (saved.houseSystem === 'equal' || saved.houseSystem === 'placidus') {
        state.houseSystem = saved.houseSystem;
      }
      if (saved.locationId && RH.LOCATION_BY_ID[saved.locationId]) {
        state.locationId = saved.locationId;
      }
      if (saved.timezoneId && RH.TIMEZONE_BY_ID[saved.timezoneId]) {
        state.timezoneId = saved.timezoneId;
      }
      RH.LOCATION = RH.LOCATION_BY_ID[state.locationId] || RH.LOCATIONS[0];
    } catch (_) { /* 壊れたデータは無視 */ }
  }

  // ---------- 条件パネル ----------
  function buildBodyList() {
    el.bodyList.innerHTML = RH.BODIES.map((b) => `
      <li class="body-row" id="row-${b.id}" data-body="${b.id}">
        <div class="body-head">
          <button class="body-toggle" id="toggle-${b.id}" type="button" aria-expanded="false" aria-controls="panel-${b.id}">
            <span class="glyph">${b.glyph}</span>
            <span class="body-name">${b.name}</span>
            <span class="body-value" id="value-${b.id}">指定なし</span>
            <span class="chev" aria-hidden="true"></span>
          </button>
          <div class="seg mode-seg" role="group" aria-label="${b.name}の条件の種類">
            <button type="button" id="mode-${b.id}-required" data-mode="required">必須</button>
            <button type="button" id="mode-${b.id}-preferred" data-mode="preferred">できれば</button>
          </div>
        </div>
        <div class="body-panel" id="panel-${b.id}">
          <div class="body-panel-inner">
            <div class="body-panel-content">
              <div class="sign-grid">
                ${RH.SIGNS.map((s, i) => `
                  <button type="button" class="sign-chip" id="chip-${b.id}-${i}" data-sign="${i}" aria-pressed="false">
                    <span class="sign-chip-top"><span class="glyph">${s.glyph}</span><span class="sign-name">${s.short}</span></span>
                    <span class="sign-count" id="count-${b.id}-${i}">–</span>
                  </button>`).join('')}
              </div>
              ${b.note ? `<p class="body-note">${b.note}</p>` : ''}
            </div>
          </div>
        </div>
      </li>`).join('');

    // クリックはまとめて受け取る（イベント委譲）
    el.bodyList.addEventListener('click', (ev) => {
      const row = ev.target.closest('.body-row');
      if (!row) return;
      const body = row.dataset.body;
      const cond = state.conds[body];

      if (ev.target.closest('.body-toggle')) {
        if (state.open.has(body)) state.open.delete(body);
        else state.open.add(body);
        renderBodyRows();
        return;
      }
      const modeBtn = ev.target.closest('[data-mode]');
      if (modeBtn) {
        cond.mode = modeBtn.dataset.mode;
        update();
        return;
      }
      const chip = ev.target.closest('.sign-chip');
      if (chip && !chip.disabled) {
        const sign = Number(chip.dataset.sign);
        cond.sign = cond.sign === sign ? null : sign;
        update();
      }
    });
  }

  function renderBodyRows() {
    for (const b of RH.BODIES) {
      const cond = state.conds[b.id];
      const counts = state.counts[b.id] || [];
      const hasSign = cond.sign !== null;
      const conflict = hasSign && counts[cond.sign] === 0;
      const open = state.open.has(b.id);

      const row = $(`row-${b.id}`);
      row.classList.toggle('is-open', open);
      row.classList.toggle('has-sign', hasSign);
      row.classList.toggle('is-conflict', conflict);
      row.classList.toggle('mode-required', cond.mode === RH.MODE.REQUIRED);
      row.classList.toggle('mode-preferred', cond.mode === RH.MODE.PREFERRED);
      $(`toggle-${b.id}`).setAttribute('aria-expanded', String(open));

      $(`value-${b.id}`).innerHTML = hasSign
        ? `${signLabel(cond.sign)}${conflict ? '<span>· ほかの必須条件と同時に成立しません</span>' : ''}`
        : '指定なし';

      $(`mode-${b.id}-required`).setAttribute('aria-pressed', String(cond.mode === RH.MODE.REQUIRED));
      $(`mode-${b.id}-preferred`).setAttribute('aria-pressed', String(cond.mode === RH.MODE.PREFERRED));

      for (let i = 0; i < 12; i++) {
        const chip = $(`chip-${b.id}-${i}`);
        const n = counts[i] ?? 0;
        const selected = cond.sign === i;
        chip.disabled = n === 0 && !selected;
        chip.classList.toggle('is-selected', selected);
        chip.classList.toggle('is-conflict', selected && n === 0);
        chip.classList.toggle('mode-required', cond.mode === RH.MODE.REQUIRED);
        chip.classList.toggle('mode-preferred', cond.mode === RH.MODE.PREFERRED);
        chip.setAttribute('aria-pressed', String(selected));
        chip.title = n === 0 ? 'ほかの必須条件と同時には成立しません' : `${fmtNum(n)} 期間`;
        $(`count-${b.id}-${i}`).textContent = n === 0 ? '—' : fmtNum(n);
      }
    }
  }

  // ---------- 検索 ----------
  function activeConds() {
    return RH.BODIES
      .filter((b) => state.conds[b.id].sign !== null)
      .map((b) => ({ body: b.id, sign: state.conds[b.id].sign, mode: state.conds[b.id].mode }));
  }

  function activeAspectConds() {
    return state.aspectConds
      .filter((a) => a.body1 && a.body2 && a.body1 !== a.body2)
      .map((a) => {
        const asp = RH.ASPECT_BY_ID[a.aspectId] || RH.ASPECTS[0];
        const orb = RH.ORB_BY_ID[a.orbId] || RH.ORBS[1];
        return {
          id: a.id,
          body1: a.body1,
          body2: a.body2,
          aspectId: a.aspectId,
          targetAngle: asp.angle,
          orb: orb.value,
          mode: a.mode,
        };
      });
  }

  let nextAspectId = 1;

  function addAspectCond() {
    const id = 'asp-' + Date.now() + '-' + (nextAspectId++);
    state.aspectConds.push({
      id,
      body1: '',
      body2: '',
      aspectId: 'trine',
      orbId: 'normal',
      mode: RH.MODE.REQUIRED,
    });
    renderAspectSection();
    update();
  }

  function removeAspectCond(id) {
    state.aspectConds = state.aspectConds.filter((a) => a.id !== id);
    renderAspectSection();
    update();
  }

  function renderAspectSection() {
    el.aspectList.innerHTML = state.aspectConds.map((a) => {
      const isComplete = a.body1 && a.body2 && a.body1 !== a.body2;
      const isSame = a.body1 && a.body2 && a.body1 === a.body2;

      let guideMsg = '';
      if (!a.body1 || !a.body2) {
        guideMsg = '<span class="aspect-card-status" style="font-size:11px;color:var(--text-3)">天体を2つ選択してください</span>';
      } else if (isSame) {
        guideMsg = '<span class="aspect-card-status" style="font-size:11px;color:var(--warn)">異なる天体を選択してください</span>';
      }

      return `
        <li class="aspect-card mode-${a.mode} ${!isComplete ? 'is-incomplete' : ''}" id="card-${a.id}" data-id="${a.id}">
          <div class="aspect-card-top">
            <div class="aspect-pair">
              <select class="aspect-select body1-select" aria-label="天体1">
                <option value="" ${!a.body1 ? 'selected' : ''} disabled>天体を選択</option>
                ${RH.BODIES.map((b) => `<option value="${b.id}" ${b.id === a.body1 ? 'selected' : ''}>${b.name}</option>`).join('')}
              </select>
              <span style="color:var(--text-3)">と</span>
              <select class="aspect-select body2-select" aria-label="天体2">
                <option value="" ${!a.body2 ? 'selected' : ''} disabled>天体を選択</option>
                ${RH.BODIES.map((b) => `<option value="${b.id}" ${b.id === a.body2 ? 'selected' : ''}>${b.name}</option>`).join('')}
              </select>
            </div>
            <button type="button" class="aspect-del-btn" title="条件を削除" aria-label="条件を削除">✕</button>
          </div>
          <div class="aspect-card-bottom">
            <div class="aspect-options">
              <select class="aspect-select aspect-type-select" aria-label="アスペクト" ${!isComplete ? 'style="opacity:0.7"' : ''}>
                ${RH.ASPECTS.map((asp) => `<option value="${asp.id}" ${asp.id === a.aspectId ? 'selected' : ''}>${asp.glyph} ${asp.label}</option>`).join('')}
              </select>
              <select class="aspect-select orb-select" aria-label="オーブ" ${!isComplete ? 'style="opacity:0.7"' : ''}>
                ${RH.ORBS.map((o) => `<option value="${o.id}" ${o.id === a.orbId ? 'selected' : ''}>${o.name}</option>`).join('')}
              </select>
            </div>
            <div class="seg mode-seg" role="group" aria-label="アスペクト条件の種類">
              <button type="button" data-mode="required" aria-pressed="${a.mode === RH.MODE.REQUIRED}">必須</button>
              <button type="button" data-mode="preferred" aria-pressed="${a.mode === RH.MODE.PREFERRED}">できれば</button>
            </div>
          </div>
          ${guideMsg ? `<div style="margin-top:2px">${guideMsg}</div>` : ''}
        </li>`;
    }).join('');
  }

  function update() {
    const t0 = performance.now();
    const conds = activeConds();
    const aspects = activeAspectConds();

    for (const b of RH.BODIES) state.counts[b.id] = engine.signCounts(conds, b.id);
    const res = engine.search(conds, aspects);
    state.result = { ...res, conds, aspects, ms: performance.now() - t0 };
    state.limit = PAGE;

    computeView();
    // 選択中の時刻を含む区間があれば、選択を引き継ぐ
    if (state.minute !== null) {
      state.selected = state.view.find((s) => s.s <= state.minute && state.minute < s.e) || null;
      if (!state.selected) state.minute = null;
    }

    renderBodyRows();
    renderAspectSection();
    renderSummary();
    renderResults();
    renderDetail();
    save();
  }

  function computeView() {
    const { segments, preferred } = state.result;
    let v = segments;
    if (preferred.length && !state.showZero) v = v.filter((s) => s.matched > 0);
    if (state.sort === 'score' && preferred.length) v = v.slice().sort((a, b) => b.matched - a.matched || a.s - b.s);
    state.view = v;
  }

  // ---------- 候補一覧 ----------
  function renderSummary() {
    const { segments, preferred, conds, aspects, ms } = state.result;
    const totalConds = conds.length + aspects.length;
    if (totalConds === 0) {
      el.summary.innerHTML = '<span class="summary-sub">条件を指定すると、ここに候補の数が表示されます。</span>';
      return;
    }
    const full = preferred.length ? segments.filter((s) => s.matched === preferred.length).length : segments.length;
    const hidden = segments.length - state.view.length;
    el.summary.innerHTML = `
      <span class="summary-count">${fmtNum(state.view.length)}<small>期間</small></span>
      ${preferred.length ? `<span class="summary-sub">全条件一致 <strong>${fmtNum(full)}</strong> 期間</span>` : ''}
      <span class="summary-sub">計算 ${ms.toFixed(1)} ms</span>
      ${preferred.length ? `
        <span class="summary-tools">
          <label class="check" for="chk-zero">
            <input type="checkbox" id="chk-zero" ${state.showZero ? 'checked' : ''}>
            一致度 0% も表示${!state.showZero && hidden ? `（${fmtNum(hidden)}）` : ''}
          </label>
        </span>` : ''}`;
    const chk = $('chk-zero');
    if (chk) chk.addEventListener('change', () => {
      state.showZero = chk.checked;
      state.limit = PAGE;
      computeView();
      renderSummary();
      renderResults();
    });
  }

  const EMPTY_MARK = `
    <svg class="empty-mark" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true">
      <circle cx="32" cy="32" r="30"/><circle cx="32" cy="32" r="20"/>
      <path d="M32 2v10M32 52v10M2 32h10M52 32h10"/>
    </svg>`;

  function renderResults() {
    const { preferred, conds, aspects } = state.result;
    const totalConds = conds.length + aspects.length;

    if (totalConds === 0) {
      el.resultList.innerHTML = `<li class="empty" style="border:0;animation:none">${EMPTY_MARK}
        <h3>星の配置から、日時を探しましょう</h3>
        <p>左の一覧から天体を選び、サインを指定してください。動きの遅い冥王星や海王星から決めると、年代が一気に絞り込まれます。</p></li>`;
      el.listFooter.hidden = true;
      return;
    }
    if (state.view.length === 0) {
      el.resultList.innerHTML = `<li class="empty" style="border:0;animation:none">${EMPTY_MARK}
        <h3>条件に合う期間はありません</h3>
        <p>いくつかの条件を「できれば」に切り替えると、近い配置を一致度順に探せます。</p></li>`;
      el.listFooter.hidden = true;
      return;
    }

    const items = state.view.slice(0, state.limit).map((seg, i) => {
      let score;
      if (preferred.length) {
        const pct = Math.round((seg.matched / preferred.length) * 100);
        score = `<div class="score ${pct === 100 ? 'is-full' : ''}">
            <span class="score-num">${pct}<small>%</small></span>
            <span class="score-bar"><i style="width:${pct}%"></i></span></div>`;
      } else {
        score = '<div class="score is-full"><span class="score-label">条件一致</span><span class="score-bar"><i style="width:100%"></i></span></div>';
      }
      const tags = preferred.map((c, k) => {
        const met = seg.mask & (1 << k);
        if (c.body1) {
          const b1 = RH.BODY_BY_ID[c.body1];
          const b2 = RH.BODY_BY_ID[c.body2];
          const asp = RH.ASPECT_BY_ID[c.aspectId] || RH.ASPECTS[0];
          return `<span class="cond-tag ${met ? 'is-met' : 'is-miss'}" title="${b1.name} ${asp.label} ${b2.name}"><span class="glyph">${b1.glyph}${asp.glyph}${b2.glyph}</span></span>`;
        }
        return `<span class="cond-tag ${met ? 'is-met' : 'is-miss'}"><span class="glyph">${RH.BODY_BY_ID[c.body].glyph}</span>${RH.SIGNS[c.sign].short}</span>`;
      }).join('');
      const edges = [
        seg.s === 0 ? `<span class="edge-flag">${START_YEAR}年以前から継続</span>` : '',
        seg.e === RANGE ? `<span class="edge-flag">${END_YEAR}年以降も継続</span>` : '',
      ].join('');
      const current = state.selected === seg;
      return `<li style="animation-delay:${Math.min(i, 12) * 18}ms">
        <button type="button" class="result" id="result-${i}" data-index="${i}" aria-current="${current}">
          ${score}
          <div>
            <div class="result-date">${fmtRange(seg.s, seg.e)}</div>
            <div class="result-meta"><span>${fmtDuration(seg.e - seg.s)}</span>${tags ? `<span class="cond-tags">${tags}</span>` : ''}${edges}</div>
          </div>
        </button></li>`;
    });
    el.resultList.innerHTML = items.join('');
    el.listFooter.hidden = state.view.length <= state.limit;
    el.more.textContent = `さらに表示（残り ${fmtNum(state.view.length - state.limit)}）`;
  }

  // ---------- 配置の確認パネル ----------
  /** 区間の端は、イングレス時刻の丸め誤差（±1分未満）を避けるため1分内側にする */
  function sliderRange(seg) {
    if (seg.e - seg.s > 2) return [seg.s + 1, seg.e - 1];
    return [seg.s, Math.max(seg.s, seg.e - 1)];
  }

  function selectSegment(seg) {
    state.selected = seg;
    const [lo, hi] = sliderRange(seg);
    state.minute = Math.round((lo + hi) / 2);
    renderResults();
    renderDetail();
  }

  const MAJOR_ASPECT_DEFS = RH.ASPECTS;

  function buildAspectGridHtml() {
    const bodies = RH.BODIES;
    let html = '';
    for (let i = 0; i < bodies.length; i++) {
      const b1 = bodies[i];
      html += '<tr>';
      for (let j = 0; j <= i; j++) {
        const b2 = bodies[j];
        if (i === j) {
          html += `<th class="asp-cell-diag" title="${b1.name}"><span class="glyph">${b1.glyph}</span></th>`;
        } else {
          html += `<td class="asp-cell" id="asp-cell-${b2.id}-${b1.id}" data-b1="${b2.id}" data-b2="${b1.id}"></td>`;
        }
      }
      html += '</tr>';
    }
    return html;
  }

  function updateAspectGrid(pos) {
    const M = RH.astroMath;
    const posById = Object.fromEntries(pos.map((p) => [p.id, p]));
    const bodies = RH.BODIES;

    for (let i = 0; i < bodies.length; i++) {
      for (let j = 0; j < i; j++) {
        const b1 = bodies[j]; // 列（前）
        const b2 = bodies[i]; // 行（後）
        const cell = $(`asp-cell-${b1.id}-${b2.id}`);
        if (!cell) continue;

        const p1 = posById[b1.id];
        const p2 = posById[b2.id];
        if (!p1 || !p2) continue;

        const isLight = b1.id === 'Sun' || b1.id === 'Moon' || b2.id === 'Sun' || b2.id === 'Moon';
        const maxOrb = isLight ? (RH.GRID_ORB?.LIGHTS ?? 8.0) : (RH.GRID_ORB?.OTHERS ?? 6.0);
        const diff = M.aspectDiff(p1.lon, p2.lon, 0);

        let match = null;
        for (const asp of MAJOR_ASPECT_DEFS) {
          const orb = Math.abs(diff - asp.deg);
          if (orb <= maxOrb) {
            match = { asp, orb };
            break;
          }
        }

        if (match) {
          const { asp, orb } = match;
          cell.textContent = asp.symbol;
          cell.className = `asp-cell is-hit is-${asp.kind}`;
          cell.dataset.info = `${b1.name} ${asp.symbol} ${b2.name}（${asp.label} ${asp.deg}° / 誤差 ${fmtDegMin(orb)}）`;
          cell.setAttribute('title', cell.dataset.info);
        } else {
          cell.textContent = '';
          cell.className = 'asp-cell';
          cell.removeAttribute('data-info');
          cell.removeAttribute('title');
        }
      }
    }
  }

  function bindAspectGridEvents() {
    const table = $('aspect-grid-table');
    const info = $('aspect-grid-info');
    if (!table || !info) return;

    table.addEventListener('mouseover', (e) => {
      const cell = e.target.closest('.asp-cell.is-hit');
      if (cell && cell.dataset.info) {
        info.textContent = cell.dataset.info;
        info.classList.add('is-active');
      }
    });

    table.addEventListener('mouseout', (e) => {
      const cell = e.target.closest('.asp-cell');
      if (cell) {
        info.textContent = 'セルに触れると詳細が表示されます';
        info.classList.remove('is-active');
      }
    });

    table.addEventListener('click', (e) => {
      const cell = e.target.closest('.asp-cell.is-hit');
      if (cell && cell.dataset.info) {
        info.textContent = cell.dataset.info;
        info.classList.add('is-active');
      }
    });
  }

  function renderDetail() {
    const seg = state.selected;
    if (!seg) {
      el.detail.innerHTML = `<div class="detail-sticky">
        <div class="panel-head"><h2 id="detail-title">配置の確認</h2></div>
        <div class="empty" style="padding:40px 4px">${EMPTY_MARK}
          <p>候補を選ぶと、その期間のホロスコープ円図や天体の度数、東京でのハウス配置を確認できます。</p></div></div>`;
      return;
    }
    const [lo, hi] = sliderRange(seg);
    el.detail.innerHTML = `<div class="detail-sticky">
      <div class="panel-head">
        <h2 id="detail-title">配置の確認</h2>
        <div class="seg house-seg" role="group" aria-label="ハウス分割方式">
          <button type="button" id="house-placidus" data-system="placidus" aria-pressed="${state.houseSystem === 'placidus'}">プラシーダス</button>
          <button type="button" id="house-equal" data-system="equal" aria-pressed="${state.houseSystem === 'equal'}">イコール</button>
        </div>
      </div>

      <div class="detail-time">
        <div class="time-big" id="detail-time"></div>
        <div class="time-sub">日本標準時 · 期間の長さ ${fmtDuration(seg.e - seg.s)}</div>
        <div class="range">
          <input type="range" id="detail-slider" min="${lo}" max="${hi}" step="1" value="${state.minute}" aria-label="期間内の時刻">
          <div class="range-labels"><span>${fmtDateTime(seg.s)}</span><span>${fmtDateTime(seg.e)}</span></div>
        </div>
      </div>

      <!-- ホロスコープ円図（プレビュー） -->
      <div class="chart-wrapper">
        <div class="chart-frame" id="chart-frame"></div>
      </div>

      <div class="angles" id="angles"></div>
      <table class="pos-table"><tbody id="pos-body"></tbody></table>

      <!-- アスペクト表（グリッド） -->
      <div class="aspect-grid-section">
        <div class="aspect-grid-head">
          <span class="aspect-grid-title">アスペクト表</span>
          <div class="aspect-grid-legend">
            <span class="asp-leg-soft">△⚹ 調和</span>
            <span class="asp-leg-hard">□☍ 緊張</span>
            <span class="asp-leg-conj">☌ 合</span>
          </div>
        </div>
        <div class="aspect-grid-wrapper">
          <table class="aspect-grid-table" id="aspect-grid-table">${buildAspectGridHtml()}</table>
        </div>
        <div class="aspect-grid-info" id="aspect-grid-info">セルに触れると詳細が表示されます</div>
      </div>

      <div class="detail-actions">
        <button type="button" class="btn-ghost btn-open-sheet" id="btn-open-sheet" style="color:var(--pref);border-color:var(--pref-line);background:var(--pref-soft);">鑑定シートを作成</button>
        <button type="button" class="btn-ghost btn-copy-prompt" id="btn-copy-prompt">AI解釈用コピー</button>
        <button type="button" class="btn-ghost" id="btn-copy">配置をコピー</button>
        <button type="button" class="btn-ghost" id="btn-mid">期間の中央へ</button>
      </div>
      <p class="detail-note" id="detail-note">ASC・MC・ハウスは${RH.LOCATION.name}（北緯 ${RH.LOCATION.lat.toFixed(2)}° / 東経 ${RH.LOCATION.lon.toFixed(2)}°）での参考値です。</p>
    </div>`;

    const slider = $('detail-slider');
    let raf = 0;
    slider.addEventListener('input', () => {
      state.minute = Number(slider.value);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(renderPositions);
    });
    $('btn-mid').addEventListener('click', () => {
      state.minute = Math.round((lo + hi) / 2);
      slider.value = state.minute;
      renderPositions();
    });

    for (const sys of ['placidus', 'equal']) {
      $(`house-${sys}`).addEventListener('click', () => {
        state.houseSystem = sys;
        $('house-placidus').setAttribute('aria-pressed', String(sys === 'placidus'));
        $('house-equal').setAttribute('aria-pressed', String(sys === 'equal'));
        renderPositions();
        save();
      });
    }

    $('btn-open-sheet').addEventListener('click', () => {
      if (window.RH_SHEET) {
        window.RH_SHEET.openSheet({
          minute: state.minute,
          utc: utcMsOf(state.minute),
          data: DATA,
          seg: state.selected,
          houseSystem: state.houseSystem,
          location: RH.LOCATION
        });
      }
    });

    $('btn-copy-prompt').addEventListener('click', copyPrompt);
    $('btn-copy').addEventListener('click', copyPositions);

    bindAspectGridEvents();

    // 度数表の行クリックでサビアン開閉
    $('pos-body').addEventListener('click', (ev) => {
      const row = ev.target.closest('.pos-row');
      if (!row) return;
      const id = row.dataset.body;
      if (state.openSabian.has(id)) state.openSabian.delete(id);
      else state.openSabian.add(id);
      renderPositions();
    });

    // アングルクリックでサビアン開閉
    $('angles').addEventListener('click', (ev) => {
      const card = ev.target.closest('.angle');
      if (!card) return;
      const label = card.dataset.angle;
      if (state.openSabian.has(label)) state.openSabian.delete(label);
      else state.openSabian.add(label);
      renderPositions();
    });

    // 円図の天体クリックでサビアンを開いてスクロール
    const chartFrame = $('chart-frame');
    if (chartFrame) {
      chartFrame.addEventListener('click', (ev) => {
        const planetG = ev.target.closest('.chart-planet');
        if (!planetG) return;
        const id = planetG.dataset.body;
        state.openSabian.add(id);
        renderPositions();
        const targetRow = $(`pos-row-${id}`);
        if (targetRow) {
          targetRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          targetRow.classList.add('is-flash');
          setTimeout(() => targetRow.classList.remove('is-flash'), 800);
        }
      });
    }

    renderPositions();
  }

  function renderPositions() {
    const m = state.minute;
    const utc = utcMsOf(m);
    $('detail-time').textContent = fmtDateTime(m);

    const pos = RH.astro.positions(utc);
    const h = RH.astro.houses(utc, RH.LOCATION, state.houseSystem);

    // 1. チャート描画
    const chartFrame = $('chart-frame');
    if (chartFrame) {
      chartFrame.innerHTML = RH.chart.renderSvg({
        positions: pos,
        houses: h,
        size: 330,
      });
    }

    // 2. 天体テーブル描画
    $('pos-body').innerHTML = pos.map((p) => {
      const b = RH.BODY_BY_ID[p.id];
      const c = state.conds[p.id];
      const sab = RH.astro.sabian ? RH.astro.sabian(p.lon) : null;
      const isOpen = state.openSabian.has(p.id);
      let cls = '';
      if (c.sign !== null) {
        if (p.sign !== c.sign) cls = 'is-miss';
        else cls = c.mode === RH.MODE.REQUIRED ? 'is-req-met' : 'is-pref-met';
      }
      return `<tr class="pos-row ${cls} ${isOpen ? 'is-open' : ''}" id="pos-row-${p.id}" data-body="${p.id}" tabindex="0" role="button" aria-expanded="${isOpen}">
        <td><span class="glyph">${b.glyph}</span></td>
        <td class="pos-name">${b.name}</td>
        <td><span class="pos-sign">${signLabel(p.sign)}</span></td>
        <td class="pos-deg">${fmtDeg(p)}</td>
        <td class="pos-retro">${p.retro ? '<span class="glyph" title="逆行">℞</span>' : ''}</td>
        <td class="pos-mark"><span class="sabian-badge ${isOpen ? 'is-active' : ''}" title="サビアンシンボル">✦</span></td>
      </tr>
      <tr class="sabian-row" id="sabian-row-${p.id}" ${isOpen ? '' : 'hidden'}>
        <td colspan="6">
          <div class="sabian-card">
            <span class="sabian-tag">サビアンシンボル ${sab ? sab.label : ''}</span>
            <div class="sabian-title">「${sab ? sab.title : ''}」</div>
          </div>
        </td>
      </tr>`;
    }).join('');

    // 3. ASC / MC / ハウス軸表示
    $('angles').innerHTML = [
      ['ASC', h.asc],
      ['MC', h.mc],
    ].map(([label, p]) => {
      const sab = RH.astro.sabian ? RH.astro.sabian(p.lon) : null;
      const isOpen = state.openSabian.has(label);
      return `<div class="angle ${isOpen ? 'is-open' : ''}" data-angle="${label}" tabindex="0" role="button" aria-expanded="${isOpen}">
        <div class="angle-header">
          <div class="angle-label">${label}</div>
          <div class="angle-value">${signLabel(p.sign)}<span style="color:var(--text-2);margin-left:auto">${fmtDeg(p)}</span></div>
          <span class="sabian-badge ${isOpen ? 'is-active' : ''}" style="margin-left:4px" title="サビアンシンボル">✦</span>
        </div>
        <div class="angle-sabian" ${isOpen ? '' : 'hidden'}>
          <div class="sabian-card angle-sabian-card">
            <span class="sabian-tag">${label} サビアン ${sab ? sab.label : ''}</span>
            <div class="sabian-title">「${sab ? sab.title : ''}」</div>
          </div>
        </div>
      </div>`;
    }).join('');

    // 4. 注記更新
    const note = $('detail-note');
    if (note) {
      note.textContent = `ASC・MC・ハウスは${RH.LOCATION.name}（北緯 ${RH.LOCATION.lat.toFixed(2)}° / 東経 ${RH.LOCATION.lon.toFixed(2)}°）での参考値です。`;
    }

    // 5. アスペクト表更新
    updateAspectGrid(pos);
  }

  // ---------- コピー ----------
  async function copyPrompt() {
    const m = state.minute;
    const text = RH.export.buildPromptText({
      dateTimeStr: fmtDateTime(m),
      utcMs: utcMsOf(m),
      location: RH.LOCATION,
      houseSystem: state.houseSystem,
    });
    await RH.export.copyToClipboard(text);
    showToast('AI解釈用プロンプトをコピーしました');
  }

  async function copyPositions() {
    const m = state.minute;
    const text = RH.export.buildPositionsText({
      dateTimeStr: fmtDateTime(m),
      utcMs: utcMsOf(m),
      location: RH.LOCATION,
      houseSystem: state.houseSystem,
    });
    await RH.export.copyToClipboard(text);
    showToast('配置をクリップボードにコピーしました');
  }

  let toastTimer = 0;
  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('is-shown'), 1800);
  }

  // ---------- その他のイベント ----------
  function bindGlobalEvents() {
    el.resultList.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.result');
      if (!btn) return;
      selectSegment(state.view[Number(btn.dataset.index)]);
    });

    el.more.addEventListener('click', () => {
      state.limit += PAGE;
      renderResults();
    });

    for (const id of ['sort-score', 'sort-time']) {
      $(id).addEventListener('click', (ev) => {
        state.sort = ev.currentTarget.dataset.sort;
        $('sort-score').setAttribute('aria-pressed', String(state.sort === 'score'));
        $('sort-time').setAttribute('aria-pressed', String(state.sort === 'time'));
        state.limit = PAGE;
        computeView();
        renderResults();
        save();
      });
    }

    // アスペクト追加ボタン
    el.btnAddAspect.addEventListener('click', addAspectCond);

    // 説明ポップオーバーの操作（タップ・ESC対応 / 条件・アスペクト共通）
    const allInfoWraps = document.querySelectorAll('.info-wrap, .aspect-info-wrap');
    allInfoWraps.forEach((wrap) => {
      const btn = wrap.querySelector('.info-btn, .aspect-info-btn');
      if (!btn) return;

      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        // 他の開いているポップオーバーがあれば閉じる
        allInfoWraps.forEach((other) => {
          if (other !== wrap && other.classList.contains('is-open')) {
            other.classList.remove('is-open');
            const otherBtn = other.querySelector('.info-btn, .aspect-info-btn');
            if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
          }
        });

        const isOpen = wrap.classList.toggle('is-open');
        btn.setAttribute('aria-expanded', String(isOpen));
      });
    });

    document.addEventListener('click', (ev) => {
      allInfoWraps.forEach((wrap) => {
        if (wrap.classList.contains('is-open') && !wrap.contains(ev.target)) {
          wrap.classList.remove('is-open');
          const btn = wrap.querySelector('.info-btn, .aspect-info-btn');
          if (btn) btn.setAttribute('aria-expanded', 'false');
        }
      });
    });

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        allInfoWraps.forEach((wrap) => {
          if (wrap.classList.contains('is-open')) {
            wrap.classList.remove('is-open');
            const btn = wrap.querySelector('.info-btn, .aspect-info-btn');
            if (btn) {
              btn.setAttribute('aria-expanded', 'false');
              btn.focus();
            }
          }
        });
      }
    });

    // アスペクトカードの変更（セレクトボックス）
    el.aspectList.addEventListener('change', (ev) => {
      const card = ev.target.closest('.aspect-card');
      if (!card) return;
      const id = card.dataset.id;
      const a = state.aspectConds.find((x) => x.id === id);
      if (!a) return;

      if (ev.target.classList.contains('body1-select')) a.body1 = ev.target.value;
      if (ev.target.classList.contains('body2-select')) a.body2 = ev.target.value;
      if (ev.target.classList.contains('aspect-type-select')) a.aspectId = ev.target.value;
      if (ev.target.classList.contains('orb-select')) a.orbId = ev.target.value;

      renderAspectSection();
      update();
    });

    // アスペクトカードのクリック（削除・モード切替）
    el.aspectList.addEventListener('click', (ev) => {
      const card = ev.target.closest('.aspect-card');
      if (!card) return;
      const id = card.dataset.id;

      if (ev.target.closest('.aspect-del-btn')) {
        removeAspectCond(id);
        return;
      }
      const modeBtn = ev.target.closest('[data-mode]');
      if (modeBtn) {
        const a = state.aspectConds.find((x) => x.id === id);
        if (a) {
          a.mode = modeBtn.dataset.mode;
          renderAspectSection();
          update();
        }
      }
    });

    $('btn-clear-all').addEventListener('click', () => {
      RH.BODIES.forEach((b) => { state.conds[b.id] = { sign: null, mode: RH.MODE.REQUIRED }; });
      state.aspectConds = [];
      state.selected = null;
      state.minute = null;
      update();
    });
  }

  // ---------- 起動 ----------
  function setupMetaControls() {
    if (el.selectChunk) {
      el.selectChunk.innerHTML = RH.CHUNKS.map((c) =>
        `<option value="${c.id}">${c.label}</option>`
      ).join('');
      el.selectChunk.value = state.chunkId;
      el.selectChunk.addEventListener('change', () => {
        switchChunk(el.selectChunk.value);
      });
    }

    if (el.selectLocation) {
      el.selectLocation.innerHTML = RH.LOCATIONS.map((loc) =>
        `<option value="${loc.id}">${loc.name} (${loc.region})</option>`
      ).join('');
      el.selectLocation.value = state.locationId;
      el.selectLocation.addEventListener('change', () => {
        state.locationId = el.selectLocation.value;
        RH.LOCATION = RH.LOCATION_BY_ID[state.locationId] || RH.LOCATIONS[0];
        save();
        if (state.minute !== null) {
          renderPositions();
        }
      });
    }

    if (el.selectTz) {
      el.selectTz.innerHTML = RH.TIMEZONES.map((tz) =>
        `<option value="${tz.id}">${tz.name}</option>`
      ).join('');
      el.selectTz.value = state.timezoneId;
      el.selectTz.addEventListener('change', () => {
        state.timezoneId = el.selectTz.value;
        save();
      });
    }
  }

  function init() {
    restore();
    setupMetaControls();
    buildBodyList();
    bindGlobalEvents();
    $('sort-score').setAttribute('aria-pressed', String(state.sort === 'score'));
    $('sort-time').setAttribute('aria-pressed', String(state.sort === 'time'));
    const metaRange = $('meta-range');
    if (metaRange) metaRange.textContent = `${START_YEAR} – ${END_YEAR}`;
    update();
    $('loading').classList.add('is-done');
  }

  init();
})(window.RH);
