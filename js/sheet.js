// =============================================================
// Katasteria — 鑑定シート生成・モーダル制御モジュール
// =============================================================
(function (RH) {
  'use strict';

  const M = RH.astroMath;
  let sheetState = {
    minute: null,
    seg: null,
    houseSystem: 'placidus',
    location: null,
    theme: 'parchment', // 'parchment' | 'hesperus'
    title: '',
    catch: '',
    tagScene: '風景',
    tagDynamic: '結び目',
    tagVow: '深層',
    scene: '',
    dynamic: '',
    vow: '',
  };

  // デフォルト例文
  const DEFAULTS = {
    title: '夕暮れの対話 - Herma:Hesperus -',
    catch: '言葉の光が地平線に沈み、秘密の聖域に火が灯る刻',
    tagScene: '風景',
    tagDynamic: '結び目',
    tagVow: '深層',
    scene: '黄昏の茜色が薄紺の夜へと溶けゆく窓辺。静まり返った部屋の中で、言葉の余白と沈黙が静かに交差する情景。',
    dynamic: '知性と衝動、言葉と体温の対峙。言葉を重ねるほどに距離が縮まり、同時に触れてはならない不可侵の領域を確かめ合う引力。',
    vow: '制約と理性の境界線の中で紡がれる静かな誓い。決して形骸には囚われず、星の配置のように永遠に記憶へ刻まれる絆。',
  };

  const MAJOR_ASPECT_DEFS = RH.ASPECTS;

  const $ = (id) => document.getElementById(id);

  function fmtDateTime(utcMs) {
    const date = new Date(utcMs);
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  }

  /**
   * モーダルを開いて鑑定シートを構築
   */
  function openSheet(opts) {
    sheetState.minute = opts.minute;
    sheetState.utc = opts.utc ?? ((opts.data?.epochUtcMs ?? window.RH_EPHEMERIS?.epochUtcMs ?? 0) + opts.minute * 60000);
    sheetState.seg = opts.seg;
    sheetState.houseSystem = opts.houseSystem || 'placidus';
    sheetState.location = opts.location || RH.LOCATION;

    const modal = $('sheet-modal');
    if (!modal) return;

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');

    // フォーム初期値の設定
    $('input-sheet-title').value = sheetState.title;
    $('input-sheet-catch').value = sheetState.catch;
    $('input-sheet-tag-scene').value = sheetState.tagScene;
    $('input-sheet-tag-dynamic').value = sheetState.tagDynamic;
    $('input-sheet-tag-vow').value = sheetState.tagVow;
    $('input-sheet-scene').value = sheetState.scene;
    $('input-sheet-dynamic').value = sheetState.dynamic;
    $('input-sheet-vow').value = sheetState.vow;

    renderSheet();
  }

  function closeSheet() {
    const modal = $('sheet-modal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }

  /**
   * シート全体の再描画
   */
  function renderSheet() {
    const utc = sheetState.utc;
    const loc = sheetState.location;
    const hSys = sheetState.houseSystem;

    // 天体位置とハウス計算
    const pos = RH.astro.positions(utc);
    const h = RH.astro.houses(utc, loc, hSys);
    const posById = Object.fromEntries(pos.map((p) => [p.id, p]));

    // 1. ヘッダー情報
    const titleVal = sheetState.title.trim() || DEFAULTS.title;
    const catchVal = sheetState.catch.trim() || DEFAULTS.catch;
    $('card-display-title').textContent = titleVal;
    $('card-display-catch').textContent = catchVal;

    const latStr = `${Math.abs(loc.lat).toFixed(2)}°${loc.lat >= 0 ? 'N' : 'S'}`;
    const lonStr = `${Math.abs(loc.lon).toFixed(2)}°${loc.lon >= 0 ? 'E' : 'W'}`;
    $('card-display-meta').textContent = `${fmtDateTime(utc)} JST · ${loc.name} (${latStr}, ${lonStr})`;

    // 2. ホロスコープ円図
    const chartFrame = $('card-chart-frame');
    if (chartFrame && RH.chart) {
      chartFrame.innerHTML = RH.chart.renderSvg({
        positions: pos,
        houses: h,
        size: 270,
      });
    }

    // ASC / MC
    $('card-chart-angles').innerHTML = `
      <span>ASC: ${RH.SIGNS[h.asc.sign].name} ${h.asc.deg}°${h.asc.min}'</span>
      <span>MC: ${RH.SIGNS[h.mc.sign].name} ${h.mc.deg}°${h.mc.min}'</span>
    `;

    // 3. コア・シグネチャー（ASC, Sun, Moon）
    renderSignatures(posById, h);

    // 4. アスペクトグリッド
    renderAspectGrid(posById);

    // 5. 解釈ノート
    $('card-tag-scene').textContent = sheetState.tagScene.trim() || DEFAULTS.tagScene;
    $('card-tag-dynamic').textContent = sheetState.tagDynamic.trim() || DEFAULTS.tagDynamic;
    $('card-tag-vow').textContent = sheetState.tagVow.trim() || DEFAULTS.tagVow;
    $('card-text-scene').textContent = sheetState.scene.trim() || DEFAULTS.scene;
    $('card-text-dynamic').textContent = sheetState.dynamic.trim() || DEFAULTS.dynamic;
    $('card-text-vow').textContent = sheetState.vow.trim() || DEFAULTS.vow;

    // 6. テーマの適用
    applyTheme(sheetState.theme);
  }

  /**
   * コア・シグネチャーの描画（ASC, Sun, Moon + 特筆アスペクト）
   */
  function renderSignatures(posById, houses) {
    const wrap = $('card-signatures');
    if (!wrap) return;

    const sun = posById['Sun'];
    const moon = posById['Moon'];
    const asc = houses.asc;

    const ascSab = RH.astro.sabian ? RH.astro.sabian(asc.lon) : null;
    const sunSab = sun && RH.astro.sabian ? RH.astro.sabian(sun.lon) : null;
    const moonSab = moon && RH.astro.sabian ? RH.astro.sabian(moon.lon) : null;

    const sunH = sun && RH.astro.whichHouse ? RH.astro.whichHouse(sun.lon, houses.cusps) : '-';
    const moonH = moon && RH.astro.whichHouse ? RH.astro.whichHouse(moon.lon, houses.cusps) : '-';

    wrap.innerHTML = `
      <div class="card-sig-item">
        <span class="card-sig-role">ASC / 世界への窓</span>
        <span class="card-sig-body"><span class="glyph">⚑</span> ${RH.SIGNS[asc.sign].name} ${asc.deg}°</span>
        <span class="card-sig-sabian" title="${ascSab ? ascSab.title : ''}">${ascSab ? `「${ascSab.title}」` : ''}</span>
      </div>
      <div class="card-sig-item">
        <span class="card-sig-role">Sun / 意思・核</span>
        <span class="card-sig-body"><span class="glyph">☉</span> ${RH.SIGNS[sun.sign].name} ${sun.deg}° (第${sunH}室)</span>
        <span class="card-sig-sabian" title="${sunSab ? sunSab.title : ''}">${sunSab ? `「${sunSab.title}」` : ''}</span>
      </div>
      <div class="card-sig-item">
        <span class="card-sig-role">Moon / 心・体温</span>
        <span class="card-sig-body"><span class="glyph">☽</span> ${RH.SIGNS[moon.sign].name} ${moon.deg}° (第${moonH}室)</span>
        <span class="card-sig-sabian" title="${moonSab ? moonSab.title : ''}">${moonSab ? `「${moonSab.title}」` : ''}</span>
      </div>
    `;
  }

  /**
   * アスペクトグリッドの生成と点灯
   */
  function renderAspectGrid(posById) {
    const table = $('card-asp-table');
    if (!table) return;

    const bodies = RH.BODIES;
    let html = '';

    for (let i = 0; i < bodies.length; i++) {
      const b1 = bodies[i];
      html += '<tr>';
      for (let j = 0; j <= i; j++) {
        const b2 = bodies[j];
        if (i === j) {
          html += `<th class="asp-cell-diag"><span class="glyph">${b1.glyph}</span></th>`;
        } else {
          const p1 = posById[b2.id];
          const p2 = posById[b1.id];
          let sym = '';
          let cls = 'asp-cell';

          if (p1 && p2) {
            const isLight = b1.id === 'Sun' || b1.id === 'Moon' || b2.id === 'Sun' || b2.id === 'Moon';
            const maxOrb = isLight ? (RH.GRID_ORB?.LIGHTS ?? 8.0) : (RH.GRID_ORB?.OTHERS ?? 6.0);
            const diff = M.aspectDiff(p1.lon, p2.lon, 0);

            for (const asp of MAJOR_ASPECT_DEFS) {
              const orb = Math.abs(diff - asp.deg);
              if (orb <= maxOrb) {
                sym = asp.symbol;
                cls += ` is-hit is-${asp.kind}`;
                break;
              }
            }
          }
          html += `<td class="${cls}">${sym}</td>`;
        }
      }
      html += '</tr>';
    }
    table.innerHTML = html;
  }

  /**
   * テーマの切り替え
   */
  function applyTheme(theme) {
    sheetState.theme = theme;
    const card = $('sheet-card');
    const btnParchment = $('theme-btn-parchment');
    const btnHesperus = $('theme-btn-hesperus');

    if (card) {
      card.className = `sheet-card theme-${theme}`;
    }
    if (btnParchment && btnHesperus) {
      btnParchment.classList.toggle('active', theme === 'parchment');
      btnHesperus.classList.toggle('active', theme === 'hesperus');
    }
  }

  /**
   * イベントハンドラの初期化
   */
  function init() {
    // 閉じる操作
    $('btn-sheet-close')?.addEventListener('click', closeSheet);
    $('sheet-backdrop')?.addEventListener('click', closeSheet);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSheet();
    });

    // テーマ切り替え
    $('theme-btn-parchment')?.addEventListener('click', () => applyTheme('parchment'));
    $('theme-btn-hesperus')?.addEventListener('click', () => applyTheme('hesperus'));

    // 入力監視（リアルタイムプレビュー）
    const bindInput = (id, stateKey, displayId, defaultVal) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('input', () => {
        sheetState[stateKey] = el.value;
        const disp = $(displayId);
        if (disp) {
          disp.textContent = el.value.trim() || defaultVal;
        }
      });
    };

    bindInput('input-sheet-title', 'title', 'card-display-title', DEFAULTS.title);
    bindInput('input-sheet-catch', 'catch', 'card-display-catch', DEFAULTS.catch);
    bindInput('input-sheet-tag-scene', 'tagScene', 'card-tag-scene', DEFAULTS.tagScene);
    bindInput('input-sheet-tag-dynamic', 'tagDynamic', 'card-tag-dynamic', DEFAULTS.tagDynamic);
    bindInput('input-sheet-tag-vow', 'tagVow', 'card-tag-vow', DEFAULTS.tagVow);
    bindInput('input-sheet-scene', 'scene', 'card-text-scene', DEFAULTS.scene);
    bindInput('input-sheet-dynamic', 'dynamic', 'card-text-dynamic', DEFAULTS.dynamic);
    bindInput('input-sheet-vow', 'vow', 'card-text-vow', DEFAULTS.vow);

    // テキストコピー
    $('btn-sheet-copy')?.addEventListener('click', () => {
      const title = sheetState.title.trim() || DEFAULTS.title;
      const catchText = sheetState.catch.trim() || DEFAULTS.catch;
      const tagScene = sheetState.tagScene.trim() || DEFAULTS.tagScene;
      const tagDynamic = sheetState.tagDynamic.trim() || DEFAULTS.tagDynamic;
      const tagVow = sheetState.tagVow.trim() || DEFAULTS.tagVow;
      const scene = sheetState.scene.trim() || DEFAULTS.scene;
      const dynamic = sheetState.dynamic.trim() || DEFAULTS.dynamic;
      const vow = sheetState.vow.trim() || DEFAULTS.vow;
      const meta = $('card-display-meta')?.textContent || '';

      const text = [
        `【${title}】`,
        `〜 ${catchText} 〜`,
        meta,
        '',
        `◆ 【${tagScene}】`,
        scene,
        '',
        `◆ 【${tagDynamic}】`,
        dynamic,
        '',
        `◆ 【${tagVow}】`,
        vow,
        '',
        `Generated by Katasteria Ephemeris Engine`,
      ].join('\n');

      navigator.clipboard.writeText(text).then(() => {
        const toast = $('toast');
        if (toast) {
          toast.textContent = '鑑定シートのテキストをコピーしました';
          toast.classList.add('is-show');
          setTimeout(() => toast.classList.remove('is-show'), 2000);
        }
      });
    });

    // 画像エクスポート（高解像度PNG保存）
    $('btn-sheet-export')?.addEventListener('click', async () => {
      const card = $('sheet-card');
      const toast = $('toast');
      const btn = $('btn-sheet-export');
      if (!card) return;

      if (!window.html2canvas) {
        if (toast) {
          toast.textContent = '画像保存ライブラリを準備中です…';
          toast.classList.add('is-show');
          setTimeout(() => toast.classList.remove('is-show'), 2500);
        }
        return;
      }

      const origText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '画像を生成中…';

      if (toast) {
        toast.textContent = '✦ 高解像度PNG画像をレンダリングしています…';
        toast.classList.add('is-show');
      }

      try {
        // 1. Webフォントのロード完了を確実に待機
        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }

        // 2. html2canvas でカード要素をキャプチャ（Retina対応 2倍解像度）
        const canvas = await window.html2canvas(card, {
          scale: 2, // 2倍スケールでクッキリ出力
          useCORS: true,
          allowTaint: true,
          backgroundColor: null, // 透明背景（カード自身の背景・枠線を尊重）
          logging: false,
        });

        // 3. ダウンロード用リンクの作成と発火
        const title = (sheetState.title || DEFAULTS.title).trim().replace(/[\\/:*?"<>|]/g, '_');
        const themeName = sheetState.theme === 'hesperus' ? 'Hesperus' : 'Parchment';
        const fileName = `Katasteria_${themeName}_${title}.png`;

        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = fileName;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        if (toast) {
          toast.textContent = `✦ 「${fileName}」を保存しました`;
          setTimeout(() => toast.classList.remove('is-show'), 2500);
        }
      } catch (err) {
        console.error('画像保存エラー:', err);
        if (toast) {
          toast.textContent = '画像保存中にエラーが発生しました';
          setTimeout(() => toast.classList.remove('is-show'), 3000);
        }
      } finally {
        btn.disabled = false;
        btn.textContent = origText;
      }
    });
  }

  // DOM構築後に初期化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  RH.sheet = { openSheet, closeSheet };
  window.RH_SHEET = RH.sheet;
})(window.RH);
