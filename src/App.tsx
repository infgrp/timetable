import { useCallback, useEffect, useRef, useState } from "react";
import type { AppData } from "./types";
import { defaultData, load, migrate, save } from "./store";
import { sampleData } from "./sample";
import { downloadText } from "./export";
import SlotsPanel from "./components/SlotsPanel";
import ClassesPanel from "./components/ClassesPanel";
import TeachersPanel from "./components/TeachersPanel";
import CoursesPanel from "./components/CoursesPanel";
import ResultPanel from "./components/ResultPanel";
import RotationPanel from "./components/RotationPanel";
import ViewerPanel from "./components/ViewerPanel";
import { Button } from "./components/ui";
import { ConnectCard, MovedNotice, PublishDialog } from "./components/SharedPanel";
import { ApiError, MOVED, SHARED, fetchShared, readCache, readCode, summary, timeAgo, validCode, writeCode } from "./shared";
import type { Snapshot } from "./shared";
import { useI18n } from "./i18n";

const TABS = [
  { id: "time", label: "운영 시간" },
  { id: "class", label: "체험반·구간" },
  { id: "teacher", label: "강사" },
  { id: "course", label: "프로그램 배정" },
  { id: "result", label: "시간표 짜기" },
  { id: "rotation", label: "로테이션" },
] as const;

type TabId = (typeof TABS)[number]["id"];
type Mode = "view" | "build";

export default function App() {
  return MOVED ? <MovedNotice /> : <Main />;
}

/** 공유 시간표를 다시 받는 주기. 시간표는 자주 바뀌지 않는다. */
const REFRESH_MS = 60_000;

const LINK = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-tt-300 bg-white px-3 py-1.5 text-sm font-semibold text-tt-700 transition hover:bg-tt-50";

