// =============================================================
// 天体のサイン移動（イングレス）一覧を事前計算するスクリプト
//   実行: npm run generate
//   出力: js/data/ephemeris-data.js（ブラウザから <script> で読み込む）
//
// 方式:
//   1. 各天体の黄経を一定間隔（既定 6時間）でサンプリング
//   2. サインが変わった区間を二分探索で約0.5分精度まで絞り込む
//   3. 「サインが切り替わった時刻」と「新しいサイン」を記録する
//
// 座標系: 視黄経（その日の真の春分点・黄道基準、光行差補正込み）
//         = 一般的なトロピカル方式の占星術と同じ基準
// =============================================================
import * as Astronomy from 'astronomy-engine';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = resolve(__dirname, '../js/data/ephemeris-data.js');

// ---- 対象期間（日本時間 1800-01-01 00:00 〜 2101-01-01 00:00）----
const START_YEAR = 1800;
const END_YEAR = 2100;
const TZ_OFFSET_MIN = 9 * 60; // JST = UTC+9（夏時間 1948〜1951年は未考慮）
const EPOCH_UTC_MS = Date.UTC(START_YEAR, 0, 1) - TZ_OFFSET_MIN * 60000;
const END_UTC_MS = Date.UTC(END_YEAR + 1, 0, 1) - TZ_OFFSET_MIN * 60000;
const RANGE_MIN = Math.round((END_UTC_MS - EPOCH_UTC_MS) / 60000);

// サンプリング間隔（分）。月は1日に最大約15°しか動かないので6時間で十分。
// 逆行で「境界を出てすぐ戻る」ケースを取りこぼしにくくするため、全天体共通で細かめにしている。
const STEP_MIN = 6 * 60;

const BODIES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];

/** 分（エポックからの経過）→ astronomy-engine の時刻オブジェクト */
function toAstroTime(minute) {
  return Astronomy.MakeTime(new Date(EPOCH_UTC_MS + minute * 60000));
}

/** 指定天体の視黄経（度, 0〜360） */
function longitude(body, minute) {
  const t = toAstroTime(minute);
  if (body === 'Sun') return Astronomy.SunPosition(t).elon;
  if (body === 'Moon') return Astronomy.EclipticGeoMoon(t).lon;
  return Astronomy.Ecliptic(Astronomy.GeoVector(body, t, true)).elon;
}

/** 黄経 → サイン番号（0=牡羊座 … 11=魚座） */
function signOf(lon) {
  return Math.floor((((lon % 360) + 360) % 360) / 30) % 12;
}

/** lo と hi の間でサインが変わる時刻を二分探索で求める（分, 整数に丸め） */
function bisect(body, lo, hi, signLo) {
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (signOf(longitude(body, mid)) === signLo) lo = mid;
    else hi = mid;
  }
  return Math.round(hi);
}

const bodies = {};
const started = Date.now();

for (const body of BODIES) {
  const t0 = Date.now();
  const s0 = signOf(longitude(body, 0));
  const times = [];
  const signs = [];
  let prevMin = 0;
  let prevSign = s0;

  for (let m = STEP_MIN; m <= RANGE_MIN + STEP_MIN; m += STEP_MIN) {
    const cur = Math.min(m, RANGE_MIN);
    const sign = signOf(longitude(body, cur));
    if (sign !== prevSign) {
      const at = bisect(body, prevMin, cur, prevSign);
      if (at > 0 && at < RANGE_MIN) {
        times.push(at);
        signs.push(sign);
      }
      prevSign = sign;
    }
    prevMin = cur;
    if (cur === RANGE_MIN) break;
  }

  bodies[body] = { s0, t: times, s: signs };
  console.log(`${body.padEnd(8)} イングレス ${String(times.length).padStart(6)} 件  (${Date.now() - t0} ms)`);
}

const data = {
  version: 1,
  startYear: START_YEAR,
  endYear: END_YEAR,
  generatedAt: new Date().toISOString(),
  source: `astronomy-engine ${JSON.parse((await import('node:fs')).readFileSync(resolve(__dirname, '../node_modules/astronomy-engine/package.json'), 'utf8')).version}`,
  epochUtcMs: EPOCH_UTC_MS,
  rangeMinutes: RANGE_MIN,
  tzOffsetMinutes: TZ_OFFSET_MIN,
  bodies,
};

mkdirSync(dirname(OUT_FILE), { recursive: true });
const banner = '// 自動生成ファイル（tools/generate-ephemeris.mjs）。手で編集しないでください。\n';
writeFileSync(OUT_FILE, `${banner}window.RH_EPHEMERIS = ${JSON.stringify(data)};\n`, 'utf8');
console.log(`\n出力: ${OUT_FILE}`);
console.log(`合計 ${((Date.now() - started) / 1000).toFixed(1)} 秒`);
