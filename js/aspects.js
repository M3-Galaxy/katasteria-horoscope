// =============================================================
// アスペクト探索エンジン
//   サイン等で絞り込まれた期間リストの中で、指定された2天体の角度差が
//   「目標角度 ± オーブ」に入る期間を、可変ステップ法＋二分探索で高速に算出する。
// =============================================================
(function (root) {
  'use strict';
  const RH = (root.RH = root.RH || {});
  const M = RH.astroMath;

  /** 2天体の最大相対角速度（度/分）の見積もり */
  function maxRelSpeed(b1, b2) {
    if (b1 === 'Moon' || b2 === 'Moon') return 0.0125; // 約18°/日
    if (['Mercury', 'Venus', 'Sun', 'Mars'].includes(b1) || ['Mercury', 'Venus', 'Sun', 'Mars'].includes(b2)) {
      return 0.003; // 約4.3°/日
    }
    return 0.0004; // 約0.57°/日（外惑星同士）
  }

  /**
   * 指定した区間群の中で、body1 と body2 のアスペクト条件を満たす期間リストを求める
   * @param {string} body1 天体ID 1
   * @param {string} body2 天体ID 2
   * @param {number} targetAngle 目標角度（0, 60, 90, 120, 180）
   * @param {number} orb 許容度数（3, 6, 8 など）
   * @param {Array<[number, number]>} baseIntervals 探索対象の期間リスト [[s, e], ...]（分）
   * @param {number} epochUtcMs エポック時刻（UTCミリ秒）
   * @returns {Array<[number, number]>} 条件を満たす期間リスト [[s, e], ...]
   */
  function findAspectIntervals(body1, body2, targetAngle, orb, baseIntervals, epochUtcMs) {
    if (!baseIntervals || baseIntervals.length === 0) return [];
    if (body1 === body2) return [];

    const vMax = maxRelSpeed(body1, body2);
    const hasMoon = body1 === 'Moon' || body2 === 'Moon';
    const stepInside = hasMoon ? 30 : 120; // 条件成立中の歩進幅（分）
    const maxJump = hasMoon ? 240 : 1440;  // 条件不成立時の最大ジャンプ幅（分）

    // 内部の黄経計算
    function getDiff(m) {
      const utcMs = epochUtcMs + m * 60000;
      const l1 = RH.astro.longitude(body1, utcMs);
      const l2 = RH.astro.longitude(body2, utcMs);
      return M.aspectDiff(l1, l2, targetAngle);
    }

    function isMet(m) {
      return getDiff(m) <= orb;
    }

    // 二分探索で「条件不成立 → 条件成立」の境界を求める（精度2分）
    function bisectEntry(lo, hi) {
      while (hi - lo > 2) {
        const mid = Math.round((lo + hi) / 2);
        if (isMet(mid)) hi = mid;
        else lo = mid;
      }
      return hi;
    }

    // 二分探索で「条件成立 → 条件不成立」の境界を求める（精度2分）
    function bisectExit(lo, hi) {
      while (hi - lo > 2) {
        const mid = Math.round((lo + hi) / 2);
        if (isMet(mid)) lo = mid;
        else hi = mid;
      }
      return lo;
    }

    const out = [];

    for (const [segStart, segEnd] of baseIntervals) {
      if (segStart >= segEnd) continue;

      let t = segStart;
      let inInterval = isMet(t);
      let startT = inInterval ? t : 0;
      let prevT = t;

      while (t < segEnd) {
        prevT = t;
        const diff = getDiff(t);
        const met = diff <= orb;

        if (!inInterval && met) {
          // 不成立から成立へ切り替わった境界を二分探索
          inInterval = true;
          startT = bisectEntry(prevT, t);
        } else if (inInterval && !met) {
          // 成立から不成立へ切り替わった境界を二分探索
          inInterval = false;
          const endT = bisectExit(prevT, t);
          if (endT > startT) out.push([startT, endT]);
        }

        // 次のステップ時刻を算出
        if (met) {
          t += stepInside;
        } else {
          const distToOrb = diff - orb;
          let safeJump = Math.floor(distToOrb / vMax);
          safeJump = Math.max(15, Math.min(safeJump, maxJump));
          t += safeJump;
        }

        // 区間末尾を超えないよう調整
        if (t > segEnd) t = segEnd;

        // ちょうど末尾に到達したときの最終判定
        if (t === segEnd && t !== prevT) {
          const endMet = isMet(segEnd);
          if (!inInterval && endMet) {
            inInterval = true;
            startT = bisectEntry(prevT, segEnd);
          } else if (inInterval && !endMet) {
            inInterval = false;
            const endT = bisectExit(prevT, segEnd);
            if (endT > startT) out.push([startT, endT]);
          }
          break;
        }
      }

      if (inInterval && segEnd > startT) {
        out.push([startT, segEnd]);
      }
    }

    // 隣接または重複する区間をマージ
    return mergeIntervals(out);
  }

  /** 区間リストのマージ */
  function mergeIntervals(intervals) {
    if (intervals.length <= 1) return intervals;
    intervals.sort((a, b) => a[0] - b[0]);
    const merged = [intervals[0]];
    for (let i = 1; i < intervals.length; i++) {
      const cur = intervals[i];
      const last = merged[merged.length - 1];
      if (cur[0] <= last[1]) {
        last[1] = Math.max(last[1], cur[1]);
      } else {
        merged.push(cur);
      }
    }
    return merged;
  }

  RH.findAspectIntervals = findAspectIntervals;
})(typeof window !== 'undefined' ? window : globalThis);
