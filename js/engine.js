// =============================================================
// 逆引きエンジン（期間リストの重ね合わせ）
//
// 考え方:
//   ・各条件（例: 金星が牡牛座）を「条件を満たす期間のリスト」に変換する
//   ・必須条件   → 期間リスト同士の共通部分（AND）をとる
//   ・できれば条件 → 必須条件で残った期間を時系列になぞり、満たす条件の数を数える
//
// 時刻はすべて「エポック（1900-01-01 00:00 JST）からの経過分」の整数で扱う。
// 期間は半開区間 [開始, 終了) の配列 [[s, e], ...]（開始時刻の昇順・重なりなし）。
// =============================================================
(function (root) {
  'use strict';
  const RH = (root.RH = root.RH || {});

  /** 2つの期間リストの共通部分 */
  function intersect(A, B) {
    const out = [];
    let i = 0;
    let j = 0;
    while (i < A.length && j < B.length) {
      const s = A[i][0] > B[j][0] ? A[i][0] : B[j][0];
      const e = A[i][1] < B[j][1] ? A[i][1] : B[j][1];
      if (s < e) out.push([s, e]);
      if (A[i][1] < B[j][1]) i++;
      else j++;
    }
    return out;
  }

  /**
   * エンジンを生成する
   * @param {object} data  window.RH_EPHEMERIS（tools/generate-ephemeris.mjs の出力）
   */
  function createEngine(data) {
    const RANGE = data.rangeMinutes;
    const partition = {}; // 天体ごとの全期間 [{s, e, sign}]（隙間なく全期間を覆う）
    const bySign = {};    // 天体ごと・サインごとの期間リスト [[s, e], ...]

    for (const [body, d] of Object.entries(data.bodies)) {
      const segs = [];
      const signs = Array.from({ length: 12 }, () => []);
      let start = 0;
      let sign = d.s0;
      for (let i = 0; i <= d.t.length; i++) {
        const end = i < d.t.length ? d.t[i] : RANGE;
        segs.push({ s: start, e: end, sign });
        signs[sign].push([start, end]);
        start = end;
        sign = d.s[i];
      }
      partition[body] = segs;
      bySign[body] = signs;
    }

    /**
     * 必須条件の共通部分（excludeBody を指定するとその天体の条件を除いて計算）
     * 期間数が少ないリスト（＝動きの遅い天体）から順に重ねることで、
     * 「遅い星から絞り込む」階層的フィルタリングと同じ効果を得る。
     */
    function requiredIntersection(conds, excludeBody) {
      const lists = conds
        .filter((c) => c.mode === 'required' && c.body !== excludeBody)
        .map((c) => bySign[c.body][c.sign])
        .sort((a, b) => a.length - b.length);
      let cur = [[0, RANGE]];
      for (const list of lists) {
        cur = intersect(cur, list);
        if (cur.length === 0) break;
      }
      return cur;
    }

    /**
     * 指定天体の各サインについて「そのサインを必須条件に加えたら何期間残るか」を数える。
     * （その天体自身の現在の条件は除外して計算する）
     * → 0 のサインは、他の必須条件と同時には成立しない＝選べない配置。
     */
    function signCounts(conds, body) {
      const base = requiredIntersection(conds, body);
      const segs = partition[body];
      const counts = new Array(12).fill(0);
      let i = 0;
      let j = 0;
      while (i < base.length && j < segs.length) {
        const s = Math.max(base[i][0], segs[j].s);
        const e = Math.min(base[i][1], segs[j].e);
        if (s < e) counts[segs[j].sign]++;
        if (base[i][1] < segs[j].e) i++;
        else j++;
      }
      return counts;
    }

    /**
     * 検索本体
     * @param {Array<{body:string, sign:number, mode:string}>} signConds
     * @param {Array<{body1:string, body2:string, targetAngle:number, orb:number, mode:string}>} aspectConds
     * @returns {{segments: Array<{s,e,mask,matched}>, preferred: Array}}
     *   mask: できれば条件のうち満たしているもののビット（preferred の並び順）
     */
    function search(signConds, aspectConds = []) {
      let req = requiredIntersection(signConds, null);

      // 必須アスペクト条件の適用（絞られた必須期間に対して計算）
      const reqAspects = aspectConds.filter((a) => a.mode === 'required');
      if (RH.findAspectIntervals) {
        for (const a of reqAspects) {
          if (req.length === 0) break;
          const aspIntervals = RH.findAspectIntervals(
            a.body1, a.body2, a.targetAngle, a.orb, req, data.epochUtcMs
          );
          req = intersect(req, aspIntervals);
        }
      }

      // できれば条件の収集
      const prefSigns = signConds.filter((c) => c.mode === 'preferred');
      const prefAspects = aspectConds.filter((a) => a.mode === 'preferred');
      const preferred = [...prefSigns, ...prefAspects];

      if (preferred.length === 0) {
        return { segments: req.map(([s, e]) => ({ s, e, mask: 0, matched: 0 })), preferred };
      }

      // 各「できれば条件」を必須期間の中に切り詰めておく
      const clips = [];
      for (const c of prefSigns) {
        clips.push(intersect(req, bySign[c.body][c.sign]));
      }
      if (RH.findAspectIntervals) {
        for (const a of prefAspects) {
          if (req.length === 0) {
            clips.push([]);
          } else {
            const aspIntervals = RH.findAspectIntervals(
              a.body1, a.body2, a.targetAngle, a.orb, req, data.epochUtcMs
            );
            clips.push(intersect(req, aspIntervals));
          }
        }
      }

      // 境界点（必須期間と各条件期間の端点）を時系列に並べる＝スイープライン
      let n = req.length * 2;
      for (const c of clips) n += c.length * 2;
      const pts = new Float64Array(n);
      let k = 0;
      for (const [s, e] of req) { pts[k++] = s; pts[k++] = e; }
      for (const c of clips) for (const [s, e] of c) { pts[k++] = s; pts[k++] = e; }
      pts.sort();

      const segments = [];
      const ptr = new Array(clips.length).fill(0);
      let ri = 0;
      let prev = null;
      for (let p = 0; p < pts.length - 1; p++) {
        const x = pts[p];
        const y = pts[p + 1];
        if (x === y) continue;
        while (ri < req.length && req[ri][1] <= x) ri++;
        if (ri >= req.length) break;
        if (req[ri][0] > x) continue; // 必須条件を満たさない隙間

        let mask = 0;
        let matched = 0;
        for (let c = 0; c < clips.length; c++) {
          const list = clips[c];
          while (ptr[c] < list.length && list[ptr[c]][1] <= x) ptr[c]++;
          if (ptr[c] < list.length && list[ptr[c]][0] <= x) {
            mask |= 1 << c;
            matched++;
          }
        }
        // 直前と連続していて満たす条件も同じなら結合する
        if (prev && prev.e === x && prev.mask === mask) {
          prev.e = y;
        } else {
          prev = { s: x, e: y, mask, matched };
          segments.push(prev);
        }
      }
      return { segments, preferred };
    }

    return {
      range: RANGE,
      epochUtcMs: data.epochUtcMs,
      tzOffsetMinutes: data.tzOffsetMinutes,
      partition,
      bySign,
      search,
      signCounts,
      requiredIntersection,
    };
  }

  RH.intersect = intersect;
  RH.createEngine = createEngine;
})(typeof window !== 'undefined' ? window : globalThis);
