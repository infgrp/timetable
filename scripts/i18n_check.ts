/**
 * 영어 화면 검사 — npm run i18n:check
 *   1) 보기·연결·올리기 화면에서 t("…") 로 쓰는 한국어 문장이 영어 표에 모두 있는가
 *   2) 요일·교시·점심·구간 이름 바꾸기
 *   3) 영어로 그린 시간표 보기 화면에 한국어 화면 문구가 남지 않는가 (입력 자료의 이름은 제외)
 *   4) 영어 엑셀 머리글
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EN, StaticLang, dayEn, localizeData, segmentEn, slotLabelEn, translate } from "../src/i18n";
import { sampleData } from "../src/sample";
import { fromSolveResult } from "../src/assignments";
import { buildSolveRequest } from "../src/store";
import { solve } from "../src/solver";
import { toSheet } from "../src/timetableSheet";
import { buildGrids } from "../src/assignments";
import ViewerPanel from "../src/components/ViewerPanel";
import { ConnectCard } from "../src/components/SharedPanel";

let count = 0;
function check(name: string, run: () => void) {
  run();
  console.log(`  ok   ${name}`);
  count++;
}
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const hangul = /[가-힣]/;

check("화면에서 옮기는 문장은 모두 영어 표에 있다", () => {
  const files = ["src/App.tsx", "src/components/ViewerPanel.tsx", "src/components/SharedPanel.tsx", "src/components/Timetable.tsx", "src/shared.ts"];
  const keys = new Set<string>();
  for (const f of files) {
    const text = src(f);
    for (const m of text.matchAll(/\bt\(\s*"([^"]+)"/g)) keys.add(m[1]);
    for (const m of text.matchAll(/translate\(\s*lang\s*,\s*"([^"]+)"/g)) keys.add(m[1]);
    for (const m of text.matchAll(/ApiError\(\s*"([^"]+)"/g)) keys.add(m[1]);
  }
  // ViewerPanel 의 구분 이름표
  for (const m of src("src/components/ViewerPanel.tsx").matchAll(/(?:class|teacher|room): "([^"]+)"/g)) keys.add(m[1]);
  const missing = [...keys].filter((k) => hangul.test(k) && EN[k] === undefined);
  assert.deepEqual(missing, []);
  assert.ok(keys.size > 60, `문장 ${keys.size}개`);

  // center-today 서버가 보내는 오류 문구 중 시간표 화면에 닿는 것
  const worker = new URL("../../center-today/src/worker.js", import.meta.url);
  if (existsSync(worker)) {
    const text = readFileSync(worker, "utf8");
    const timetableApi = text.slice(text.indexOf("async function timetableApi"), text.indexOf("export default"));
    const needed = [...timetableApi.matchAll(/'([^'\n]*[가-힣][^'\n]*)'/g)].map((m) => m[1]);
    assert.deepEqual(needed.filter((k) => EN[k] === undefined), []);
  }
});

check("요일·교시·점심·구간 이름", () => {
  assert.deepEqual(["월", "화", "수요일", "Mon", "월화"].map(dayEn), ["Mon", "Tue", "Wed", "Mon", "월화"]);
  assert.deepEqual(["1교시", "12 교시", "점심시간", "쉬는 시간", "Orientation"].map(slotLabelEn), ["Period 1", "Period 12", "Lunch", "Break", "Orientation"]);
  assert.equal(segmentEn("월·화"), "Mon·Tue");
  assert.equal(segmentEn("수·목·금 (4학년)"), "Wed·Thu·Fri (Grade 4)");
  assert.equal(segmentEn("월~수"), "Mon~Wed");
  assert.equal(segmentEn("화요일반"), "화요일반", "요일 글자가 낱말 속에 있으면 그대로");
  assert.equal(segmentEn("LOW"), "LOW");
  assert.equal(translate("en", "주 {used}시간", { used: 1 }), "1 hour/week");
  assert.equal(translate("en", "주 {used}시간", { used: 16 }), "16 hours/week");
  assert.equal(translate("ko", "주 {used}시간", { used: 16 }), "주 16시간");
});

// 예시 자료에 구간·하루 구성·센터 영어 이름을 얹어 영어 화면을 그린다.
const base = sampleData();
const req = buildSolveRequest(base, { seed: 1, timeLimitMs: 1000, reserved: [] });
const data = {
  ...base,
  schoolNameEn: "Sample English Center",
  timetable: fromSolveResult(solve(req), req.lectures),
  segments: [
    { id: "s1", name: "월·화", days: [0, 1] },
    { id: "s2", name: "수·목·금 (4학년)", days: [2, 3, 4] },
  ],
};

check("localizeData — 하루 구성 키도 요일과 함께 바뀐다", () => {
  const withDaily = { ...data, daySlots: { 수: data.slots.slice(0, 3) } };
  const en = localizeData(withDaily, "en");
  assert.deepEqual(Object.keys(en.daySlots ?? {}), ["Wed"]);
  assert.equal(en.daySlots!.Wed[0].label, slotLabelEn(data.slots[0].label));
  assert.equal(en.schoolName, "Sample English Center");
  assert.equal(localizeData(withDaily, "ko"), withDaily, "한국어면 원본 그대로");
  assert.equal(localizeData({ ...data, schoolNameEn: "" }, "en").schoolName, "", "영어 이름이 없으면 센터 이름을 붙이지 않는다");
});

/** 입력 자료에서 온 이름(반·강사·존·프로그램)은 한국어일 수 있으니 빼고 본다 */
function leftovers(html: string): string[] {
  const names = [
    ...data.classes.map((x) => x.name),
    ...data.teachers.map((x) => x.name),
    ...data.rooms.map((x) => x.name),
    ...data.timetable.map((a) => a.subject),
    ...data.timetable.map((a) => a.teacherSubject ?? ""),
    ...data.fixedActivities.map((f) => f.name),
    ...(data.classGroups ?? []).map((g) => g.name),
  ].filter(Boolean);
  let text = html.replace(/<[^>]+>/g, " ");
  for (const n of names.sort((a, b) => b.length - a.length)) text = text.split(n).join(" ");
  return [...new Set(text.match(/[^\s]*[가-힣]+[^\s]*/g) ?? [])];
}

