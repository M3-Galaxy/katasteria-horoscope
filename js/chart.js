// =============================================================
// ホロスコープ円図（ネイタルチャート）SVG描画モジュール
//   ・ASC（東の地平線）を左（9時位置）に固定する標準スタイル
//   ・プラシーダス方式 / イコールハウス方式のカスプ描画
//   ・天体の密集配置時の重なり回避（クラスタリング）
//   ・主要アスペクト線（合・衝・三分・四分・六分）の幾何学描画
// =============================================================
(function (RH) {
  'use strict';

  const M = RH.astroMath;
  const rad = Math.PI / 180;

  // 4区分の淡いカラー（ミニマルな静かな配色）
  const ELEMENT_COLORS = [
    'rgba(217, 107, 91, 0.08)',  // 0: 牡羊 (火)
    'rgba(138, 184, 90, 0.08)',  // 1: 牡牛 (地)
    'rgba(120, 176, 224, 0.08)', // 2: 双子 (風)
    'rgba(142, 142, 224, 0.08)', // 3: 蟹 (水)
    'rgba(217, 107, 91, 0.08)',  // 4: 獅子 (火)
    'rgba(138, 184, 90, 0.08)',  // 5: 乙女 (地)
    'rgba(120, 176, 224, 0.08)', // 6: 天秤 (風)
    'rgba(142, 142, 224, 0.08)', // 7: 蠍 (水)
    'rgba(217, 107, 91, 0.08)',  // 8: 射手 (火)
    'rgba(138, 184, 90, 0.08)',  // 9: 山羊 (地)
    'rgba(120, 176, 224, 0.08)', // 10: 水瓶 (風)
    'rgba(142, 142, 224, 0.08)', // 11: 魚 (水)
  ];

  // メジャーアスペクト定義（表示用）
  const MAJOR_ASPECTS = [
    { deg: 180, orb: 6, stroke: '#d96b5b', opacity: 0.55, width: 1.2 }, // オポジション (赤橙)
    { deg: 120, orb: 6, stroke: '#78b0e0', opacity: 0.55, width: 1.2 }, // トライン (青)
    { deg: 90,  orb: 6, stroke: '#d96b5b', opacity: 0.45, width: 1 },   // スクエア (赤橙)
    { deg: 60,  orb: 4, stroke: '#8ab878', opacity: 0.45, width: 0.9, dash: '3,3' }, // セクスタイル (緑)
  ];

  /** 黄経 lon を、ASC を左（180度）に置いた SVG 上の座標 (x, y) に変換 */
  function posOnChart(cx, cy, r, lon, ascLon) {
    const diff = M.norm(lon - ascLon);
    const d = diff * rad;
    return {
      x: cx - r * Math.cos(d),
      y: cy + r * Math.sin(d),
      angleDeg: M.norm(180 + diff),
    };
  }

  /** 円弧 path の d 属性（始点黄経 sLon から 終点黄経 eLon） */
  function arcPath(cx, cy, rIn, rOut, sLon, eLon, ascLon) {
    const p1 = posOnChart(cx, cy, rOut, sLon, ascLon);
    const p2 = posOnChart(cx, cy, rOut, eLon, ascLon);
    const p3 = posOnChart(cx, cy, rIn, eLon, ascLon);
    const p4 = posOnChart(cx, cy, rIn, sLon, ascLon);
    const span = M.norm(eLon - sLon);
    const large = span > 180 ? 1 : 0;
    // SVG 円弧: 外輪(p1->p2)は反時計回り(sweep=0)、内輪(p3->p4)は時計回り(sweep=1)
    return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} ` +
           `A ${rOut} ${rOut} 0 ${large} 0 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} ` +
           `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)} ` +
           `A ${rIn} ${rIn} 0 ${large} 1 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)} Z`;
  }

  /**
   * ホロスコープ円図の SVG 文字列を生成
   * @param {Object} options
   * @param {Array} options.positions 全天体の位置一覧 [{ id, lon, sign, deg, min, retro }]
   * @param {Object} options.houses ハウス情報 { asc, mc, cusps }
   * @param {number} [options.size=320] チャートの一辺サイズ (px)
   */
  function renderSvg({ positions, houses, size = 320 }) {
    const cx = size / 2;
    const cy = size / 2;
    const rOut = size * 0.47;     // サイン外輪 (例: 150)
    const rIn = size * 0.38;      // サイン内輪 (例: 121)
    const rPlanetBase = size * 0.28; // 惑星配置半径
    const rHouseNum = size * 0.17;   // ハウス番号配置半径
    const rCenter = size * 0.12;     // アスペクト円の内径

    const ascLon = houses.asc.lon;

    const parts = [];
    parts.push(`<svg class="horoscope-chart" viewBox="0 0 ${size} ${size}" width="100%" height="auto" role="img" aria-label="ホロスコープ天球図">`);
    parts.push(`<defs>
      <filter id="rh-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>`);

    // 1. 背景円
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${rOut}" fill="var(--surface-2)" stroke="var(--line-2)" stroke-width="1"/>`);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${rIn}" fill="var(--surface)" stroke="var(--line)" stroke-width="1"/>`);

    // 2. サイン（黄道十二宮）リング
    for (let s = 0; s < 12; s++) {
      const sStart = s * 30;
      const sEnd = (s + 1) * 30;
      const bg = ELEMENT_COLORS[s];
      parts.push(`<path d="${arcPath(cx, cy, rIn, rOut, sStart, sEnd, ascLon)}" fill="${bg}" stroke="var(--line-2)" stroke-width="0.7"/>`);

      // サイン記号
      const midLon = sStart + 15;
      const pMid = posOnChart(cx, cy, (rOut + rIn) / 2, midLon, ascLon);
      const signInfo = RH.SIGNS[s];
      parts.push(`<text class="glyph chart-sign-glyph" x="${pMid.x.toFixed(2)}" y="${(pMid.y + 4.5).toFixed(2)}" text-anchor="middle" fill="var(--text-2)" font-size="${size * 0.042}">${signInfo.glyph}</text>`);
    }

    // 3. アスペクト線（惑星間の角度線）
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const p1 = positions[i];
        const p2 = positions[j];
        const dist = M.angularDistance(p1.lon, p2.lon);

        for (const asp of MAJOR_ASPECTS) {
          if (Math.abs(dist - asp.deg) <= asp.orb) {
            const pt1 = posOnChart(cx, cy, rPlanetBase - 12, p1.lon, ascLon);
            const pt2 = posOnChart(cx, cy, rPlanetBase - 12, p2.lon, ascLon);
            const dash = asp.dash ? `stroke-dasharray="${asp.dash}"` : '';
            parts.push(`<line x1="${pt1.x.toFixed(2)}" y1="${pt1.y.toFixed(2)}" x2="${pt2.x.toFixed(2)}" y2="${pt2.y.toFixed(2)}" stroke="${asp.stroke}" stroke-width="${asp.width}" opacity="${asp.opacity}" ${dash}/>`);
            break;
          }
        }
      }
    }

    // 4. ハウスカスプ線（1〜12ハウス）
    const cusps = houses.cusps;
    for (let i = 0; i < 12; i++) {
      const c = cusps[i];
      const nextC = cusps[(i + 1) % 12];
      const isAscDesc = c.num === 1 || c.num === 7;
      const isMcIc = c.num === 10 || c.num === 4;

      // 主要軸（ASC-DSC, MC-IC）は中心まで完全貫通、その他のカスプ線も中心まで伸ばして中央の空白円を解消
      const pIn = isAscDesc || isMcIc 
        ? { x: cx, y: cy } 
        : posOnChart(cx, cy, 4, c.lon, ascLon);
      const pOut = posOnChart(cx, cy, rIn, c.lon, ascLon);

      let stroke = 'var(--line-2)';
      let width = 0.8;
      let dash = 'stroke-dasharray="2,3"';

      if (isAscDesc) {
        stroke = 'var(--req)';
        width = 1.6;
        dash = '';
      } else if (isMcIc) {
        stroke = 'var(--pref)';
        width = 1.4;
        dash = '';
      }

      parts.push(`<line x1="${pIn.x.toFixed(2)}" y1="${pIn.y.toFixed(2)}" x2="${pOut.x.toFixed(2)}" y2="${pOut.y.toFixed(2)}" stroke="${stroke}" stroke-width="${width}" ${dash}/>`);

      // ハウス番号（部屋の中央）
      let span = M.norm(nextC.lon - c.lon);
      const midHouseLon = c.lon + span / 2;
      const pHouse = posOnChart(cx, cy, rHouseNum, midHouseLon, ascLon);
      parts.push(`<text x="${pHouse.x.toFixed(2)}" y="${(pHouse.y + 3.5).toFixed(2)}" text-anchor="middle" fill="var(--text-3)" font-size="${size * 0.032}" opacity="0.75">${c.num}</text>`);
    }

    // 中心点（十字軸の交差点）
    parts.push(`<circle cx="${cx}" cy="${cy}" r="2" fill="var(--text-3)" opacity="0.6"/>`);

    // 5. ASC / DSC / MC / IC の内側ラベル（サイン内輪の内側に上品に配置して見切れを防止）
    const rAngle = rIn - 8;
    const angleFontSize = size * 0.032;

    // ASC: 東（左端水平線）のすぐ上・内側
    const pAsc = posOnChart(cx, cy, rAngle, houses.asc.lon, ascLon);
    parts.push(`<text x="${(pAsc.x + 2).toFixed(2)}" y="${(pAsc.y - 3).toFixed(2)}" text-anchor="start" fill="var(--req)" font-size="${angleFontSize}" font-weight="600" letter-spacing="0.05em" stroke="var(--surface)" stroke-width="2.5" paint-order="stroke fill">ASC</text>`);

    // DSC: 西（右端水平線）のすぐ上・内側
    const pDsc = posOnChart(cx, cy, rAngle, houses.asc.lon + 180, ascLon);
    parts.push(`<text x="${(pDsc.x - 2).toFixed(2)}" y="${(pDsc.y - 3).toFixed(2)}" text-anchor="end" fill="var(--req)" font-size="${angleFontSize}" font-weight="600" letter-spacing="0.05em" stroke="var(--surface)" stroke-width="2.5" paint-order="stroke fill">DSC</text>`);

    // MC: 南（上部子午線）の先端内側
    const pMc = posOnChart(cx, cy, rAngle, houses.mc.lon, ascLon);
    parts.push(`<text x="${pMc.x.toFixed(2)}" y="${(pMc.y + 3).toFixed(2)}" text-anchor="middle" fill="var(--pref)" font-size="${angleFontSize}" font-weight="600" letter-spacing="0.05em" stroke="var(--surface)" stroke-width="2.5" paint-order="stroke fill">MC</text>`);

    // IC: 北（下部子午線）の先端内側
    const pIc = posOnChart(cx, cy, rAngle, houses.mc.lon + 180, ascLon);
    parts.push(`<text x="${pIc.x.toFixed(2)}" y="${(pIc.y + 3).toFixed(2)}" text-anchor="middle" fill="var(--pref)" font-size="${angleFontSize}" font-weight="600" letter-spacing="0.05em" stroke="var(--surface)" stroke-width="2.5" paint-order="stroke fill">IC</text>`);

    // 6. 天体（惑星）シンボル描画（重なり回避）
    // 角度順に並び替え
    const sorted = positions.map((p, idx) => ({ ...p, origIdx: idx })).sort((a, b) => a.lon - b.lon);
    const radiusShift = new Array(sorted.length).fill(0);

    // 近接する天体の半径を交互にずらす（重なり回避）
    for (let i = 0; i < sorted.length; i++) {
      const prev = sorted[(i - 1 + sorted.length) % sorted.length];
      const dist = M.angularDistance(sorted[i].lon, prev.lon);
      if (dist < 8) {
        radiusShift[i] = radiusShift[(i - 1 + sorted.length) % sorted.length] === 0 ? 11 : 0;
      }
    }

    sorted.forEach((p, i) => {
      const b = RH.BODY_BY_ID[p.id];
      const r = rPlanetBase + (radiusShift[i] === 0 ? 0 : (i % 2 === 0 ? 11 : -11));
      const pt = posOnChart(cx, cy, r, p.lon, ascLon);
      const tickIn = posOnChart(cx, cy, rIn - 4, p.lon, ascLon);
      const tickOut = posOnChart(cx, cy, rIn, p.lon, ascLon);

      // 外輪への目盛り線
      parts.push(`<line x1="${tickIn.x.toFixed(2)}" y1="${tickIn.y.toFixed(2)}" x2="${tickOut.x.toFixed(2)}" y2="${tickOut.y.toFixed(2)}" stroke="var(--text-3)" stroke-width="0.8"/>`);

      // 天体シンボル
      const sab = RH.astro && RH.astro.sabian ? RH.astro.sabian(p.lon) : null;
      const sabTip = sab && sab.title ? `&#10;サビアン: ${sab.label}「${sab.title}」` : '';
      parts.push(`<g class="chart-planet" data-body="${b.id}" style="cursor:pointer" tabindex="0" role="button" aria-label="${b.name}">
        <title>${b.name}: ${RH.SIGNS[p.sign].name} ${p.deg}°${p.min}'${p.retro ? ' 逆行' : ''}${sabTip}</title>
        <circle cx="${pt.x.toFixed(2)}" cy="${pt.y.toFixed(2)}" r="${size * 0.034}" fill="var(--surface-3)" stroke="var(--line-2)" stroke-width="0.8"/>
        <text class="glyph" x="${pt.x.toFixed(2)}" y="${(pt.y + 4).toFixed(2)}" text-anchor="middle" fill="var(--text)" font-size="${size * 0.042}">${b.glyph}</text>
        ${p.retro ? `<text x="${(pt.x + 8).toFixed(2)}" y="${(pt.y - 3).toFixed(2)}" font-size="9" fill="var(--warn)">℞</text>` : ''}
      </g>`);
    });

    parts.push('</svg>');
    return parts.join('\n');
  }

  RH.chart = { renderSvg };
})(window.RH);
