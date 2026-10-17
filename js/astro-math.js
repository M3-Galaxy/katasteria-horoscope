// =============================================================
// 天文計算（純粋な数式部分）
//   ブラウザ・Node の両方から使えるよう、外部ライブラリに依存しない
// =============================================================
(function (root) {
  'use strict';
  const RH = (root.RH = root.RH || {});
  const rad = Math.PI / 180;
  const norm = (d) => ((d % 360) + 360) % 360;

  /** 平均黄道傾斜角（度）。T: J2000.0 からのユリウス世紀数（TT） */
  function meanObliquity(T) {
    // IAU 2006 の主要項。1900〜2050年なら章動（約0.003°）を除いて十分な精度
    return 23.439279444 - 0.013010214 * T - 5.086e-8 * T * T;
  }

  /**
   * アセンダント（度）
   * @param {number} ramc 地方恒星時を角度にしたもの（度）
   * @param {number} eps  黄道傾斜角（度）
   * @param {number} lat  緯度（度、北緯が正）
   */
  function ascendant(ramc, eps, lat) {
    const r = ramc * rad;
    const e = eps * rad;
    const y = Math.cos(r);
    const x = -(Math.sin(r) * Math.cos(e) + Math.tan(lat * rad) * Math.sin(e));
    return norm(Math.atan2(y, x) / rad);
  }

  /** MC（南中する黄道点、度） */
  function midheaven(ramc, eps) {
    const r = ramc * rad;
    return norm(Math.atan2(Math.sin(r), Math.cos(r) * Math.cos(eps * rad)) / rad);
  }

  /** 2つの黄経の最短角度差（0〜180度） */
  function angularDistance(lon1, lon2) {
    const d = Math.abs(norm(lon1) - norm(lon2));
    return d > 180 ? 360 - d : d;
  }

  /** 指定のアスペクト目標角度に対する誤差（度） */
  function aspectDiff(lon1, lon2, targetAngle) {
    return Math.abs(angularDistance(lon1, lon2) - targetAngle);
  }

  const deg = 180 / Math.PI;
  const VERY_SMALL = 1e-10;

  function sind(d) { return Math.sin(d * rad); }
  function cosd(d) { return Math.cos(d * rad); }
  function tand(d) { return Math.tan(d * rad); }
  function asind(x) { return Math.asin(Math.max(-1, Math.min(1, x))) * deg; }
  function atand(x) { return Math.atan(x) * deg; }
  function difdeg2n(a, b) {
    let d = norm(a - b);
    if (d >= 180) d -= 360;
    return d;
  }

  function asc2(x, f, sine, cose) {
    let ass = -tand(f) * sine + cose * cosd(x);
    if (Math.abs(ass) < VERY_SMALL) ass = 0;
    let sinx = sind(x);
    if (Math.abs(sinx) < VERY_SMALL) sinx = 0;
    if (sinx === 0) {
      ass = ass < 0 ? -VERY_SMALL : VERY_SMALL;
    } else if (ass === 0) {
      ass = sinx < 0 ? -90 : 90;
    } else {
      ass = atand(sinx / ass);
    }
    if (ass < 0) ass += 180;
    return ass;
  }

  function asc1(x1, f, sine, cose) {
    x1 = norm(x1);
    const n = Math.floor(x1 / 90) + 1;
    let ass;
    if (Math.abs(90 - f) < VERY_SMALL) return 180;
    if (Math.abs(90 + f) < VERY_SMALL) return 0;
    if (n === 1) ass = asc2(x1, f, sine, cose);
    else if (n === 2) ass = 180 - asc2(180 - x1, -f, sine, cose);
    else if (n === 3) ass = 180 + asc2(x1 - 180, -f, sine, cose);
    else ass = 360 - asc2(360 - x1, f, sine, cose);
    ass = norm(ass);
    if (Math.abs(ass - 90) < VERY_SMALL) ass = 90;
    if (Math.abs(ass - 180) < VERY_SMALL) ass = 180;
    if (Math.abs(ass - 270) < VERY_SMALL) ass = 270;
    if (Math.abs(ass - 360) < VERY_SMALL) ass = 0;
    return ass;
  }

  /**
   * プラシーダス方式のハウスカスプ（1〜12ハウス）
   * @param {number} ramc 地方恒星時（度）
   * @param {number} eps 黄道傾斜角（度）
   * @param {number} lat 緯度（度、北緯正）
   * @returns {{ cusps: number[], asc: number, mc: number }} 1-indexed配列 (cusps[1]..cusps[12])
   */
  function placidusCusps(ramc, eps, lat) {
    const sine = sind(eps);
    const cose = cosd(eps);
    const tane = tand(eps);
    const tanfi = tand(lat);

    const ac = ascendant(ramc, eps, lat);
    const mc = midheaven(ramc, eps);

    const cusps = new Array(13).fill(0);
    cusps[1] = ac;
    cusps[10] = mc;

    // 極圏内（計算不能時はイコールハウスにフォールバック）
    if (Math.abs(lat) >= 90 - eps) {
      for (let i = 2; i <= 12; i++) cusps[i] = norm(ac + (i - 1) * 30);
      return { cusps, asc: ac, mc };
    }

    const a = asind(tanfi * tane);
    const fh1 = atand(sind(a / 3) / tane);
    const fh2 = atand(sind((a * 2) / 3) / tane);
    const niter_max = 50;
    const VERY_SMALL_PLAC_ITER = 1.0 / 360000.0;

    function iterCusp(offset, initFh, ratio) {
      const rectasc = norm(offset + ramc);
      let tant = tand(asind(sine * sind(asc1(rectasc, initFh, sine, cose))));
      if (Math.abs(tant) < VERY_SMALL) return rectasc;
      let f = atand(sind(asind(tanfi * tant) * ratio) / tant);
      let cusp = asc1(rectasc, f, sine, cose);
      let cuspsv = 0;
      for (let i = 1; i <= niter_max; i++) {
        tant = tand(asind(sine * sind(cusp)));
        if (Math.abs(tant) < VERY_SMALL) { cusp = rectasc; break; }
        f = atand(sind(asind(tanfi * tant) * ratio) / tant);
        cusp = asc1(rectasc, f, sine, cose);
        if (i > 1 && Math.abs(difdeg2n(cusp, cuspsv)) < VERY_SMALL_PLAC_ITER) break;
        cuspsv = cusp;
      }
      return cusp;
    }

    cusps[11] = iterCusp(30, fh1, 1 / 3);
    cusps[12] = iterCusp(60, fh2, 1 / 1.5);
    cusps[2] = iterCusp(120, fh2, 1 / 1.5);
    cusps[3] = iterCusp(150, fh1, 1 / 3);

    cusps[4] = norm(cusps[10] + 180);
    cusps[5] = norm(cusps[11] + 180);
    cusps[6] = norm(cusps[12] + 180);
    cusps[7] = norm(cusps[1] + 180);
    cusps[8] = norm(cusps[2] + 180);
    cusps[9] = norm(cusps[3] + 180);

    return { cusps, asc: ac, mc };
  }

  /**
   * イコールハウス方式のハウスカスプ（ASCから30度等分）
   */
  function equalCusps(asc, mc) {
    const cusps = new Array(13).fill(0);
    for (let i = 1; i <= 12; i++) {
      cusps[i] = norm(asc + (i - 1) * 30);
    }
    return { cusps, asc, mc };
  }

  RH.astroMath = {
    norm,
    meanObliquity,
    ascendant,
    midheaven,
    angularDistance,
    aspectDiff,
    placidusCusps,
    equalCusps,
  };
})(typeof window !== 'undefined' ? window : globalThis);

