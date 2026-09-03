import { useEffect, useRef, useState } from "react";
import type { AppData } from "./types";
import { defaultData, load, save } from "./store";
import { sampleData } from "./sample";
import { downloadText } from "./export";
import SlotsPanel from "./components/SlotsPanel";
import ClassesPanel from "./components/ClassesPanel";
import TeachersPanel from "./components/TeachersPanel";
import CoursesPanel from "./components/CoursesPanel";
import ResultPanel from "./components/ResultPanel";
import { Button } from "./components/ui";

const TABS = [
  { id: "time", label: "시간 설정" },
  { id: "class", label: "학급·특별실" },
  { id: "teacher", label: "교사" },
  { id: "course", label: "담당 배정" },
  { id: "result", label: "시간표" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function App() {
  const [data, setData] = useState<AppData>(() => load());
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
        const parsed = JSON.parse(text) as AppData;
        if (!parsed || parsed.version !== 1) throw new Error("형식이 맞지 않습니다.");
        setData({ ...defaultData(), ...parsed });
      })
      .catch((e: unknown) => alert(`불러오기 실패: ${e instanceof Error ? e.message : String(e)}`));
  };

  return (
    <div className="min-h-full">
      <header className="no-print border-b border-tt-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div>
            <h1 className="text-lg font-bold text-tt-800">시간표 작성기</h1>
            <p className="text-xs text-tt-500">
              입력한 내용은 이 브라우저에만 저장됩니다. 서버로 전송되지 않습니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
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
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6">
        {tab === "time" && <SlotsPanel data={data} set={set} />}
        {tab === "class" && <ClassesPanel data={data} set={set} />}
        {tab === "teacher" && <TeachersPanel data={data} set={set} />}
        {tab === "course" && <CoursesPanel data={data} set={set} />}
        {tab === "result" && <ResultPanel data={data} />}
      </main>
    </div>
  );
}
