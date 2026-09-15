import { useRef, useState } from "react";
import type { AppData } from "../types";
import { migrate, STORAGE_KEY } from "../store";
import { downloadText } from "../export";
import { ApiError, CENTER_URL, TIMETABLE_URL, publishShared, summary, timeAgo, validCode } from "../shared";
import type { Snapshot } from "../shared";
import { Button, Card, TextInput } from "./ui";

/** 접속 코드가 없을 때 — center-today 에서 쓰는 그 코드를 넣는다 */
export function ConnectCard({ onConnect, error }: { onConnect: (code: string) => void; error: string }) {
  const [code, setCode] = useState("");
  const [local, setLocal] = useState("");
  return (
    <Card
      title="공유 시간표 연결"
      desc="센터 투데이에서 쓰는 공유 공간 접속 코드를 넣으면 관리자가 올린 시간표를 모두 같이 봅니다."
    >
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const next = code.trim().toLowerCase();
          if (!validCode(next)) return setLocal("48자리 접속 코드를 확인해 주세요.");
          setLocal("");
          onConnect(next);
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold text-tt-700">
          공유 공간 접속 코드
          <TextInput
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="전달받은 48자리 코드"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <Button variant="primary" type="submit">
          연결
        </Button>
        <a
          href="../"
          className="inline-flex items-center rounded-lg border border-tt-300 bg-white px-3 py-2 text-sm font-semibold text-tt-700 hover:bg-tt-50"
        >
          센터 투데이에서 연결하기
        </a>
      </form>
      {(local || error) && (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {local || error}
        </p>
      )}
    </Card>
  );
}

type PublishProps = {
  code: string;
  draft: AppData;
  shared: Snapshot | null;
  onPublished: (snap: Snapshot) => void;
  onLatest: () => Promise<Snapshot | null>;
  onClose: () => void;
};

/** 관리자: 지금 구성한 시간표나 JSON 파일을 공유에 올린다 */
export function PublishDialog({ code, draft, shared, onPublished, onLatest, onClose }: PublishProps) {
  const [source, setSource] = useState<"draft" | "file">("draft");
  const [fileData, setFileData] = useState<AppData | null>(null);
  const [fileName, setFileName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [base, setBase] = useState(shared?.revision ?? 0);
  const [conflict, setConflict] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const chosen = source === "draft" ? draft : fileData;

  const pick = (file: File) => {
    setError("");
    file
      .text()
      .then((text) => {
        const parsed = migrate(JSON.parse(text));
        if (!parsed) throw new Error("시간표 설정 파일이 아닙니다.");
        setFileData(parsed);
        setFileName(file.name);
        setSource("file");
      })
      .catch((e: unknown) => {
        setFileData(null);
        setError(`파일을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
      });
  };

  const submit = async () => {
    if (!chosen) return setError("올릴 JSON 파일을 골라 주세요.");
    if (!password) return setError("센터 공용 비밀번호를 넣어 주세요.");
    setBusy(true);
    setError("");
    try {
      const snap = await publishShared(code, chosen, base, password);
      onPublished(snap);
      onClose();
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(String(e));
      setError(err.message);
      if (err.status === 409) {
        const latest = await onLatest();
        if (latest) {
          setBase(latest.revision);
          setConflict(true);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-tt-900/40 p-4" role="dialog" aria-modal="true" aria-label="공유에 올리기">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-tt-800">시간표 공유에 올리기</h2>
            <p className="mt-1 text-sm text-tt-600">
              올리면 이 공유 공간의 모든 사람이 이 시간표를 봅니다.
              {shared?.data ? ` 지금 공유 중: ${summary(shared.data)} (${timeAgo(shared.updatedAt)})` : " 아직 공유된 시간표가 없습니다."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full px-2 text-2xl leading-none text-tt-500 hover:bg-tt-50" aria-label="닫기">
            ×
          </button>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold text-tt-700">무엇을 올릴까요?</legend>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-tt-200 p-3 text-sm">
            <input type="radio" name="source" checked={source === "draft"} onChange={() => setSource("draft")} className="mt-1" />
            <span>
              <b>이 기기에서 구성한 시간표</b>
              <br />
              <span className="text-tt-600">{summary(draft)}</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-tt-200 p-3 text-sm">
            <input
              type="radio"
              name="source"
              checked={source === "file"}
              onChange={() => (fileData ? setSource("file") : fileRef.current?.click())}
              className="mt-1"
            />
            <span className="min-w-0">
              <b>시간표설정 JSON 파일</b>
              <br />
              <span className="break-all text-tt-600">
                {fileData ? `${fileName} — ${summary(fileData)}` : "내보내기로 받은 파일을 고릅니다."}
              </span>
              <br />
              <button type="button" className="mt-1 text-tt-700 underline" onClick={() => fileRef.current?.click()}>
                파일 고르기
              </button>
            </span>
          </label>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pick(f);
              e.target.value = "";
            }}
          />
        </fieldset>

        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="flex flex-col gap-1 text-sm font-semibold text-tt-700">
            센터 공용 비밀번호
            <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          {error && (
            <p className="mt-2 text-sm text-red-700" role="alert">
              {error}
              {conflict && " 아래 버튼을 누르면 방금 받은 최신 시간표 위에 덮어씁니다."}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={onClose}>취소</Button>
            <Button variant="primary" type="submit" disabled={busy || !chosen}>
              {busy ? "올리는 중…" : conflict ? "최신 시간표 위에 덮어쓰기" : "공유에 올리기"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** 예전 Vercel 주소 — 새 주소로 안내하고, 이 기기에 남은 설정을 받아 갈 수 있게 한다 */
export function MovedNotice() {
  let saved = "";
  try {
    saved = localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    saved = "";
  }
  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center gap-4 px-5 py-16">
      <h1 className="text-2xl font-bold text-tt-800">시간표가 새 주소로 옮겨졌습니다</h1>
      <p className="text-tt-700">
        이제 관리자가 올린 시간표를 센터 모두가 같이 봅니다. 센터 투데이와 같은 주소, 같은 접속 코드를 씁니다.
      </p>
      <a
        href={TIMETABLE_URL}
        className="inline-flex w-fit items-center rounded-lg bg-tt-600 px-4 py-2.5 font-bold text-white hover:bg-tt-700"
      >
        새 주소에서 시간표 열기
      </a>
      <p className="break-all text-sm text-tt-500">{TIMETABLE_URL}</p>
      {saved && (
        <div className="rounded-lg border border-tt-200 bg-white p-4 text-sm text-tt-700">
          <b>이 기기에서 만들던 시간표가 있습니다.</b> 주소가 바뀌면 브라우저 저장 공간이 달라 자동으로 옮겨지지 않습니다. 파일로
          받아 새 주소에서 <b>시간표 구성하기 → 불러오기</b> 하거나 <b>공유에 올리기</b>로 올리세요.
          <div className="mt-3">
            <Button onClick={() => downloadText(`시간표설정_${new Date().toISOString().slice(0, 10)}.json`, saved, "application/json")}>
              시간표 설정 파일 받기
            </Button>
          </div>
        </div>
      )}
      <p className="text-sm text-tt-500">
        센터 투데이: <a className="underline" href={CENTER_URL}>{CENTER_URL}</a>
      </p>
    </div>
  );
}
