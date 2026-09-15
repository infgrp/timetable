import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AppData, DaySlot } from "./types";

/**
 * 한국어·영어 — center-today 와 같은 방식.
 *   한국어 문장이 곧 키다. 영어 표에 없으면 한국어가 그대로 보인다.
 *   언어 선택은 center-today 와 같은 localStorage 키(center-lang)에 둔다 — 같은 주소라 한쪽에서 바꾸면 둘 다 바뀐다.
 *   영어로 옮기는 범위: 시간표 보기·연결·공유에 올리기 화면과 시간표 격자·엑셀.
 *   시간표 구성하기(관리자 작업 화면)는 한국어로 둔다.
 */
export type Lang = "ko" | "en";
type Vars = Record<string, string | number>;
type Entry = string | ((v: Vars) => string);

const KEY = "center-lang";
const plural = (n: number | string, one: string, many: string) => (Number(n) === 1 ? one : many);

export const EN: Record<string, Entry> = {
  // 머리
  "시간표": "Timetable",
  "시간표 보기": "View timetable",
  "시간표 구성하기": "Build (admin)",
  "오늘 현황": "Today",
  "공유에 올리기": "Publish",
  "사용 설명서": "Manual (Korean)",
  "이 브라우저에만 저장됩니다. 서버로 전송되지 않습니다.": "Saved only in this browser. Nothing is sent to a server.",
  "공유 공간에 연결하면 관리자가 올린 시간표를 봅니다.": "Connect to your shared space to see the timetable the admin published.",
  "구성은 이 기기에 저장됩니다. 다 되면 공유에 올리세요.": "Your work is saved on this device. Publish it when it is ready.",
  "공유 시간표 · {ago} 올림": "Shared timetable · published {ago}",
  " · 연결 끊김, 마지막으로 받은 시간표": " · offline, showing the last timetable received",
  "아직 공유된 시간표가 없습니다. 이 기기에서 구성한 시간표를 보여 줍니다.": "No timetable has been published yet. Showing the one built on this device.",
  "시간표 구성 화면은 한국어로만 제공됩니다. 시간표 보기는 영어로 볼 수 있습니다.": "The build screens are available in Korean only. Viewing the timetable is fully in English.",
  "방금": "just now",
  "{n}분 전": (v) => `${v.n} ${plural(v.n, "minute", "minutes")} ago`,
  // 연결 카드
  "공유 시간표 연결": "Connect to the shared timetable",
  "센터 투데이에서 쓰는 공유 공간 접속 코드를 넣으면 관리자가 올린 시간표를 모두 같이 봅니다.": "Enter the shared space access code you use in Center Today to see the timetable the admin published.",
  "공유 공간 접속 코드": "Access code",
  "전달받은 48자리 코드": "The 48-character code you received",
  "연결": "Connect",
  "센터 투데이에서 연결하기": "Connect in Center Today",
  "48자리 접속 코드를 확인해 주세요.": "Check the 48-character access code.",
  // 올리기 창
  "시간표 공유에 올리기": "Publish the timetable",
  "올리면 이 공유 공간의 모든 사람이 이 시간표를 봅니다.": "Everyone in this shared space will see this timetable.",
  " 지금 공유 중: {summary} ({ago})": " Currently shared: {summary} ({ago})",
  " 아직 공유된 시간표가 없습니다.": " Nothing has been published yet.",
  "닫기": "Close",
  "무엇을 올릴까요?": "What do you want to publish?",
  "이 기기에서 구성한 시간표": "The timetable built on this device",
  "시간표설정 JSON 파일": "A timetable settings JSON file",
  "내보내기로 받은 파일을 고릅니다.": "Choose a file saved with Export.",
  "파일 고르기": "Choose file",
  "센터 공용 비밀번호": "Center password",
  "센터 공용 비밀번호를 넣어 주세요.": "Enter the center password.",
  "올릴 JSON 파일을 골라 주세요.": "Choose the JSON file to publish.",
  "시간표 설정 파일이 아닙니다.": "This is not a timetable settings file.",
  "파일을 읽지 못했습니다: {msg}": "Couldn’t read the file: {msg}",
  " 아래 버튼을 누르면 방금 받은 최신 시간표 위에 덮어씁니다.": " Press the button below to overwrite the latest timetable just received.",
  "취소": "Cancel",
  "올리는 중…": "Publishing…",
  "최신 시간표 위에 덮어쓰기": "Overwrite the latest timetable",
  "{school} · 체험반 {classes} · 강사 {teachers} · 배치된 수업 {cells}칸": "{school} · {classes} classes · {teachers} instructors · {cells} lessons placed",
  "이름 없음": "no name",
  // shared.ts · 서버 오류
  "서버 응답을 읽지 못했습니다. 사이트 연결을 확인해 주세요.": "Couldn’t read the server response. Check your connection to the site.",
  "요청을 처리하지 못했습니다.": "The request could not be completed.",
  "공유된 시간표를 읽지 못했습니다. 관리자에게 다시 올려 달라고 해 주세요.": "Couldn’t read the shared timetable. Ask the admin to publish it again.",
  "공유 서버에 연결하지 못했습니다. 마지막으로 받은 시간표를 보여 줍니다.": "Couldn’t reach the shared server. Showing the last timetable received.",
  "공유 공간 접속 코드를 확인해 주세요.": "Check the access code.",
  "공유 공간을 찾을 수 없습니다. 접속 코드를 확인해 주세요.": "Shared space not found. Check the access code.",
  "시간표를 올릴 수 있는 비밀번호가 아닙니다.": "That password can’t publish the timetable.",
  "다른 관리자가 먼저 시간표를 올렸습니다. 최신 시간표를 확인한 후 다시 올려 주세요.": "Another admin published a timetable first. Check the latest timetable, then publish again.",
  "시간표 설정 파일이 아닙니다. 시간표 앱의 내보내기로 받은 JSON 파일을 올려 주세요.": "This is not a timetable settings file. Upload the JSON file exported from the timetable app.",
  "허용되지 않은 요청입니다.": "Request not allowed.",
  "지원하지 않는 요청입니다.": "Unsupported request.",
  "공유 저장소를 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.": "Couldn’t connect to shared storage. Please try again shortly.",
  "공유 저장소에 연결하지 못했습니다. 입력은 유지되며 다시 시도할 수 있습니다.": "Couldn’t reach shared storage. Please try again.",
  "공유 자료는 1.8MB 이하여야 합니다.": "Shared data must be 1.8 MB or less.",
  "저장 버전 정보가 없습니다.": "Missing save version.",
  "JSON 요청만 지원합니다.": "Only JSON requests are supported.",
  "요청 형식이 올바르지 않습니다.": "Malformed request.",
  // 시간표 보기
  "구분": "View by",
  "체험반별": "Class",
  "강사별": "Instructor",
  "체험존별": "Zone",
  "체험반": "Classes",
  "강사": "Instructors",
  "체험존": "Zones",
  "엑셀로 받기": "Download Excel",
  "인쇄 / PDF": "Print / PDF",
  "구간": "Days",
  "전체 ({days})": "All days",
  "전체": "All days",
  "{n}개 선택": "{n} selected",
  "전체 보기": "Show all",
  "(이름없음)": "(unnamed)",
  "(이름없는 묶음)": "(unnamed group)",
  "{name} 강사": "{name}",
  "시간표{suffix}": "Timetable{suffix}",
  "{axis} {n}개": (v) => `${v.n} ${v.axis}`,
  "아직 시간표가 없습니다": "No timetable yet",
  "[시간표 구성하기]에서 자동으로 짜거나, 이미 쓰고 있는 엑셀을 올리거나, 손으로 채울 수 있습니다.": "An admin can build one under [Build]: automatically, from an existing Excel file, or by hand.",
  "시간표 구성하러 가기": "Go to Build",
  "로테이션 {n}번 적용된 시간표입니다": (v) => `Rotation applied ${v.n} ${plural(v.n, "time", "times")}`,
  " · 마지막: {note}": " · last: {note}",
  "이 구간의 운영 요일이 없습니다. [시간표 구성하기]에서 요일을 지정하세요.": "These days have no operating days set. An admin can set them under [Build].",
  "이 구간에 해당하는 {axis}이(가) 없습니다.": "No {axis} for these days.",
  "사용 {used}/{capacity}칸": "Used {used}/{capacity}",
  "주 {used}시간": (v) => `${v.used} ${plural(v.used, "hour", "hours")}/week`,
  " · 빈 칸 {n}": " · {n} empty",
  // 격자
  "교시": "Period",
};