function Main() {
  const { lang, t, setLang } = useI18n();
  const [data, setData] = useState<AppData>(() => load());
  // 공유 시간표 (center-today 안에서만)
  const [code, setCode] = useState(() => (SHARED ? readCode() : ""));
  const [shared, setShared] = useState<Snapshot | null>(() => (SHARED && code ? readCache(code) : null));
  const [sharedError, setSharedError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [mode, setMode] = useState<Mode>("view");
  const [tab, setTab] = useState<TabId>("time");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    save(data);
  }, [data]);

  const set = (fn: (d: AppData) => AppData) => setData(fn);

  const refreshShared = useCallback(async (): Promise<Snapshot | null> => {
    if (!SHARED || !code) return null;
    try {
      const snap = await fetchShared(code);
      setShared(snap);
      setSharedError("");
      return snap;
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(String(e));
      setSharedError(err.message);
      if (err.status === 401 || err.status === 404) {
        // 코드가 틀렸거나 공간이 사라졌다 — 다시 넣게 한다
        writeCode("");
        setCode("");
        setShared(null);
      }
      return null;
    }
  }, [code]);

  useEffect(() => {
    if (!SHARED || !code) return;
    void refreshShared();
    const timer = setInterval(() => {
      if (!document.hidden) void refreshShared();
    }, REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden) void refreshShared();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [code, refreshShared]);

  // 보기 화면: 공유 시간표가 있으면 그것, 없으면 이 기기에서 구성한 것
  const viewData = SHARED && shared?.data ? shared.data : data;
  const headData = mode === "view" ? viewData : data;
  const heading =
    lang === "en"
      ? [headData.schoolNameEn?.trim(), t("시간표")].filter(Boolean).join(" ")
      : `${headData.schoolName || "영어체험센터"} 시간표`;

  useEffect(() => {
    document.title = lang === "en" ? heading : `${headData.schoolName || "영어체험센터"} 시간표`;
  }, [lang, heading, headData.schoolName]);

  const importJson = (file: File) => {
    file
      .text()
      .then((text) => {
        const parsed = migrate(JSON.parse(text));
        if (!parsed) throw new Error("형식이 맞지 않습니다.");
        setData(parsed);
      })
      .catch((e: unknown) => alert(`불러오기 실패: ${e instanceof Error ? e.message : String(e)}`));
  };

  return (
    <div className="min-h-full">
      <header className="no-print border-b border-tt-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-lg font-bold text-tt-800">{heading}</h1>
              <p className="text-xs text-tt-500">
                {!SHARED
                  ? t("이 브라우저에만 저장됩니다. 서버로 전송되지 않습니다.")
                  : !code
                    ? t("공유 공간에 연결하면 관리자가 올린 시간표를 봅니다.")
                    : mode === "build"
                      ? t("구성은 이 기기에 저장됩니다. 다 되면 공유에 올리세요.")
                      : shared?.data
                        ? `${t("공유 시간표 · {ago} 올림", { ago: timeAgo(shared.updatedAt, lang) })}${sharedError ? t(" · 연결 끊김, 마지막으로 받은 시간표") : ""}`
                        : t("아직 공유된 시간표가 없습니다. 이 기기에서 구성한 시간표를 보여 줍니다.")}
              </p>
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            {/* 큰 두 갈래 — 보기가 기본이고, 만드는 일은 안쪽으로 넣는다.
                휴대폰에서는 시간표 폭만큼 고르게 편다(2026-09-15 요청). */}
            <div className="grid grid-cols-2 rounded-lg border border-tt-300 p-0.5 sm:flex">
              {(["view", "build"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-md px-3 py-2 text-sm font-bold transition sm:py-1.5 ${
                    mode === m ? "bg-tt-600 text-white" : "text-tt-600 hover:bg-tt-50"
                  }`}
                >
                  {m === "view" ? t("시간표 보기") : t("시간표 구성하기")}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              {SHARED && (
                <a href="../" className={LINK}>
                  {t("오늘 현황")}
                </a>
              )}
              {SHARED && code && (
                <button type="button" onClick={() => setPublishing(true)} className={LINK}>
                  {t("공유에 올리기")}
                </button>
              )}
              <a href={`${import.meta.env.BASE_URL}manual.pdf`} target="_blank" rel="noreferrer" className={LINK}>
                {t("사용 설명서")}
              </a>
              <button
                type="button"
                lang={lang === "en" ? "ko" : "en"}
                onClick={() => setLang(lang === "en" ? "ko" : "en")}
                className={LINK}
                aria-label={lang === "en" ? "한국어로 보기" : "View in English"}
                title={lang === "en" ? "한국어로 보기" : "View in English"}
              >
                {lang === "en" ? "한국어" : "EN"}
              </button>
            </div>
          </div>
        </div>

        {mode === "build" && (
          <>
            {lang === "en" && (
              <p className="mx-auto max-w-7xl px-5 pb-2 text-sm text-amber-800">
                {t("시간표 구성 화면은 한국어로만 제공됩니다. 시간표 보기는 영어로 볼 수 있습니다.")}
              </p>
            )}
            <div className="mx-auto flex max-w-7xl flex-wrap justify-end gap-2 px-5 pb-2">
              <Button
                onClick={() => {
                  if (confirm("예시 데이터를 불러옵니다. 지금 입력한 내용은 사라집니다.")) setData(sampleData());
                }}
              >
                예시 데이터
              </Button>
              <Button
                onClick={() =>
                  downloadText(
                    `시간표설정_${new Date().toISOString().slice(0, 10)}.json`,
                    JSON.stringify(data, null, 2),
                    "application/json",
                  )
                }
              >
                내보내기
              </Button>
              <Button onClick={() => fileRef.current?.click()}>불러오기</Button>
              {SHARED && shared?.data && (
                <Button
                  onClick={() => {
                    if (confirm(`공유 시간표(${summary(shared.data!)})를 이 기기로 가져옵니다. 지금 구성하던 내용은 사라집니다.`))
                      setData(shared.data!);
                  }}
                >
                  공유 시간표 가져오기
                </Button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importJson(f);
                  e.target.value = "";
                }}
              />
              <Button
                variant="danger"
                onClick={() => {
                  if (confirm("모든 입력을 지우고 처음 상태로 돌아갑니다.")) setData(defaultData());
                }}
              >
                초기화
              </Button>
            </div>

            <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-5">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
                    tab === t.id
                      ? "border-tt-600 text-tt-700"
                      : "border-transparent text-tt-500 hover:text-tt-700"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6">
        {SHARED && !code && (
          <div className="mb-6">
            <ConnectCard
              error={sharedError}
              onConnect={(next) => {
                if (!validCode(next)) return;
                writeCode(next);
                setCode(next);
                setShared(readCache(next));
              }}
            />
          </div>
        )}
        {SHARED && code && sharedError && mode === "view" && (
          <p className="no-print mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="status">
            {t(sharedError)}
          </p>
        )}
        {publishing && (
          <PublishDialog
            code={code}
            draft={data}
            shared={shared}
            onLatest={refreshShared}
            onPublished={(snap) => {
              setShared(snap);
              setSharedError("");
              setMode("view");
            }}
            onClose={() => setPublishing(false)}
          />
        )}
        {mode === "view" ? (
          <ViewerPanel data={viewData} onBuild={() => setMode("build")} />
        ) : (
          <>
            {tab === "time" && <SlotsPanel data={data} set={set} />}
            {tab === "class" && <ClassesPanel data={data} set={set} />}
            {tab === "teacher" && <TeachersPanel data={data} set={set} />}
            {tab === "course" && <CoursesPanel data={data} set={set} />}
            {tab === "result" && <ResultPanel data={data} set={set} />}
            {tab === "rotation" && <RotationPanel data={data} set={set} />}
          </>
        )}
      </main>
    </div>
  );
}
