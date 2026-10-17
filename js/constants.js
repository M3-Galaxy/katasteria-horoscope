// =============================================================
// 定数定義（天体・サイン）
// =============================================================
(function (RH) {
  'use strict';

  // U+FE0E を付けて、Windows などで絵文字表示になるのを防ぐ
  const T = '\uFE0E';

  /** 天体（表示順） */
  RH.BODIES = [
    { id: 'Sun',     name: '太陽',   glyph: '☉' + T, note: '' },
    { id: 'Moon',    name: '月',     glyph: '☽' + T, note: '約2.5日でサインを移動します' },
    { id: 'Mercury', name: '水星',   glyph: '☿' + T, note: '太陽から最大約28°。太陽と同じか、隣のサインにしか入りません' },
    { id: 'Venus',   name: '金星',   glyph: '♀' + T, note: '太陽から最大約47°。太陽から前後2サインまでしか離れません' },
    { id: 'Mars',    name: '火星',   glyph: '♂' + T, note: '' },
    { id: 'Jupiter', name: '木星',   glyph: '♃' + T, note: '約1年でサインを移動します' },
    { id: 'Saturn',  name: '土星',   glyph: '♄' + T, note: '約2.5年でサインを移動します' },
    { id: 'Uranus',  name: '天王星', glyph: '♅' + T, note: '約7年でサインを移動します' },
    { id: 'Neptune', name: '海王星', glyph: '♆' + T, note: '約14年でサインを移動します' },
    { id: 'Pluto',   name: '冥王星', glyph: '♇' + T, note: '1サインに12〜30年ほど滞在します' },
  ];

  RH.BODY_BY_ID = Object.fromEntries(RH.BODIES.map((b) => [b.id, b]));

  /** 12サイン（0=牡羊座） */
  RH.SIGNS = [
    { name: '牡羊座', short: '牡羊', glyph: '♈' + T },
    { name: '牡牛座', short: '牡牛', glyph: '♉' + T },
    { name: '双子座', short: '双子', glyph: '♊' + T },
    { name: '蟹座',   short: '蟹',   glyph: '♋' + T },
    { name: '獅子座', short: '獅子', glyph: '♌' + T },
    { name: '乙女座', short: '乙女', glyph: '♍' + T },
    { name: '天秤座', short: '天秤', glyph: '♎' + T },
    { name: '蠍座',   short: '蠍',   glyph: '♏' + T },
    { name: '射手座', short: '射手', glyph: '♐' + T },
    { name: '山羊座', short: '山羊', glyph: '♑' + T },
    { name: '水瓶座', short: '水瓶', glyph: '♒' + T },
    { name: '魚座',   short: '魚',   glyph: '♓' + T },
  ];

  /** 観測地プリセット（国内主要10都市） */
  RH.LOCATIONS = [
    { id: 'sapporo',   name: '札幌',   region: '北海道', lat: 43.0642, lon: 141.3469 },
    { id: 'sendai',    name: '仙台',   region: '東北',   lat: 38.2682, lon: 140.8694 },
    { id: 'tokyo',     name: '東京',   region: '関東',   lat: 35.6895, lon: 139.6917 },
    { id: 'kanazawa',  name: '金沢',   region: '北陸',   lat: 36.5947, lon: 136.6256 },
    { id: 'nagoya',    name: '名古屋', region: '中部',   lat: 35.1815, lon: 136.9066 },
    { id: 'kyoto',     name: '京都',   region: '近畿',   lat: 35.0116, lon: 135.7681 },
    { id: 'osaka',     name: '大阪',   region: '近畿',   lat: 34.6937, lon: 135.5023 },
    { id: 'hiroshima', name: '広島',   region: '中国',   lat: 34.3963, lon: 132.4594 },
    { id: 'fukuoka',   name: '福岡',   region: '九州',   lat: 33.5904, lon: 130.4017 },
    { id: 'naha',      name: '那覇',   region: '沖縄',   lat: 26.2124, lon: 127.6809 },
  ];
  RH.DEFAULT_LOCATION_ID = 'tokyo';
  RH.LOCATION_BY_ID = Object.fromEntries(RH.LOCATIONS.map((l) => [l.id, l]));
  RH.LOCATION = RH.LOCATION_BY_ID[RH.DEFAULT_LOCATION_ID];

  /** 探索年代チャンク（300年区切り） */
  RH.CHUNKS = [
    { id: '1800-2100', label: '1800 – 2100年', startYear: 1800, endYear: 2100 },
    { id: '1500-1799', label: '1500 – 1799年', startYear: 1500, endYear: 1799 },
    { id: '1200-1499', label: '1200 – 1499年', startYear: 1200, endYear: 1499 },
  ];
  RH.DEFAULT_CHUNK_ID = '1800-2100';
  RH.CHUNK_BY_ID = Object.fromEntries(RH.CHUNKS.map((c) => [c.id, c]));

  /** 標準時プリセット */
  RH.TIMEZONES = [
    { id: 'jst', name: '日本標準時 (JST)', offsetHours: 9 },
  ];
  RH.DEFAULT_TIMEZONE_ID = 'jst';
  RH.TIMEZONE_BY_ID = Object.fromEntries(RH.TIMEZONES.map((tz) => [tz.id, tz]));

  /** 条件のモード */
  RH.MODE = { REQUIRED: 'required', PREFERRED: 'preferred' };

  /** メジャーアスペクト（5種） */
  RH.ASPECTS = [
    { id: 'conjunction', name: '合',     angle: 0,   deg: 0,   glyph: '☌' + T, symbol: '☌', label: '合 0°',   formalLabel: 'コンジャンクション', kind: 'conj' },
    { id: 'sextile',     name: '六分',   angle: 60,  deg: 60,  glyph: '⚹' + T, symbol: '⚹', label: '六分 60°', formalLabel: 'セクスタイル',       kind: 'soft' },
    { id: 'square',      name: '四分',   angle: 90,  deg: 90,  glyph: '□' + T, symbol: '□', label: '四分 90°', formalLabel: 'スクエア',           kind: 'hard' },
    { id: 'trine',       name: '三分',   angle: 120, deg: 120, glyph: '△' + T, symbol: '△', label: '三分 120°', formalLabel: 'トライン',           kind: 'soft' },
    { id: 'opposition',  name: '衝',     angle: 180, deg: 180, glyph: '☍' + T, symbol: '☍', label: '衝 180°', formalLabel: 'オポジション',       kind: 'hard' },
  ];

  RH.ASPECT_BY_ID = Object.fromEntries(RH.ASPECTS.map((a) => [a.id, a]));
  RH.MAJOR_ASPECT_DEFS = RH.ASPECTS;

  /** ネイタルチャートのアスペクト表・解釈用オーブ基準（度） */
  RH.GRID_ORB = {
    LIGHTS: 8.0, // 太陽・月を含むペア
    OTHERS: 6.0, // その他の天体同士
  };

  /** オーブ（許容度数） */
  RH.ORBS = [
    { id: 'tight',  name: 'タイト (±3°)', value: 3 },
    { id: 'normal', name: '標準 (±6°)',   value: 6 },
    { id: 'wide',   name: 'ワイド (±8°)', value: 8 },
  ];

  RH.ORB_BY_ID = Object.fromEntries(RH.ORBS.map((o) => [o.id, o]));
})((window.RH = window.RH || {}));

