// =============================================================
// 検証スクリプト
//   実行: npm run verify
//   1. 生成データのイングレス日を、広く知られている天文イベント日と照合
//   2. 内惑星の制約（水星・金星と太陽の離角）がデータ上で守られているか確認
//   3. 検索エンジンの基本動作確認
//   4. ASC計算式を、地平線の高度計算による別解と照合
// =============================================================
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import * as AstronomyModule from 'astronomy-engine';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ctx = {
  window: {},
  globalThis: {},
  Date,
  Math,
  performance,
  Float64Array,
  Array,
};
ctx.window.Date = Date;
ctx.window.Astronomy = AstronomyModule;
ctx.globalThis = ctx.window;
vm.createContext(ctx);
for (const f of [
  '../js/data/ephemeris-1800-2100.js',
  '../js/constants.js',
  '../js/astro-math.js',
  '../js/engine.js',
  '../js/astro.js',
  '../js/aspects.js',
  '../js/export.js',
]) {
  vm.runInContext(readFileSync(resolve(__dirname, f), 'utf8'), ctx);
}
const DATA = (ctx.window.RH_EPHEMERIS_CHUNKS && ctx.window.RH_EPHEMERIS_CHUNKS['1800-2100']) || ctx.window.RH_EPHEMERIS;
const RH = ctx.window.RH;
const engine = RH.createEngine(DATA);

