"use client";
import { useState } from "react";
import { CalendarDays, X } from "lucide-react";

type Props = { open: boolean; count: number; busy: boolean; onCancel: () => void; onSubmit: (date: string) => void };
export default function QueueDateDialog({ open, count, busy, onCancel, onSubmit }: Props) {
  const [date, setDate] = useState("");
  if (!open) return null;
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
    <div role="dialog" aria-modal="true" aria-labelledby="queue-date-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
      <div className="flex items-center justify-between"><h2 id="queue-date-title" className="text-lg font-bold text-slate-900">품절 해제 예정 등록</h2><button type="button" aria-label="닫기" disabled={busy} onClick={onCancel}><X size={20}/></button></div>
      <p className="mt-3 text-sm text-slate-600">선택한 {count}개 상품의 품절 해제 예정 날짜를 지정합니다. 날짜가 되어도 자동으로 품절 해제되지는 않습니다.</p>
      <label className="mt-5 block text-sm font-semibold text-slate-800" htmlFor="queue-date">품절 해제 예정 날짜</label>
      <div className="relative mt-2"><CalendarDays className="pointer-events-none absolute left-3 top-3 text-slate-400" size={18}/><input id="queue-date" type="date" min={today} value={date} onChange={e => setDate(e.target.value)} className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 outline-none focus:border-blue-500" /></div>
      <div className="mt-6 grid grid-cols-2 gap-3"><button type="button" disabled={busy} onClick={onCancel} className="rounded-xl border border-slate-200 py-3 font-semibold">취소</button><button type="button" disabled={busy || !date || date < today} onClick={() => onSubmit(date)} className="rounded-xl bg-blue-600 py-3 font-semibold text-white disabled:opacity-40">{busy ? "등록 중..." : `${count}개 등록`}</button></div>
    </div>
  </div>;
}
