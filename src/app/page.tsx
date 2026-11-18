"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertCircle, Ban, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Loader2, LogOut, Package, Plus, RefreshCw, Search, Settings2, ShoppingBag } from "lucide-react";

type Product = { mall: string; product_no: number; product_code: string; custom_product_code?: string; product_name: string; selling: boolean; display: boolean; price_content: string };
type Mall = { mall_id: string; refresh_expires_at: string };
type QueueItem = { mall_id: string; product_no: number; memo: string };
type Tab = "stop" | "resume" | "queue";
type Action = "stop" | "resume" | "show" | "hide" | "price";
type ProductResponse = { products: Product[]; errors?: string[]; page: number; hasMore: boolean };
type BulkResult = { success: number; failed: number; results?: { mall: string; product_no: number; ok: boolean; error?: string }[] };
const productKey = (p: Product) => `${p.mall}:${p.product_no}`;
const errorText = (e: unknown, fallback: string) => e instanceof Error ? e.message : fallback;
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store", headers: { "Content-Type": "application/json", ...options?.headers } });
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || `요청 실패 (HTTP ${response.status})`);
  return data as T;
}

export default function HomePage() {
  const [auth, setAuth] = useState<"checking" | "login" | "authenticated">("checking");
  const [password, setPassword] = useState("");
  const [malls, setMalls] = useState<Mall[]>([]);
  const [mall, setMall] = useState("all");
  const [newMall, setNewMall] = useState("");
  const [tab, setTab] = useState<Tab>("stop");
  const [products, setProducts] = useState<Product[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [priceText, setPriceText] = useState("");
  const seq = useRef(0);

  const loadMalls = useCallback(async () => {
    const data = await request<{ malls: Mall[] }>("/api/malls");
    setMalls(data.malls || []);
  }, []);
  const loadQueue = useCallback(async () => {
    const data = await request<{ items: QueueItem[] }>("/api/queue");
    setQueue(data.items || []);
  }, []);
  const loadProducts = useCallback(async (currentMall: string, currentTab: Tab, currentPage: number, currentQuery: string) => {
    const id = ++seq.current;
    setBusy(true);
    try {
      const params = new URLSearchParams({ mall: currentMall, mode: currentTab, page: String(currentPage), q: currentQuery });
      const data = await request<ProductResponse>(`/api/products?${params.toString()}`);
      if (id !== seq.current) return;
      setProducts(data.products || []);
      setHasMore(Boolean(data.hasMore));
      setSelected([]);
      setMessage(data.errors?.join(" / ") || "");
    } catch (e) {
      if (id !== seq.current) return;
      setProducts([]); setHasMore(false); setSelected([]);
      setMessage(errorText(e, "상품 조회 실패"));
    } finally {
      if (id === seq.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [m, q] = await Promise.all([
          request<{ malls: Mall[] }>("/api/malls"),
          request<{ items: QueueItem[] }>("/api/queue"),
        ]);
        if (!active) return;
        setMalls(m.malls || []); setQueue(q.items || []); setAuth("authenticated");
      } catch {
        if (active) setAuth("login");
      }
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (auth === "authenticated") void loadProducts(mall, tab, page, searchQuery);
  }, [auth, mall, tab, page, searchQuery, loadProducts]);

  const visible = useMemo(() => products.filter(p => tab === "stop" ? p.selling : tab === "resume" ? !p.selling : queue.some(q => q.mall_id === p.mall && q.product_no === p.product_no)), [products, queue, tab]);
  const chosen = useMemo(() => visible.filter(p => selected.includes(productKey(p))), [visible, selected]);
  const scopedQueue = useMemo(() => queue.filter(q => mall === "all" || q.mall_id === mall), [queue, mall]);
  const stats = [
    { label: "조회 상품", value: products.length, icon: ShoppingBag, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "판매 중", value: products.filter(p => p.selling).length, icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "판매안함", value: products.filter(p => !p.selling).length, icon: Ban, color: "text-rose-600", bg: "bg-rose-50" },
    { label: "해제 예정", value: scopedQueue.length, icon: ClipboardList, color: "text-amber-600", bg: "bg-amber-50" },
  ];
  function changeTab(next: Tab) {
    setTab(next); setPage(1); setQuery(""); setSearchQuery(""); setSelected([]); setMessage("");
  }
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setMessage("");
    try {
      await request("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) });
      await Promise.all([loadMalls(), loadQueue()]);
      setPassword(""); setAuth("authenticated");
    } catch (e) { setMessage(errorText(e, "로그인 실패")); }
    finally { setBusy(false); }
  }
  async function logout() {
    try {
      await request("/api/auth/logout", { method: "POST" });
      seq.current++; setAuth("login"); setMalls([]); setProducts([]); setQueue([]); setSelected([]); setMessage("");
    } catch (e) { setMessage(errorText(e, "로그아웃 실패")); }
  }
  async function refreshAll() {
    setMessage("");
    try { await Promise.all([loadMalls(), loadQueue(), loadProducts(mall, tab, page, searchQuery)]); }
    catch (e) { setMessage(errorText(e, "새로고침 실패")); }
  }
  async function performAction(action: Action) {
    if (busy || !chosen.length) return;
    const labels: Record<Action, string> = { stop: "품절 처리", resume: "품절 해제", show: "진열함", hide: "진열안함", price: "대체문구 변경" };
    if (!window.confirm(`${chosen.length}개 상품을 ${labels[action]}하시겠습니까?`)) return;
    let text: string | undefined;
    let clearPriceContent = false;
    if (action === "stop" && window.confirm("품절 처리 시 대체 문구를 등록하시겠습니까?\n확인: 입력 / 취소: 문구 변경 없이 처리")) {
      const entered = window.prompt("대체 문구를 입력하세요. (최대 20자)\n빈칸이면 문구 변경 없이 진행합니다.", "");
      if (entered === null) return;
      if (entered.trim().length > 20) { setMessage("대체 문구는 최대 20자까지 입력할 수 있습니다."); return; }
      if (entered.trim()) text = entered.trim();
    }
    if (action === "resume") clearPriceContent = window.confirm("기존 대체 문구를 삭제하고 품절 해제하시겠습니까?\n확인: 삭제 / 취소: 유지");
    if (action === "price") text = priceText;
    setBusy(true); setMessage("");
    try {
      const result = await request<BulkResult>("/api/bulk", {
        method: "POST",
        body: JSON.stringify({ items: chosen.map(p => ({ mall: p.mall, product_no: p.product_no })), action, ...(text !== undefined ? { text } : {}), ...(action === "resume" ? { clearPriceContent } : {}) }),
      });
      await loadQueue();
      await loadProducts(mall, tab, page, searchQuery);
      const failures = (result.results || []).filter(r => !r.ok || r.error).slice(0, 3).map(r => `${r.mall}/${r.product_no}: ${r.error || "실패"}`);
      setMessage(`처리 완료 · 성공 ${result.success}건 / 실패 ${result.failed}건${failures.length ? ` · ${failures.join(" / ")}` : ""}`);
    } catch (e) { setMessage(errorText(e, "상품 변경 실패")); }
    finally { setBusy(false); }
  }
  async function updateQueue(method: "POST" | "DELETE") {
    if (busy || !chosen.length) return;
    setBusy(true); setMessage("");
    try {
      await request("/api/queue", { method, body: JSON.stringify({ items: chosen.map(p => ({ mall: p.mall, product_no: p.product_no })) }) });
      await loadQueue(); await loadProducts(mall, tab, page, searchQuery);
      setMessage(method === "POST" ? "해제 예정 목록에 등록했습니다." : "해제 예정 목록에서 삭제했습니다.");
    } catch (e) { setMessage(errorText(e, "목록 변경 실패")); }
    finally { setBusy(false); }
  }
  function submitSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPage(1); setSearchQuery(query.trim());
    if (page === 1 && searchQuery === query.trim()) void loadProducts(mall, tab, 1, query.trim());
  }

  if (auth === "checking") return <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600"><Loader2 className="mr-2 animate-spin" size={20} />연결 확인 중...</main>;
  if (auth === "login") return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4"><form onSubmit={login} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"><h1 className="text-xl font-bold">FC 상품 품절관리</h1><p className="text-sm text-slate-500">관리자 로그인</p><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="관리자 비밀번호" autoComplete="current-password" className="w-full rounded-xl border border-slate-200 px-4 py-3" /><button disabled={busy || !password} className="w-full rounded-xl bg-slate-900 py-3 font-semibold text-white disabled:opacity-40">{busy ? "로그인 중..." : "로그인"}</button>{message && <p role="alert" className="text-sm text-rose-600">{message}</p>}</form></main>;

  return <main className="min-h-screen bg-slate-50 text-slate-900"><div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-8 md:py-8">
    <header className="flex items-center justify-between gap-4"><h1 className="text-2xl font-bold">FC 상품 품절관리</h1><button onClick={() => void logout()} className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm"><LogOut size={16} />로그아웃</button></header>
    <section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex flex-wrap items-end gap-3"><div className="min-w-48 flex-1"><label htmlFor="mall-select" className="mb-2 block text-sm font-semibold">관리 쇼핑몰</label><select id="mall-select" value={mall} onChange={e => { setMall(e.target.value); setPage(1); setSelected([]); }} className="w-full rounded-xl border bg-white px-4 py-3"><option value="all">전체 쇼핑몰</option>{malls.map(m => <option key={m.mall_id} value={m.mall_id}>{m.mall_id}</option>)}</select></div><button disabled={busy} onClick={() => void refreshAll()} className="flex items-center gap-2 rounded-xl border px-5 py-3 text-sm disabled:opacity-40"><RefreshCw size={17} />새로고침</button></div>
      {malls.length < 2 && <div className="mt-4 flex gap-2 border-t pt-4"><input value={newMall} onChange={e => setNewMall(e.target.value)} placeholder="쇼핑몰 ID 입력" className="min-w-0 flex-1 rounded-xl border px-4 py-2.5" /><button disabled={!newMall.trim()} onClick={() => { window.location.href = `/api/cafe24/connect?mall=${encodeURIComponent(newMall.trim())}`; }} className="flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-white disabled:opacity-40"><Plus size={16} />쇼핑몰 연결</button></div>}
    </section>
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">{stats.map(s => { const Icon = s.icon; return <div key={s.label} className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm text-slate-500">{s.label}</p><div className={`rounded-xl p-2 ${s.bg} ${s.color}`}><Icon size={19} /></div></div><p className="mt-4 text-3xl font-bold">{s.value.toLocaleString()}</p></div>; })}</section>
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="grid grid-cols-3 border-b px-4 md:px-6">{([{ id: "stop", label: "품절 처리" }, { id: "resume", label: "품절 해제" }, { id: "queue", label: "해제 예정" }] as const).map(t => <button key={t.id} onClick={() => changeTab(t.id)} className={`border-b-2 px-2 py-5 text-sm font-semibold md:text-base ${tab === t.id ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500"}`}>{t.label}{t.id === "queue" && ` (${scopedQueue.length})`}</button>)}</div>
      <div className="space-y-5 p-4 md:p-6"><div><h2 className="text-lg font-bold">{tab === "stop" ? "상품 품절 처리" : tab === "resume" ? "상품 품절 해제" : "해제 예정 상품 관리"}</h2><p className="mt-1 text-sm text-slate-500">{tab === "stop" ? "판매 중인 상품을 선택하여 일괄 처리합니다." : tab === "resume" ? "판매안함 상품을 선택하여 판매를 재개합니다." : "등록된 상품을 확인한 후 직접 품절 해제합니다."}</p></div>
        <form onSubmit={submitSearch} className="flex gap-2"><div className="relative flex-1"><Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="상품명 또는 상품코드 / 자체 상품코드 검색" className="w-full rounded-xl border py-3 pl-11 pr-4 outline-none focus:border-blue-500" /></div><button disabled={busy} className="rounded-xl bg-slate-800 px-5 text-sm font-semibold text-white disabled:opacity-40">검색</button></form>
        <div className="flex items-center justify-between gap-2"><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={visible.length > 0 && visible.every(p => selected.includes(productKey(p)))} onChange={e => setSelected(e.target.checked ? visible.map(productKey) : [])} className="h-4 w-4 accent-blue-600" />전체 선택</label><p className="text-sm text-slate-500"><span className="font-semibold text-blue-600">{selected.length}개 선택</span> · {visible.length}개 표시</p></div>
        <div className="max-h-[540px] space-y-2 overflow-y-auto">{visible.map(p => <label key={productKey(p)} className="flex cursor-pointer items-center gap-3 rounded-xl border p-4 hover:bg-blue-50/30"><input type="checkbox" checked={selected.includes(productKey(p))} onChange={e => setSelected(old => e.target.checked ? [...new Set([...old, productKey(p)])] : old.filter(x => x !== productKey(p)))} className="h-4 w-4 accent-blue-600" /><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{p.product_name}</p><p className="mt-1 text-xs text-slate-500">{p.mall} · {p.product_code || `상품번호 ${p.product_no}`}{p.custom_product_code ? ` · 자체코드 ${p.custom_product_code}` : ""}</p></div><span className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ${p.selling ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{p.selling ? "판매함" : "판매안함"}</span></label>)}{visible.length === 0 && <div className="flex flex-col items-center justify-center rounded-xl bg-slate-50 px-4 py-14 text-center"><Package size={32} className="mb-3 text-slate-300" /><p className="text-sm text-slate-500">{busy ? "상품을 조회하고 있습니다..." : "표시할 상품이 없습니다."}</p></div>}</div>
        {tab !== "queue" && <div className="flex items-center justify-center gap-4"><button disabled={busy || page === 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-30"><ChevronLeft size={16} />이전</button><span className="text-sm">{page} 페이지</span><button disabled={busy || !hasMore} onClick={() => setPage(p => p + 1)} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-30">다음<ChevronRight size={16} /></button></div>}
        <div className="border-t pt-5">{tab === "stop" && <button disabled={busy || !chosen.length} onClick={() => void performAction("stop")} className="w-full rounded-xl bg-rose-500 py-4 font-bold text-white disabled:opacity-40">선택 {selected.length}개 일괄 품절 처리</button>}{tab === "resume" && <div className="grid gap-3 md:grid-cols-2"><button disabled={busy || !chosen.length} onClick={() => void performAction("resume")} className="rounded-xl bg-blue-600 py-4 font-bold text-white disabled:opacity-40">선택 {selected.length}개 품절 해제</button><button disabled={busy || !chosen.length} onClick={() => void updateQueue("POST")} className="rounded-xl border border-blue-200 bg-blue-50 py-4 font-bold text-blue-700 disabled:opacity-40">해제 예정에 등록</button></div>}{tab === "queue" && <div className="grid gap-3 md:grid-cols-2"><button disabled={busy || !chosen.length} onClick={() => void performAction("resume")} className="rounded-xl bg-blue-600 py-4 font-bold text-white disabled:opacity-40">선택 {selected.length}개 직접 품절 해제</button><button disabled={busy || !chosen.length} onClick={() => void updateQueue("DELETE")} className="rounded-xl border py-4 font-bold disabled:opacity-40">예정 목록에서 삭제</button></div>}</div>
        <div className="border-t pt-5"><button onClick={() => setSettingsOpen(v => !v)} className="flex w-full items-center justify-between text-sm font-semibold text-slate-600"><span className="flex items-center gap-2"><Settings2 size={17} />추가 상품 설정</span><ChevronDown size={18} className={settingsOpen ? "rotate-180" : ""} /></button>{settingsOpen && <div className="mt-4 space-y-4 rounded-xl bg-slate-50 p-4"><p className="text-sm font-semibold">선택 상품 진열 설정</p><div className="grid grid-cols-2 gap-3"><button disabled={busy || !chosen.length} onClick={() => void performAction("show")} className="rounded-xl border bg-white p-3 text-sm disabled:opacity-40">진열함</button><button disabled={busy || !chosen.length} onClick={() => void performAction("hide")} className="rounded-xl border bg-white p-3 text-sm disabled:opacity-40">진열안함</button></div><p className="text-sm font-semibold">판매가 대체문구</p><input maxLength={20} value={priceText} onChange={e => setPriceText(e.target.value)} placeholder="예: 가격문의, 일시품절" className="w-full rounded-xl border bg-white px-4 py-3" /><button disabled={busy || !chosen.length} onClick={() => void performAction("price")} className="w-full rounded-xl border bg-white py-3 text-sm disabled:opacity-40">선택 상품에 문구 적용</button><p className="text-xs text-slate-500">카페24 상품 설정에서 대체문구 사용 여부가 활성화되어 있어야 화면에 표시될 수 있습니다.</p></div>}</div>
      </div>
    </section>
    {message && <div role="status" className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"><AlertCircle size={18} className="shrink-0" /><span>{message}</span></div>}
    {busy && <div className="flex items-center justify-center gap-2 py-3 text-sm text-slate-500"><Loader2 size={17} className="animate-spin" />처리 중입니다...</div>}
  </div></main>;
}