check("영어 시간표 보기 화면(첫 화면)에 한국어 화면 문구가 없다", () => {
  const html = renderToStaticMarkup(createElement(StaticLang, { lang: "en" }, createElement(ViewerPanel, { data, onBuild: () => {} })));
  assert.deepEqual(leftovers(html), []);
  for (const word of ["View by", "Download Excel", "Period", "Mon", "Mon·Tue", "Wed·Thu·Fri (Grade 4)", "Show all", "hours/week", "All days"]) assert.ok(html.includes(word), word);
  assert.ok(html.includes("Sample English Center"), "센터 영어 이름");
});

check("연결 카드 영어", () => {
  const html = renderToStaticMarkup(createElement(StaticLang, { lang: "en" }, createElement(ConnectCard, { onConnect: () => {}, error: "공유 공간을 찾을 수 없습니다. 접속 코드를 확인해 주세요." })));
  assert.deepEqual(leftovers(html), []);
  assert.ok(html.includes("Shared space not found"));
});

check("한국어 화면은 그대로 (영어가 새지 않는다)", () => {
  const html = renderToStaticMarkup(createElement(StaticLang, { lang: "ko" }, createElement(ViewerPanel, { data, onBuild: () => {} })));
  for (const word of ["구분", "엑셀로 받기", "교시", "월·화"]) assert.ok(html.includes(word), word);
  for (const word of ["View by", "Download Excel", "Mon·Tue"]) assert.ok(!html.includes(word), word);
});

check("영어 엑셀 머리글", () => {
  const en = localizeData(data, "en");
  const g = buildGrids(en, en.timetable);
  const sheet = toSheet({ sheetName: "A", title: "x", days: en.days, slots: en.slots, grid: g.byClass.get(en.classes[0].id)!, lang: "en" });
  const texts = sheet.rows.flat().map((c) => (c && typeof c === "object" && "text" in c ? String(c.text) : ""));
  assert.ok(texts.includes("Period"));
  assert.ok(texts.includes("Mon"));
  assert.ok(texts.some((x) => x.startsWith("Period 1")));
  assert.ok(!texts.some((x) => /교시|점심/.test(x)), texts.filter((x) => hangul.test(x)).join(","));
});

console.log(`\n${count}개 영어 화면 검사 통과`);
