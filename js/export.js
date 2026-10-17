// =============================================================
// Katasteria — テキスト出力・AIプロンプト生成モジュール
// =============================================================
(function (RH) {
  'use strict';

  const M = RH.astroMath;

  function fmtDegMin(degFloat) {
    let d = Math.floor(degFloat);
    let m = Math.round((degFloat - d) * 60);
    if (m === 60) { d += 1; m = 0; }
    return `${d}°${String(m).padStart(2, '0')}'`;
  }

  function fmtDeg(p) {
    return `${p.deg}°${String(p.min).padStart(2, '0')}′`;
  }

  function fmtPosLine(p) {
    return `${RH.SIGNS[p.sign].name} ${String(p.deg).padStart(2, '0')}°${String(p.min).padStart(2, '0')}'`;
  }

  function formatSabianText(lon) {
    if (!RH.astro || !RH.astro.sabian) return '';
    const sab = RH.astro.sabian(lon);
    if (!sab || !sab.title) return '';
    return `［サビアン: ${sab.label}「${sab.title}」］`;
  }

  /**
   * クリップボードへ安全にコピー
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* クリップボードAPI制限時はフォールバックへ */ }

    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const success = document.execCommand('copy');
      ta.remove();
      return success;
    } catch (_) {
      return false;
    }
  }

  /**
   * AI解釈用プロンプト文字列を生成
   */
  function buildPromptText({ dateTimeStr, utcMs, location, houseSystem }) {
    const pos = RH.astro.positions(utcMs);
    const h = RH.astro.houses(utcMs, location, houseSystem);
    const sysName = houseSystem === 'placidus' ? 'プラシーダス' : 'イコールハウス';
    const aspectDefs = RH.ASPECTS;

    // 1. 天体同士のアスペクト
    const bodyAspects = [];
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const p1 = pos[i];
        const p2 = pos[j];
        const isLight = p1.id === 'Sun' || p1.id === 'Moon' || p2.id === 'Sun' || p2.id === 'Moon';
        const maxOrb = isLight ? (RH.GRID_ORB?.LIGHTS ?? 8.0) : (RH.GRID_ORB?.OTHERS ?? 6.0);
        const diff = M.aspectDiff(p1.lon, p2.lon, 0);

        for (const asp of aspectDefs) {
          const orb = Math.abs(diff - asp.deg);
          if (orb <= maxOrb) {
            bodyAspects.push({
              b1: RH.BODY_BY_ID[p1.id].name,
              b2: RH.BODY_BY_ID[p2.id].name,
              asp,
              orb,
            });
            break;
          }
        }
      }
    }

    // 2. アングルとのアスペクト (ASC, MC)
    const angleAspects = [];
    const angles = [
      { name: 'ASC', lon: h.asc.lon, oppName: 'DSC' },
      { name: 'MC', lon: h.mc.lon, oppName: 'IC' },
    ];
    for (const ang of angles) {
      for (const p of pos) {
        const isLight = p.id === 'Sun' || p.id === 'Moon';
        const maxOrb = isLight ? (RH.GRID_ORB?.LIGHTS ?? 8.0) : (RH.GRID_ORB?.OTHERS ?? 6.0);
        const diff = M.aspectDiff(p.lon, ang.lon, 0);

        for (const asp of aspectDefs) {
          const orb = Math.abs(diff - asp.deg);
          if (orb <= maxOrb) {
            const note = asp.deg === 180 ? ` [${ang.oppName}と合]` : '';
            angleAspects.push({
              b: RH.BODY_BY_ID[p.id].name,
              ang: ang.name,
              note,
              asp,
              orb,
            });
            break;
          }
        }
      }
    }

    const lines = [
      '以下のホロスコープ（チャート）を解釈してください。',
      '',
      '【基本情報】',
      `・日時: ${dateTimeStr} (JST)`,
      `・観測地: ${location.name}（北緯 ${location.lat.toFixed(2)}°, 東経 ${location.lon.toFixed(2)}°）`,
      `・ハウスシステム: ${sysName}`,
      '',
      '【アングル（四角点）】',
      `・ASC（アセンダント）: ${fmtPosLine(h.asc)}${formatSabianText(h.asc.lon)}`,
      `・DSC（ディセンダント）: ${fmtPosLine(RH.astro.splitLongitude(h.asc.lon + 180))}${formatSabianText(h.asc.lon + 180)}`,
      `・MC（天頂）: ${fmtPosLine(h.mc)}${formatSabianText(h.mc.lon)}`,
      `・IC（天底）: ${fmtPosLine(RH.astro.splitLongitude(h.mc.lon + 180))}${formatSabianText(h.mc.lon + 180)}`,
      '',
      '【天体配置】',
      ...pos.map((p) => {
        const hNum = RH.astro.whichHouse(p.lon, h.cusps);
        return `・${RH.BODY_BY_ID[p.id].name}: ${fmtPosLine(p)}${p.retro ? ' [逆行]' : ''}（第${hNum}ハウス）${formatSabianText(p.lon)}`;
      }),
      '',
      '【ハウスカスプ】',
      ...h.cusps.map((c) => `・第${c.num}ハウス: ${fmtPosLine(c)}`),
      '',
      '【主要アスペクト（メジャー / オーブ: ライツ8°, 他6°以内）】',
      '［天体同士］',
      ...(bodyAspects.length ? bodyAspects.map((a) => `・${a.b1} ${a.asp.symbol} ${a.b2}（${a.asp.label} / オーブ ${fmtDegMin(a.orb)}）`) : ['・該当なし']),
      '',
      '［アングルとのアスペクト］',
      ...(angleAspects.length ? angleAspects.map((a) => `・${a.b} ${a.asp.symbol} ${a.ang}${a.note}（${a.asp.label} / オーブ ${fmtDegMin(a.orb)}）`) : ['・該当なし']),
    ];

    return lines.join('\n');
  }

  /**
   * テキスト配置一覧文字列を生成
   */
  function buildPositionsText({ dateTimeStr, utcMs, location, houseSystem }) {
    const pos = RH.astro.positions(utcMs);
    const h = RH.astro.houses(utcMs, location, houseSystem);
    const sysName = houseSystem === 'placidus' ? 'プラシーダス' : 'イコールハウス';
    const lines = [
      `${dateTimeStr}（日本標準時）`,
      `観測地: ${location.name} / ハウス方式: ${sysName}`,
      '--- 天体配置 ---',
      ...pos.map((p) => `${RH.BODY_BY_ID[p.id].name}\t${RH.SIGNS[p.sign].name} ${fmtDeg(p)}${p.retro ? ' ℞' : ''}`),
      '--- ハウスカスプ ---',
      `ASC (第1ハウス)\t${RH.SIGNS[h.asc.sign].name} ${fmtDeg(h.asc)}`,
      `MC (第10ハウス)\t${RH.SIGNS[h.mc.sign].name} ${fmtDeg(h.mc)}`,
      ...h.cusps.map((c) => `第${c.num}ハウス\t${RH.SIGNS[c.sign].name} ${fmtDeg(c)}`),
    ];
    return lines.join('\n');
  }

  RH.export = {
    fmtDegMin,
    fmtDeg,
    fmtPosLine,
    formatSabianText,
    copyToClipboard,
    buildPromptText,
    buildPositionsText,
  };
})(window.RH);
