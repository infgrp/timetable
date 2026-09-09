import { useEffect, useRef, useState } from "react";
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
  const [data, setData] = useState<AppData>(() => load());
  const [mode, setMode] = useState<Mode>("view");
  const [tab, setTab] = useState<TabId>("time");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    save(data);
  }, [data]);

  const set = (fn: (d: AppData) => AppData) => setData(fn);

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
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-lg font-bold text-tt-800">
                {data.schoolName || "영어체험센터"} 시간표
              </h1>
              <p className="text-xs text-tt-500">이 브라우저에만 저장됩니다. 서버로 전송되지 않습니다.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* 큰 두 갈래 — 보기가 기본이고, 만드는 일은 안쪽으로 넣는다. */}
            <div className="flex rounded-lg border border-tt-300 p-0.5">
              {(["view", "build"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-md px-3 py-1.5 text-sm font-bold transition ${
                    mode === m ? "bg-tt-600 text-white" : "text-tt-600 hover:bg-tt-50"
                  }`}
                >
                  {m === "view" ? "시간표 보기" : "시간표 구성하기"}
                </button>
              ))}
            </div>
            <a
              href="/manual.pdf"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-tt-300 bg-white px-3 py-1.5 text-sm font-semibold text-tt-700 transition hover:bg-tt-50"
            >
              사용 설명서
            </a>
          </div>
        </div>

        {mode === "build" && (
          <>
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
        {mode === "view" ? (
          <ViewerPanel data={data} onBuild={() => setMode("build")} />
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
