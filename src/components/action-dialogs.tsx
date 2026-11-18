"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

export type ResultInfo = { title: string; success: number; failed: number; details: string[] };

type ConfirmProps = { open: boolean; title: string; description: string; yesLabel: string; noLabel: string; onAnswer: (yes: boolean) => void };

export function ConfirmDialog({ open, title, description, yesLabel, noLabel, onAnswer }: ConfirmProps) {
  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onAnswer(false); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-3"><h2 id="confirm-title" className="text-lg font-bold text-slate-900">{title}</h2><button aria-label="닫기" onClick={() => onAnswer(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={20} /></button></div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{description}</p>
      <div className="mt-6 grid grid-cols-2 gap-3"><button onClick={() => onAnswer(false)} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">{noLabel}</button><button autoFocus onClick={() => onAnswer(true)} className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700">{yesLabel}</button></div>
    </section>
  </div>;
}

type InputProps = { open: boolean; title: string; description: string; onAnswer: (text: string | null) => void };
export function InputDialog({ open, title, description, onAnswer }: InputProps) {
  const [text, setText] = useState("");
  useEffect(() => { if (open) setText(""); }, [open]);
  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="presentation">
    <form role="dialog" aria-modal="true" aria-labelledby="input-title" onSubmit={(e) => { e.preventDefault(); onAnswer(text.trim()); }} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-3"><h2 id="input-title" className="text-lg font-bold text-slate-900">{title}</h2><button type="button" aria-label="닫기" onClick={() => onAnswer(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={20} /></button></div>
      <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
      <input autoFocus maxLength={20} value={text} onChange={(e) => setText(e.target.value)} placeholder="예: 일시품절 / 대체상품 안내" className="mt-5 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500" />
      <p className="mt-2 text-right text-xs text-slate-400">{text.length} / 20자</p>
      <div className="mt-5 grid grid-cols-2 gap-3"><button type="button" onClick={() => onAnswer(null)} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold">취소</button><button type="submit" className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white">확인 및 진행</button></div>
    </form>
  </div>;
}

export function ResultDialog({ info, onClose }: { info: ResultInfo | null; onClose: () => void }) {
  if (!info) return null;
  const allOk = info.failed === 0 && info.details.length === 0;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="result-title" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
      <div className="flex items-center gap-3">{allOk ? <CheckCircle2 className="text-emerald-600" size={30} /> : <AlertCircle className="text-amber-600" size={30} />}<h2 id="result-title" className="text-lg font-bold text-slate-900">{info.title}</h2></div>
      <p className="mt-4 text-sm text-slate-700"><strong className="text-emerald-700">성공 {info.success}건</strong><span className="mx-2 text-slate-300">|</span><strong className={info.failed ? "text-rose-600" : "text-slate-500"}>실패 {info.failed}건</strong></p>
      {info.details.length > 0 && <div className="mt-4 max-h-40 overflow-y-auto rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-700">{info.details.map((detail, i) => <p key={i}>{detail}</p>)}</div>}
      <button autoFocus onClick={onClose} className="mt-6 w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white">확인</button>
    </section>
  </div>;
}