/** center-today 와 같은 규칙: ?lang= → 저장값 → 브라우저 언어 */
function initialLang(): Lang {
  if (typeof window === "undefined") return "ko";
  try {
    const q = new URLSearchParams(window.location.search).get("lang");
    if (q === "ko" || q === "en") {
      localStorage.setItem(KEY, q);
      return q;
    }
  } catch {
    /* 저장 공간이 없어도 된다 */
  }
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "ko" || saved === "en") return saved;
  } catch {
    /* 무시 */
  }
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language || "ko"];
  return prefs.some((l) => /^ko\b/i.test(l)) ? "ko" : "en";
}

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m)) : s);

export function translate(lang: Lang, key: string, vars?: Vars): string {
  if (lang === "en") {
    const v = EN[key];
    if (v !== undefined) return typeof v === "function" ? v(vars ?? {}) : fill(v, vars);
  }
  return fill(key, vars);
}

type Ctx = { lang: Lang; t: (key: string, vars?: Vars) => string; setLang: (lang: Lang) => void };
const LangContext = createContext<Ctx>({ lang: "ko", t: (k, v) => fill(k, v), setLang: () => {} });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((next: Lang) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* 이번 창에서만 */
    }
    setLangState(next);
  }, []);
  const value = useMemo<Ctx>(() => ({ lang, setLang, t: (k, v) => translate(lang, k, v) }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export const useI18n = () => useContext(LangContext);

/** 저장 공간을 보지 않고 언어를 못 박는다 — 검사 스크립트에서 영어 화면을 그릴 때 */
export function StaticLang({ lang, children }: { lang: Lang; children: ReactNode }) {
  const value = useMemo<Ctx>(() => ({ lang, setLang: () => {}, t: (k, v) => translate(lang, k, v) }), [lang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

/* ── 데이터 표기 (요일·교시·점심·구간 이름) ─────────────────────── */

const DAY: Record<string, string> = { 월: "Mon", 화: "Tue", 수: "Wed", 목: "Thu", 금: "Fri", 토: "Sat", 일: "Sun" };
const WORD: Record<string, string> = { "점심시간": "Lunch", "점심": "Lunch", "쉬는시간": "Break", "쉬는 시간": "Break", "휴식": "Break" };

export function dayEn(d: string): string {
  const s = d.trim().replace(/요일$/, "");
  return DAY[s] ?? d;
}

export function slotLabelEn(label: string): string {
  const m = label.trim().match(/^(\d+)\s*교시$/);
  if (m) return `Period ${m[1]}`;
  return WORD[label.trim()] ?? label;
}

/** "월·화", "수·목·금 (4학년)" → "Mon·Tue", "Wed·Thu·Fri (Grade 4)" — 요일 글자가 따로 떨어져 있을 때만 */
export function segmentEn(name: string): string {
  return name
    .replace(/(\d)\s*학년/g, "Grade $1")
    .replace(/(^|[^가-힣])([월화수목금토일](?:[\s·,/~\-]*[월화수목금토일])*)(?=[^가-힣]|$)/g, (_m, pre: string, run: string) => pre + run.replace(/[월화수목금토일]/g, (c) => DAY[c]));
}

const mapSlot = (s: DaySlot): DaySlot => ({ ...s, label: slotLabelEn(s.label) });

/**
 * 보기 화면용 영어 사본. 요일 이름이 daySlots 의 키이기도 해서 함께 바꾼다.
 * 반·강사·체험존 이름과 프로그램은 입력한 그대로 둔다(보통 이미 영어).
 */
export function localizeData(data: AppData, lang: Lang): AppData {
  if (lang !== "en") return data;
  const unnamed = <T extends { name: string }>(x: T): T => (x.name ? x : { ...x, name: "(unnamed)" });
  return {
    ...data,
    schoolName: data.schoolNameEn?.trim() || "",
    days: data.days.map(dayEn),
    slots: data.slots.map(mapSlot),
    daySlots: Object.fromEntries(Object.entries(data.daySlots ?? {}).map(([k, v]) => [dayEn(k), v.map(mapSlot)])),
    segments: data.segments.map((s) => ({ ...s, name: segmentEn(s.name) })),
    fixedActivities: data.fixedActivities.map((f) => ({ ...f, name: WORD[f.name.trim()] ?? f.name })),
    classes: data.classes.map(unnamed),
    teachers: data.teachers.map(unnamed),
    rooms: data.rooms.map(unnamed),
  };
}