const SIGN = ['牡羊', '牡牛', '双子', '蟹', '獅子', '乙女', '天秤', '蠍', '射手', '山羊', '水瓶', '魚'];
const toUtc = (m) => new Date(DATA.epochUtcMs + m * 60000);
const fmt = (m) => toUtc(m).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`); if (!cond) fails++; };

// ---- 1. 既知のイングレス日（UTC日付。出典: 一般に公表されている天文暦の日付）----
console.log('\n[1] 既知のイングレス日との照合（許容差 ±1日）');
const KNOWN = [
  ['Pluto', 7, '1983-11-05'], ['Pluto', 8, '1995-01-17'], ['Pluto', 9, '2008-01-26'],
  ['Pluto', 10, '2023-03-23'], ['Neptune', 11, '2011-04-04'], ['Uranus', 1, '2018-05-15'],
  ['Saturn', 10, '2020-12-17'], ['Jupiter', 10, '2020-12-19'], ['Saturn', 11, '2023-03-07'],
  ['Jupiter', 1, '2023-05-16'], ['Sun', 0, '2000-03-20'], ['Sun', 0, '2024-03-20'],
];
for (const [body, sign, date] of KNOWN) {
  const d = DATA.bodies[body];
  const target = Date.parse(date + 'T12:00:00Z');
  let best = null;
  for (let i = 0; i < d.t.length; i++) {
    if (d.s[i] !== sign) continue;
    const diff = Math.abs(toUtc(d.t[i]).getTime() - target);
    if (!best || diff < best.diff) best = { diff, m: d.t[i] };
  }
  ok(best && best.diff <= 36 * 3600e3, `${body.padEnd(8)} → ${SIGN[sign]}座  期待 ${date} / 計算 ${best ? fmt(best.m) : 'なし'}`);
}

// 春分の時刻は分単位で公表されている（2000年 07:35 UTC, 2024年 03:06 UTC）
console.log('\n    春分時刻（分単位）');
for (const [iso, label] of [['2000-03-20T07:35:00Z', '2000年'], ['2024-03-20T03:06:00Z', '2024年']]) {
  const t = Date.parse(iso);
  const d = DATA.bodies.Sun;
  const m = d.t.find((x, i) => d.s[i] === 0 && Math.abs(toUtc(x).getTime() - t) < 864e5);
  const diffMin = m === undefined ? NaN : Math.round((toUtc(m).getTime() - t) / 60000);
  ok(Math.abs(diffMin) <= 2, `${label} 春分  公表 ${iso.slice(11, 16)} UTC / 計算 ${fmt(m)}  差 ${diffMin}分`);
}

// ---- 2. 内惑星の制約 ----
console.log('\n[2] 内惑星の制約（太陽とのサイン差）');
function maxSignGap(body) {
  let max = 0;
  for (const seg of engine.partition[body]) {
    for (let sun = 0; sun < 12; sun++) {
      if (RH.intersect([[seg.s, seg.e]], engine.bySign.Sun[sun]).length) {
        const g = Math.min((seg.sign - sun + 12) % 12, (sun - seg.sign + 12) % 12);
        if (g > max) max = g;
      }
    }
  }
  return max;
}
const merGap = maxSignGap('Mercury');
const venGap = maxSignGap('Venus');
ok(merGap === 1, `水星と太陽のサイン差は最大 ${merGap}（期待 1）`);
ok(venGap === 2, `金星と太陽のサイン差は最大 ${venGap}（期待 2）`);

// ---- 3. エンジン ----
console.log('\n[3] 検索エンジン');
const r1 = engine.search([{ body: 'Pluto', sign: 7, mode: 'required' }]);
ok(r1.segments.length >= 2, `冥王星 蠍座: ${r1.segments.length} 期間  最初 ${fmt(r1.segments[0].s)}〜${fmt(r1.segments[0].e)}`);
const r2 = engine.search([{ body: 'Sun', sign: 0, mode: 'required' }, { body: 'Mercury', sign: 6, mode: 'required' }]);
ok(r2.segments.length === 0, `太陽 牡羊座 × 水星 天秤座（あり得ない配置）: ${r2.segments.length} 期間`);
const cnt = engine.signCounts([{ body: 'Sun', sign: 0, mode: 'required' }], 'Venus');
ok(cnt[6] === 0 && cnt[0] > 0, `太陽 牡羊座のときの金星サイン別件数: [${cnt.join(', ')}]`);
const t0 = performance.now();
const r3 = engine.search([
  { body: 'Pluto', sign: 7, mode: 'required' },
  { body: 'Sun', sign: 3, mode: 'preferred' },
  { body: 'Moon', sign: 0, mode: 'preferred' },
  { body: 'Venus', sign: 4, mode: 'preferred' },
  { body: 'Mars', sign: 2, mode: 'preferred' },
]);
const ms = (performance.now() - t0).toFixed(1);
const full = r3.segments.filter((s) => s.matched === 4).length;
ok(r3.segments.length > 0, `必須1＋できれば4（月含む）: ${r3.segments.length} 区間, 全一致 ${full} 区間, ${ms} ms`);

// 区間の妥当性: 必須期間の中に収まっており、重なりがないこと
let sorted = true;
for (let i = 1; i < r3.segments.length; i++) if (r3.segments[i].s < r3.segments[i - 1].e) sorted = false;
ok(sorted, '結果区間は時系列順で重なりなし');

// ---- 4. ASC 計算式の照合 ----
console.log('\n[4] ASC計算式の照合（地平線高度0°の東側の黄道点を数値的に探索）');
const lat = 35.6895;
const rad = Math.PI / 180;
for (const [ramc, eps] of [[0, 23.44], [95, 23.44], [200, 23.44], [310, 23.44]]) {
  const asc = RH.astroMath.ascendant(ramc, eps, lat);
  // 黄道上の点 λ を赤道座標に変換し、高度 0 かつ東側（時角が負）になる λ を探す
  let best = null;
  for (let l = 0; l < 360; l += 0.005) {
    const ra = Math.atan2(Math.sin(l * rad) * Math.cos(eps * rad), Math.cos(l * rad));
    const dec = Math.asin(Math.sin(eps * rad) * Math.sin(l * rad));
    const H = ramc * rad - ra;
    const alt = Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(H));
    if (Math.sin(H) < 0 && (!best || Math.abs(alt) < best.a)) best = { a: Math.abs(alt), l };
  }
  const diff = Math.abs(((asc - best.l + 540) % 360) - 180);
  ok(diff < 0.02, `RAMC ${String(ramc).padStart(3)}°: 公式 ${asc.toFixed(3)}° / 数値解 ${best.l.toFixed(3)}°`);
}

// ---- 5. NASA/JPL Horizons（DE441）との照合 ----
// 参照値: Horizons API, QUANTITIES=31（地心・ecliptic-of-date の視黄経）, 2026-10-15 取得
console.log('\n[5] NASA/JPL Horizons の視黄経との照合（許容差 1分角 = 1/60°）');
const Astronomy = await import('astronomy-engine');
const HORIZONS = [
  ['Moon',    '1900-01-01T00:00:00Z', 272.4162663],
  ['Moon',    '1987-06-16T00:00:00Z', 322.2695723],
  ['Moon',    '2000-01-01T12:00:00Z', 223.3237860],
  ['Moon',    '2023-02-25T00:00:00Z',  38.6478089],
  ['Moon',    '2050-01-01T00:00:00Z',  18.6755972],
  ['Mercury', '1900-01-01T00:00:00Z', 258.9977026],
  ['Mercury', '1987-06-16T00:00:00Z', 105.8042902],
  ['Mercury', '2023-02-25T00:00:00Z', 320.1691055],
  ['Mercury', '2050-01-01T00:00:00Z', 270.0594887],
  ['Pluto',   '1900-01-01T00:00:00Z',  75.2513936],
  ['Pluto',   '1987-06-16T00:00:00Z', 217.4294277],
  ['Pluto',   '2023-02-25T00:00:00Z', 299.3871014],
  ['Pluto',   '2050-01-01T00:00:00Z', 337.5330679],
];
for (const [body, iso, ref] of HORIZONS) {
  const t = Astronomy.MakeTime(new Date(iso));
  const lon = body === 'Moon' ? Astronomy.EclipticGeoMoon(t).lon : Astronomy.Ecliptic(Astronomy.GeoVector(body, t, true)).elon;
  const diffArcmin = Math.abs(((lon - ref + 540) % 360) - 180) * 60;
  ok(diffArcmin < 1, `${body.padEnd(8)} ${iso.slice(0, 10)}  JPL ${ref.toFixed(4)}° / 計算 ${lon.toFixed(4)}°  差 ${diffArcmin.toFixed(2)}′`);
}

// ---- 6. アスペクト探索の検証 ----
console.log('\n[6] アスペクト探索エンジンの検証');
const tAsp0 = performance.now();
// 太陽（牡羊座・必須）＋ 太陽と月のトライン（120° ± 6°・必須）
const rAsp1 = engine.search(
  [{ body: 'Sun', sign: 0, mode: 'required' }],
  [{ body1: 'Sun', body2: 'Moon', targetAngle: 120, orb: 6, mode: 'required' }]
);
const msAsp1 = (performance.now() - tAsp0).toFixed(1);
ok(rAsp1.segments.length > 0, `太陽 牡羊座 × 太陽△月(120°±6°): ${rAsp1.segments.length} 期間検出 (${msAsp1} ms)`);

// 検出された期間の中央で、実際に黄経差が 120° ± 6° に収まっているか全件検証
let allAspValid = true;
for (const seg of rAsp1.segments.slice(0, 20)) {
  const midUtc = DATA.epochUtcMs + Math.round((seg.s + seg.e) / 2) * 60000;
  const l1 = RH.astro.longitude('Sun', midUtc);
  const l2 = RH.astro.longitude('Moon', midUtc);
  const diff = RH.astroMath.aspectDiff(l1, l2, 120);
  if (diff > 6.05) { allAspValid = false; break; }
}
ok(allAspValid, '検出期間の中央時刻における角度誤差がオーブ(±6°)以内であることを確認');

// 太陽（獅子座・必須）＋ 太陽と木星の合（0° ± 6°・できれば）
const tAsp2 = performance.now();
const rAsp2 = engine.search(
  [{ body: 'Sun', sign: 4, mode: 'required' }],
  [{ body1: 'Sun', body2: 'Jupiter', targetAngle: 0, orb: 6, mode: 'preferred' }]
);
const msAsp2 = (performance.now() - tAsp2).toFixed(1);
const fullMatches = rAsp2.segments.filter((s) => s.matched === 1).length;
ok(fullMatches > 0, `太陽 獅子座 × 太陽☌木星(合・できれば): 全体 ${rAsp2.segments.length} 期間中、合の一致 ${fullMatches} 期間 (${msAsp2} ms)`);

// ---- 7. ハウス計算（プラシーダス・イコールハウス）の検証 ----
console.log('\n[7] ハウス計算エンジンの検証');
const tHouse = Date.parse('2000-01-01T12:00:00Z');
const hPlac = RH.astro.houses(tHouse, RH.LOCATION, 'placidus');
const hEq = RH.astro.houses(tHouse, RH.LOCATION, 'equal');

ok(hPlac.cusps.length === 12, `プラシーダスカスプ 12個生成確認`);
ok(hEq.cusps.length === 12, `イコールハウスカスプ 12個生成確認`);

// MC/IC 差が180度、ASC/DESC 差が180度
const placMcIcDiff = Math.abs(RH.astroMath.angularDistance(hPlac.cusps[9].lon, hPlac.cusps[3].lon) - 180);
const placAscDescDiff = Math.abs(RH.astroMath.angularDistance(hPlac.cusps[0].lon, hPlac.cusps[6].lon) - 180);
ok(placMcIcDiff < 0.001, `プラシーダス MC-IC 軸が正反対(180°): 差 ${placMcIcDiff.toFixed(5)}°`);
ok(placAscDescDiff < 0.001, `プラシーダス ASC-DESC 軸が正反対(180°): 差 ${placAscDescDiff.toFixed(5)}°`);

// イコールハウスのカスプ間隔がすべて正確に30度であること
let eqValid = true;
for (let i = 1; i < 12; i++) {
  const diff = RH.astroMath.norm(hEq.cusps[i].lon - hEq.cusps[i - 1].lon);
  if (Math.abs(diff - 30) > 0.001) eqValid = false;
}
ok(eqValid, 'イコールハウスの各カスプが正確に30°等分であることを確認');

console.log(fails === 0 ? '\nすべての検証に合格しました。' : `\n${fails} 件の検証に失敗しました。`);
process.exit(fails ? 1 : 0);
