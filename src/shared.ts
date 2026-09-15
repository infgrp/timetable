import type { AppData } from "./types";
import { migrate } from "./store";
import { translate } from "./i18n";
import type { Lang } from "./i18n";

/**
 * 공유 시간표 — center-today 서버(Cloudflare Workers + D1)에 한 벌을 둔다.
 *
 * 앱은 center-today 주소의 /timetable/ 아래에서 돌아간다(같은 주소라 접속 코드를 그대로 쓴다).
 *   보기: 공유 공간 접속 코드만 있으면 누구나
 *   올리기: 센터 공용 비밀번호가 있어야 한다
 * 시간표 구성은 여전히 이 기기에서 하고, 다 되면 올린다.
 */

/** center-today 안에서 빌드됐는가 (npm run build:center) */
export const SHARED = import.meta.env?.BASE_URL === "/timetable/"; // 검사 스크립트(node)에는 env 가 없다
/** 예전 Vercel 주소로 열었는가 — 새 주소로 안내한다 */
export const MOVED = typeof location !== "undefined" && location.hostname.endsWith("vercel.app");
export const CENTER_URL = "https://center-today.infgrp.workers.dev";
export const TIMETABLE_URL = `${CENTER_URL}/timetable/`;

const CODE_KEY = "center-space-code"; // center-today 와 같은 키
const CACHE_KEY = "timetable.shared.v1";

export type Snapshot = { data: AppData | null; revision: number; updatedAt: string | null };

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

export function readCode(): string {
  try {
    return localStorage.getItem(CODE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeCode(code: string) {
  try {
    if (code) localStorage.setItem(CODE_KEY, code);
    else localStorage.removeItem(CODE_KEY);
  } catch {
    /* 저장 공간이 없으면 이번 창에서만 연결 */
  }
}

export const validCode = (code: string) => /^[a-f0-9]{48}$/.test(code);

/** 마지막으로 받은 공유 시간표 — 연결이 끊겨도 볼 수 있게 */
export function readCache(code: string): Snapshot | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    if (!raw || raw.code !== code) return null;
    return { data: raw.data ? migrate(raw.data) : null, revision: raw.revision, updatedAt: raw.updatedAt };
  } catch {
    return null;
  }
}

function writeCache(code: string, snap: Snapshot) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ code, ...snap }));
  } catch {
    /* 캐시는 없어도 된다 */
  }
}

async function call(code: string, init: RequestInit = {}): Promise<Snapshot> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch("/api/timetable", {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${code}`, ...(init.headers ?? {}) },
    });
    let body: { error?: string; data?: unknown; revision?: number; updatedAt?: string | null };
    try {
      body = await res.json();
    } catch {
      throw new ApiError("서버 응답을 읽지 못했습니다. 사이트 연결을 확인해 주세요.", res.status);
    }
    if (!res.ok) throw new ApiError(body.error || "요청을 처리하지 못했습니다.", res.status);
    const data = body.data == null ? null : migrate(body.data);
    if (body.data != null && !data) throw new ApiError("공유된 시간표를 읽지 못했습니다. 관리자에게 다시 올려 달라고 해 주세요.");
    const snap = { data, revision: body.revision ?? 0, updatedAt: body.updatedAt ?? null };
    writeCache(code, snap);
    return snap;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("공유 서버에 연결하지 못했습니다. 마지막으로 받은 시간표를 보여 줍니다.");
  } finally {
    clearTimeout(timer);
  }
}

export const fetchShared = (code: string) => call(code);

export const publishShared = (code: string, data: AppData, revision: number, password: string) =>
  call(code, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Admin-Password": password },
    body: JSON.stringify({ revision, data }),
  });

/** 시간표 파일 한 줄 요약 — 올리기 전에 맞는 파일인지 확인하게 */
export function summary(d: AppData, lang: Lang = "ko"): string {
  const school = (lang === "en" ? d.schoolNameEn?.trim() : "") || d.schoolName || translate(lang, "이름 없음");
  return translate(lang, "{school} · 체험반 {classes} · 강사 {teachers} · 배치된 수업 {cells}칸", {
    school,
    classes: d.classes.length,
    teachers: d.teachers.length,
    cells: d.timetable.length,
  });
}

export function timeAgo(iso: string | null, lang: Lang = "ko"): string {
  if (!iso) return "";
  const t = new Date(iso);
  const mins = Math.round((Date.now() - t.getTime()) / 60000);
  if (mins < 1) return translate(lang, "방금");
  if (mins < 60) return translate(lang, "{n}분 전", { n: mins });
  return t.toLocaleString(lang === "en" ? "en-US" : "ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}
