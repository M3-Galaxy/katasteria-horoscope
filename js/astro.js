// =============================================================
// 天体位置の計算（ブラウザ用 / astronomy-engine を使用）
//   検索結果の「配置の確認」パネルで、選んだ時刻の正確な度数を出すために使う
// =============================================================
(function (RH) {
  'use strict';
  const A = window.Astronomy;
  const M = RH.astroMath;

  /** 視黄経（度） */
  function longitude(body, utcMs) {
    const t = A.MakeTime(new Date(utcMs));
    if (body === 'Sun') return A.SunPosition(t).elon;
    if (body === 'Moon') return A.EclipticGeoMoon(t).lon;
    return A.Ecliptic(A.GeoVector(body, t, true)).elon;
  }

  /** 逆行中かどうか（前後1時間の黄経の変化で判定） */
  function isRetrograde(body, utcMs) {
    if (body === 'Sun' || body === 'Moon') return false;
    const a = longitude(body, utcMs - 3600e3);
    const b = longitude(body, utcMs + 3600e3);
    return ((b - a + 540) % 360) - 180 < 0;
  }

  /** 黄経を「サイン・度・分」に分解 */
  function splitLongitude(lon) {
    const l = M.norm(lon);
    const sign = Math.floor(l / 30);
    const inSign = l - sign * 30;
    let deg = Math.floor(inSign);
    let min = Math.round((inSign - deg) * 60);
    if (min === 60) { deg += 1; min = 0; }
    return { lon: l, sign, deg, min };
  }

  /** 全天体の位置 */
  function positions(utcMs) {
    return RH.BODIES.map((b) => ({
      id: b.id,
      ...splitLongitude(longitude(b.id, utcMs)),
      retro: isRetrograde(b.id, utcMs),
    }));
  }

  /** ASC・MC（指定地点） */
  function angles(utcMs, loc) {
    const t = A.MakeTime(new Date(utcMs));
    const ramc = M.norm(A.SiderealTime(t) * 15 + loc.lon); // 地方恒星時（度）
    const eps = M.meanObliquity(t.tt / 36525);
    return {
      ramc,
      eps,
      asc: splitLongitude(M.ascendant(ramc, eps, loc.lat)),
      mc: splitLongitude(M.midheaven(ramc, eps)),
    };
  }

  /**
   * 指定地点・時刻・ハウスシステムにおけるハウスカスプ（1〜12）
   * @param {number} utcMs UTCミリ秒
   * @param {{ lat: number, lon: number }} loc 観測地点
   * @param {'placidus' | 'equal'} system ハウスシステム
   */
  function houses(utcMs, loc, system = 'placidus') {
    const t = A.MakeTime(new Date(utcMs));
    const ramc = M.norm(A.SiderealTime(t) * 15 + loc.lon);
    const eps = M.meanObliquity(t.tt / 36525);

    let res;
    if (system === 'equal') {
      const ascDeg = M.ascendant(ramc, eps, loc.lat);
      const mcDeg = M.midheaven(ramc, eps);
      res = M.equalCusps(ascDeg, mcDeg);
    } else {
      res = M.placidusCusps(ramc, eps, loc.lat);
    }

    const cusps = [];
    for (let i = 1; i <= 12; i++) {
      cusps.push({
        num: i,
        ...splitLongitude(res.cusps[i]),
      });
    }

    return {
      system,
      ramc,
      eps,
      asc: splitLongitude(res.asc),
      mc: splitLongitude(res.mc),
      cusps,
    };
  }

  /** 黄経 lon に対応するサビアンシンボルを取得（度数は切り上げ 1〜30） */
  function sabian(lon) {
    const l = M.norm(lon);
    const sign = Math.floor(l / 30);
    const degInSign = l - sign * 30;
    const deg = Math.floor(degInSign) + 1; // 1〜30
    const list = (typeof window !== 'undefined' && window.RH_SABIAN) ? window.RH_SABIAN[sign] : null;
    const title = (list && list[deg - 1]) || '';
    const signInfo = RH.SIGNS[sign];
    return {
      sign,
      signName: signInfo.name,
      deg,
      label: `${signInfo.name}${deg}度`,
      title,
    };
  }

  /** 黄経 lon がどのハウス（1〜12）に属するかを判定 */
  function whichHouse(lon, cusps) {
    if (!cusps || cusps.length < 12) return 1;
    for (let i = 0; i < 12; i++) {
      const c1 = cusps[i].lon;
      const c2 = cusps[(i + 1) % 12].lon;
      const span = M.norm(c2 - c1);
      const diff = M.norm(lon - c1);
      if (diff >= 0 && diff < span) return cusps[i].num;
    }
    return 1;
  }

  RH.astro = { longitude, positions, angles, houses, whichHouse, splitLongitude, sabian };
})(window.RH);
