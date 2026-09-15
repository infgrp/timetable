import type { ReactNode, InputHTMLAttributes, SelectHTMLAttributes } from "react";

export function Card({
  title,
  desc,
  children,
  right,
}: {
  title?: string;
  desc?: ReactNode;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-tt-200 bg-white p-5 shadow-sm">
      {(title || right) && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-base font-bold text-tt-800">{title}</h2>}
            {desc && <p className="mt-1 text-sm text-tt-600">{desc}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

type BtnProps = {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
  /** 휴대폰에서 칸 폭을 꽉 채우고 글자를 가운데로 (넓은 화면에서는 보통 크기) */
  wide?: boolean;
};

export function Button({
  children,
  onClick,
  variant = "ghost",
  disabled,
  title,
  type = "button",
  wide,
}: BtnProps) {
  const base =
    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45";
  const styles = {
    primary: "bg-tt-600 text-white hover:bg-tt-700",
    ghost: "border border-tt-300 bg-white text-tt-700 hover:bg-tt-50",
    danger: "border border-red-300 bg-white text-red-600 hover:bg-red-50",
  }[variant];
  return (
    <button type={type} className={`${base} ${styles}${wide ? " w-full justify-center sm:w-auto" : ""}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-tt-700">{label}</span>
      {children}
      {hint && <span className="text-xs text-tt-500">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-tt-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-tt-500 focus:ring-2 focus:ring-tt-200";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-tt-300 bg-tt-50 px-4 py-6 text-center text-sm text-tt-600">
      {children}
    </p>
  );
}
