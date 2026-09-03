import type { PlacedUnit, Shortfall, SolveRequest, SolveResult } from "./types";

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REASON_LABELS = [
  "교사 회피 시간",
  "교사가 다른 학급 수업 중",
  "학급이 이미 꽉 참",
  "특별실 사용 중",
  "그 요일에 같은 과목이 이미 있음",
];

/** 미배치 한 칸의 가중치 — 충돌 하나보다 크게 두어 되도록 다 채우게 한다. */
const UNPLACED_PENALTY = 5;

/**
 * 국소 탐색(min-conflicts + 퇴출 이동)으로 시간표를 배치한다.
 *
 * 항상 지켜지는 불변식
 *  - 한 학급은 한 교시에 한 수업만 (학급 격자에 직접 배치하므로 구조적으로 보장)
 *  - 연속 2교시 블록은 붙어 있는 두 교시에만
 *
 * 비용으로 다루다가 0으로 몰아가는 제약
 *  - 교사 동시간 중복 / 교사 회피 시간 / 특별실 중복 / 같은 과목 하루 1회
 *
 * 시간 안에 0으로 만들지 못하면, 충돌에 가장 많이 얽힌 수업부터 빼내어
 * "충돌 없는 시간표 + 미배치 목록"으로 돌려준다.
 */
export function solve(
  req: SolveRequest,
  onProgress?: (restarts: number, conflicts: number, totalUnits: number, ms: number) => void,
): SolveResult {
  const D = req.dayCount;
  const P = req.periodCount;
  const S = D * P;
  const started = Date.now();
  const deadline = started + req.timeLimitMs;

  const lectures = req.lectures;
  const L = lectures.length;
  const T = Math.max(1, req.teacherIds.length);
  const C = Math.max(1, req.classIds.length);
  const R = Math.max(1, req.roomIds.length);

  if (L === 0 || S === 0 || req.classIds.length === 0) {
    return {
      ok: false,
      placed: [],
      shortfalls: [],
      elapsedMs: 0,
      restarts: 0,
      message: "배치할 수업이 없습니다.",
    };
  }

  const teacherIdx = new Map(req.teacherIds.map((id, i) => [id, i]));
  const classIdx = new Map(req.classIds.map((id, i) => [id, i]));
  const roomIdx = new Map(req.roomIds.map((id, i) => [id, i]));

  // ── 배치 단위(unit): 블록은 길이 2, 나머지는 길이 1 ──
  const uLec: number[] = [];
  const uLen: number[] = [];
  for (let i = 0; i < L; i++) {
    const lec = lectures[i];
    const blocks = Math.max(0, Math.min(lec.blocks, Math.floor(lec.hours / 2)));
    for (let b = 0; b < blocks; b++) {
      uLec.push(i);
      uLen.push(2);
    }
    for (let h = 0; h < lec.hours - blocks * 2; h++) {
      uLec.push(i);
      uLen.push(1);
    }
  }
  const U = uLec.length;
  const unitLec = new Int32Array(uLec);
  const unitLen = new Int32Array(uLen);
  const unitClass = new Int32Array(U);
  const unitTeacher = new Int32Array(U);
  const unitRoom = new Int32Array(U);
  for (let u = 0; u < U; u++) {
    const lec = lectures[unitLec[u]];
    unitClass[u] = classIdx.get(lec.classId) ?? 0;
    unitTeacher[u] = teacherIdx.get(lec.teacherId) ?? 0;
    unitRoom[u] = lec.roomId ? (roomIdx.get(lec.roomId) ?? -1) : -1;
  }

  const classUnits: number[][] = Array.from({ length: C }, () => []);
  for (let u = 0; u < U; u++) classUnits[unitClass[u]].push(u);

  // ── 길이별로 시작 가능한 슬롯 목록 ──
  const starts: Int32Array[] = [];
  for (const len of [1, 2]) {
    const list: number[] = [];
    for (let d = 0; d < D; d++) {
      for (let p = 0; p + len <= P; p++) {
        if (len === 2 && !req.blockable[p]) continue;
        list.push(d * P + p);
      }
    }
    starts.push(new Int32Array(list));
  }
  const validStart = [new Uint8Array(S), new Uint8Array(S)];
  for (let i = 0; i < 2; i++) for (const s of starts[i]) validStart[i][s] = 1;

  // ── 상태 ──
  const cellOwner = new Int32Array(C * S).fill(-1);
  const teacherUse = new Int32Array(T * S);
  const roomUse = new Int32Array(R * S);
  const lecDay = new Int32Array(L * D);
  const blockedFlat = new Uint8Array(T * S);
  for (let t = 0; t < req.teacherIds.length; t++) {
    const row = req.teacherBlocked[t];
    if (!row) continue;
    for (let s = 0; s < S; s++) if (row[s]) blockedFlat[t * S + s] = 1;
  }
  const pos = new Int32Array(U).fill(-1);
  let cost = 0;
  let unplaced = U;

  const addUnit = (u: number, s: number) => {
    const c = unitClass[u];
    const t = unitTeacher[u];
    const r = unitRoom[u];
    const li = unitLec[u];
    const len = unitLen[u];
    for (let k = 0; k < len; k++) {
      const q = s + k;
      cellOwner[c * S + q] = u;
      if (teacherUse[t * S + q]++ >= 1) cost++;
      if (r >= 0 && roomUse[r * S + q]++ >= 1) cost++;
      if (blockedFlat[t * S + q]) cost++;
    }
    if (lecDay[li * D + ((s / P) | 0)]++ >= 1) cost++;
    pos[u] = s;
    unplaced--;
  };

  const removeUnit = (u: number) => {
    const s = pos[u];
    if (s < 0) return;
    const c = unitClass[u];
    const t = unitTeacher[u];
    const r = unitRoom[u];
    const li = unitLec[u];
    const len = unitLen[u];
    for (let k = 0; k < len; k++) {
      const q = s + k;
      cellOwner[c * S + q] = -1;
      if (--teacherUse[t * S + q] >= 1) cost--;
      if (r >= 0 && --roomUse[r * S + q] >= 1) cost--;
      if (blockedFlat[t * S + q]) cost--;
    }
    if (--lecDay[li * D + ((s / P) | 0)] >= 1) cost--;
    pos[u] = -1;
    unplaced++;
  };

  const conflictOf = (u: number): number => {
    const s = pos[u];
    if (s < 0) return UNPLACED_PENALTY;
    const t = unitTeacher[u];
    const r = unitRoom[u];
    const len = unitLen[u];
    let n = 0;
    for (let k = 0; k < len; k++) {
      const q = s + k;
      if (teacherUse[t * S + q] > 1) n++;
      if (r >= 0 && roomUse[r * S + q] > 1) n++;
      if (blockedFlat[t * S + q]) n++;
    }
    if (lecDay[unitLec[u] * D + ((s / P) | 0)] > 1) n++;
    return n;
  };

  let rnd = mulberry32(req.seed);

  /**
   * v 를 자기 학급의 빈 자리 중 비용이 가장 낮은 곳에 놓는다.
   * prefer 는 먼저 살펴볼 자리(보통 방금 비워진 칸) — 자리 맞바꾸기가 여기서 나온다.
   */
  const placeBest = (v: number, prefer: number): number => {
    const len = unitLen[v];
    const c = unitClass[v];
    const list = starts[len - 1];
    let bestS = -1;
    let bestC = Number.MAX_SAFE_INTEGER;
    const tryAt = (s: number) => {
      for (let k = 0; k < len; k++) if (cellOwner[c * S + s + k] !== -1) return;
      addUnit(v, s);
      const c2 = cost;
      removeUnit(v);
      if (c2 < bestC || (c2 === bestC && rnd() < 0.4)) {
        bestC = c2;
        bestS = s;
      }
    };
    if (prefer >= 0 && validStart[len - 1][prefer]) tryAt(prefer);
    const n = list.length;
    if (n > 0) {
      const off = (rnd() * n) | 0;
      const limit = n <= 60 ? n : 24;
      for (let i = 0; i < limit; i++) tryAt(list[(i + off) % n]);
    }
    if (bestS >= 0) addUnit(v, bestS);
    return bestS;
  };

  // ── 초기 배치: 블록부터, 같은 과목이 같은 요일에 겹치지 않도록 ──
  const shuffle = (arr: number[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };

  const buildInitial = () => {
    for (let u = 0; u < U; u++) removeUnit(u);
    cellOwner.fill(-1);
    for (let c = 0; c < C; c++) {
      const list = [...classUnits[c]];
      shuffle(list);
      list.sort((a, b) => unitLen[b] - unitLen[a]);
      for (const u of list) {
        const len = unitLen[u];
        const li = unitLec[u];
        const cand = starts[len - 1];
        let chosen = -1;
        let fallback = -1;
        const off = (rnd() * cand.length) | 0;
        for (let i = 0; i < cand.length; i++) {
          const s = cand[(i + off) % cand.length];
          let free = true;
          for (let k = 0; k < len; k++)
            if (cellOwner[c * S + s + k] !== -1) {
              free = false;
              break;
            }
          if (!free) continue;
          if (fallback < 0) fallback = s;
          if (lecDay[li * D + ((s / P) | 0)] === 0) {
            chosen = s;
            break;
          }
        }
        const s = chosen >= 0 ? chosen : fallback;
        if (s >= 0) addUnit(u, s);
      }
    }
  };

  // ── 이동(퇴출 포함) ──
  const evBuf = new Int32Array(2);
  const evOld = new Int32Array(2);
  const evNew = new Int32Array(2);
  let evN = 0;
  let movedOld = -1;

  /** u 를 s2 로 옮긴다. 자리 주인은 빈칸으로 옮겨 준다. 불가능하면 원상복구 후 false. */
  const doMove = (u: number, s2: number): boolean => {
    const c = unitClass[u];
    const len = unitLen[u];
    evN = 0;
    for (let k = 0; k < len; k++) {
      const o = cellOwner[c * S + s2 + k];
      if (o >= 0 && o !== u && (evN === 0 || evBuf[0] !== o)) {
        evBuf[evN] = o;
        evOld[evN] = pos[o];
        evN++;
      }
    }
    movedOld = pos[u];
    removeUnit(u);
    for (let i = 0; i < evN; i++) removeUnit(evBuf[i]);
    addUnit(u, s2);
    // 길이 2 부터 다시 넣어야 자리가 남는다.
    if (evN === 2 && unitLen[evBuf[1]] > unitLen[evBuf[0]]) {
      [evBuf[0], evBuf[1]] = [evBuf[1], evBuf[0]];
      [evOld[0], evOld[1]] = [evOld[1], evOld[0]];
    }
    for (let i = 0; i < evN; i++) {
      const v = evBuf[i];
      const s3 = placeBest(v, movedOld);
      if (s3 < 0) {
        for (let j = 0; j < i; j++) removeUnit(evBuf[j]);
        removeUnit(u);
        if (movedOld >= 0) addUnit(u, movedOld);
        for (let j = 0; j < evN; j++) if (evOld[j] >= 0) addUnit(evBuf[j], evOld[j]);
        return false;
      }
      evNew[i] = s3;
    }
    return true;
  };

  const undoMove = (u: number) => {
    for (let i = 0; i < evN; i++) removeUnit(evBuf[i]);
    removeUnit(u);
    if (movedOld >= 0) addUnit(u, movedOld);
    for (let i = 0; i < evN; i++) if (evOld[i] >= 0) addUnit(evBuf[i], evOld[i]);
  };

  // ── 탐색 ──
  const bestPos = new Int32Array(U).fill(-1);
  let bestScore = Number.MAX_SAFE_INTEGER;
  let restarts = 0;
  const CANDIDATES = S <= 80 ? S : 32;

  const score = () => cost + unplaced * UNPLACED_PENALTY;

  const snapshot = () => {
    const sc = score();
    if (sc < bestScore) {
      bestScore = sc;
      bestPos.set(pos);
      return true;
    }
    return false;
  };

  const restoreBest = () => {
    for (let u = 0; u < U; u++) removeUnit(u);
    cellOwner.fill(-1);
    for (let u = 0; u < U; u++) if (bestPos[u] >= 0) addUnit(u, bestPos[u]);
  };

  /** 평지에 갇히면 몇 수를 아무렇게나 두어 흔든다. */
  const kick = (n: number) => {
    for (let i = 0; i < n; i++) {
      const u = (rnd() * U) | 0;
      const list = starts[unitLen[u] - 1];
      if (list.length === 0) continue;
      doMove(u, list[(rnd() * list.length) | 0]);
    }
  };

  buildInitial();
  snapshot();

  let iter = 0;
  let sinceImprove = 0;
  let kicks = 0;
  while (bestScore > 0) {
    if ((iter & 1023) === 0 && Date.now() > deadline) break;
    iter++;

    // 충돌하고 있는 단위 하나 고르기
    let u = -1;
    for (let tries = 0; tries < 40; tries++) {
      const cand = (rnd() * U) | 0;
      if (conflictOf(cand) > 0) {
        u = cand;
        break;
      }
    }
    if (u < 0) {
      for (let v = 0; v < U; v++)
        if (conflictOf(v) > 0) {
          u = v;
          break;
        }
      if (u < 0) {
        snapshot();
        break;
      }
    }

    const list = starts[unitLen[u] - 1];
    if (list.length === 0) {
      sinceImprove++;
      continue;
    }
    let bestDelta = Number.MAX_SAFE_INTEGER;
    let bestS = -1;
    const before = score();
    const walk = rnd() < 0.08;
    const off = (rnd() * list.length) | 0;
    for (let i = 0; i < CANDIDATES; i++) {
      const s2 = list[(i + off) % list.length];
      if (s2 === pos[u]) continue;
      if (!doMove(u, s2)) continue;
      const delta = score() - before;
      undoMove(u);
      if (delta < bestDelta || (delta === bestDelta && rnd() < 0.5)) {
        bestDelta = delta;
        bestS = s2;
      }
      if (walk) break; // 가끔은 아무 데나 (평지 탈출)
    }
    if (bestS >= 0 && doMove(u, bestS)) {
      if (snapshot()) sinceImprove = 0;
      else sinceImprove++;
    } else {
      sinceImprove++;
    }

    if (sinceImprove > 900) {
      sinceImprove = 0;
      kicks++;
      if (kicks % 120 === 0) {
        // 오래 못 벗어나면 완전히 새로 시작한다.
        restarts++;
        onProgress?.(restarts, bestScore, U, Date.now() - started);
        rnd = mulberry32(req.seed + restarts * 7919);
        buildInitial();
      } else {
        restoreBest();
        kick(4 + ((rnd() * 8) | 0));
      }
    }
  }

  // ── 가장 좋았던 해로 되돌리고, 남은 충돌은 수업을 빼내어 해소 ──
  restoreBest();

  let guard = U + 1;
  while (cost > 0 && guard-- > 0) {
    let worst = -1;
    let worstN = 0;
    for (let u = 0; u < U; u++) {
      if (pos[u] < 0) continue;
      const n = conflictOf(u);
      if (n > worstN) {
        worstN = n;
        worst = u;
      }
    }
    if (worst < 0) break;
    removeUnit(worst);
  }

  const placed: PlacedUnit[] = [];
  for (let u = 0; u < U; u++) {
    const s = pos[u];
    if (s < 0) continue;
    placed.push({
      lectureIndex: unitLec[u],
      day: (s / P) | 0,
      period: s % P,
      length: unitLen[u],
    });
  }

  const ok = unplaced === 0 && cost === 0;
  const shortfalls = ok ? [] : diagnose();

  return {
    ok,
    placed,
    shortfalls,
    elapsedMs: Date.now() - started,
    restarts,
    message: ok
      ? "모든 시수를 충돌 없이 배치했습니다."
      : "일부 시수를 배치하지 못했습니다. 시간을 늘려 다시 시도하거나, 아래 원인을 보고 조건을 완화하세요.",
  };

  /** 남은 미배치 단위가 왜 못 들어갔는지 자리별로 센다. */
  function diagnose(): Shortfall[] {
    const missing = new Map<number, { hours: number; counts: number[] }>();
    for (let u = 0; u < U; u++) {
      if (pos[u] >= 0) continue;
      const li = unitLec[u];
      const len = unitLen[u];
      let entry = missing.get(li);
      if (!entry) {
        entry = { hours: 0, counts: [0, 0, 0, 0, 0] };
        missing.set(li, entry);
      }
      entry.hours += len;

      const t = unitTeacher[u];
      const c = unitClass[u];
      const r = unitRoom[u];
      const list = starts[len - 1];
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (lecDay[li * D + ((s / P) | 0)] > 0) {
          entry.counts[4]++;
          continue;
        }
        let hit = -1;
        for (let k = 0; k < len && hit < 0; k++) {
          const q = s + k;
          if (blockedFlat[t * S + q]) hit = 0;
          else if (teacherUse[t * S + q] > 0) hit = 1;
          else if (cellOwner[c * S + q] >= 0) hit = 2;
          else if (r >= 0 && roomUse[r * S + q] > 0) hit = 3;
        }
        if (hit >= 0) entry.counts[hit]++;
      }
    }

    return [...missing.entries()].map(
      ([lectureIndex, e]): Shortfall => ({
        lectureIndex,
        missingHours: e.hours,
        reasons: e.counts
          .map((count, i) => ({ label: REASON_LABELS[i], count }))
          .filter((x) => x.count > 0)
          .sort((a, b) => b.count - a.count),
      }),
    );
  }
}
