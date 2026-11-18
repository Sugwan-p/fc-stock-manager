'use client';
import { useEffect, useState } from 'react';
import { Package, RefreshCw, Search, LogOut, Plus, Settings2 } from 'lucide-react';
type Product = { mall: string; product_no: number; product_code: string; product_name: string; selling: boolean; display: boolean; price_content: string };
type Mall = { mall_id: string; refresh_expires_at: string };
type QueueItem = { mall_id: string; product_no: number; memo: string };
type Action = 'stop' | 'resume' | 'show' | 'hide' | 'price';
const key = (p: { mall: string; product_no: number }) => `${p.mall}:${p.product_no}`;
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }, cache: 'no-store' });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || '요청 실패');
  return data as T;
}
export default function Home() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [malls, setMalls] = useState<Mall[]>([]);
  const [mall, setMall] = useState('all');
  const [newMall, setNewMall] = useState('');
  const [tab, setTab] = useState<'stop' | 'resume' | 'queue'>('stop');
  const [products, setProducts] = useState<Product[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [settings, setSettings] = useState(false);
  const [priceText, setPriceText] = useState('');
  const loadMalls = async () => {
    const data = await request<{ malls: Mall[] }>('/api/malls');
    setMalls(data.malls); setAuthenticated(true);
  };
  const loadQueue = async () => {
    const data = await request<{ items: QueueItem[] }>('/api/queue'); setQueue(data.items);
  };
  const loadProducts = async (currentMall = mall, currentTab = tab, currentPage = page, currentQuery = query) => {
    setBusy(true);
    try {
      const params = new URLSearchParams({ mall: currentMall, page: String(currentPage), q: currentQuery });
      if (currentTab === 'queue') params.set('mode', 'queue');
      const data = await request<{ products: Product[]; errors: string[] }>(`/api/products?${params}`);
      setProducts(data.products); setSelected([]);
      if (data.errors.length) setMessage(data.errors.join(' / '));
    } catch(e) { setMessage(e instanceof Error ? e.message : '조회 실패'); }
    finally { setBusy(false); }
  };
  useEffect(() => { loadMalls().then(loadQueue).catch(() => setAuthenticated(false)); }, []);
  useEffect(() => { if (authenticated) void loadProducts(); }, [authenticated, mall, tab, page]);
  const changeTab = (next: typeof tab) => { setTab(next); setPage(1); setQuery(''); setSelected([]); setMessage(''); };
  const visible = products.filter(p => (tab === 'stop' ? p.selling : tab === 'resume' ? !p.selling : queue.some(q => q.mall_id === p.mall && q.product_no === p.product_no)) && (p.product_name + p.product_code + String(p.product_no)).toLowerCase().includes(query.toLowerCase()));
  const chosen = products.filter(p => selected.includes(key(p)));
  const act = async (action: Action) => {
    if (!chosen.length) return;
    const labels: Record<Action, string> = { stop: '판매안함(품절)', resume: '판매함(해제)', show: '진열함', hide: '진열안함', price: '판매가 대체문구 변경' };
    if (!window.confirm(`${chosen.length}개 상품에 '${labels[action]}'을 적용할까요?`)) return;
    setBusy(true);
    try {
      const data = await request<{ success: number; failed: number; results: { ok: boolean; mall: string; product_no: number }[] }>('/api/bulk', { method: 'POST', body: JSON.stringify({ items: chosen.map(p => ({ mall: p.mall, product_no: p.product_no })), action, text: priceText }) });
      setMessage(`처리 완료: 성공 ${data.success}건 / 실패 ${data.failed}건${data.failed ? ' (실패 상품은 다시 확인하세요)' : ''}`);
      await loadQueue(); await loadProducts();
    } catch(e) { setMessage(e instanceof Error ? e.message : '변경 실패'); }
    finally { setBusy(false); }
  };
  const queueAction = async (method: 'POST' | 'DELETE') => {
    if (!chosen.length) return;
    setBusy(true);
    try {
      await request('/api/queue', { method, body: JSON.stringify({ items: chosen.map(p => ({ mall: p.mall, product_no: p.product_no })) }) });
      await loadQueue(); await loadProducts();
      setMessage(method === 'POST' ? '해제 예정에 등록했습니다. 자동 해제되지 않습니다.' : '해제 예정에서 삭제했습니다.');
    } catch(e) { setMessage(e instanceof Error ? e.message : '목록 처리 실패'); }
    finally { setBusy(false); }
  };
  const login = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }); setPassword(''); await loadMalls(); await loadQueue(); }
    catch(e) { setMessage(e instanceof Error ? e.message : '로그인 실패'); }
    finally { setBusy(false); }
  };
  if (authenticated === null) return <main className="p-12 text-center">로딩 중...</main>;
  if (!authenticated) return <main className="flex min-h-screen items-center justify-center p-5"><form onSubmit={login} className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-8 shadow-sm border border-slate-200"><div className="flex items-center gap-2 text-xl font-bold"><Package className="text-blue-600"/> FC 상품 품절관리</div><p className="text-sm text-slate-500">관리자 비밀번호로 로그인하세요.</p><input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="관리자 비밀번호" className="w-full rounded-lg border p-3"/><button disabled={busy} className="w-full rounded-lg bg-blue-600 p-3 font-semibold text-white">로그인</button>{message && <p className="text-sm text-red-600">{message}</p>}</form></main>;
  return <main className="mx-auto max-w-6xl space-y-5 p-4 pb-16 md:p-8">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-bold"><Package className="text-blue-600"/> FC 상품 품절관리</h1><p className="mt-1 text-sm text-slate-500">쇼핑몰 2곳 · 상품은 카페24에서 실시간 조회</p></div><button onClick={async () => { await request('/api/auth/logout', { method: 'POST' }); location.reload(); }} className="flex items-center gap-1 rounded-lg border bg-white px-3 py-2 text-sm"><LogOut size={16}/> 로그아웃</button></header>
    <section className="rounded-xl border bg-white p-4"><div className="flex flex-wrap items-center gap-2"><select value={mall} onChange={e => { setMall(e.target.value); setPage(1); }} className="min-w-48 flex-1 rounded-lg border p-3"><option value="all">전체 쇼핑몰</option>{malls.map(m => <option key={m.mall_id} value={m.mall_id}>{m.mall_id}</option>)}</select><button disabled={busy} onClick={() => { setMessage(''); void loadProducts(); }} className="flex items-center gap-2 rounded-lg border px-4 py-3"><RefreshCw size={16}/> 새로고침</button></div><div className="mt-3 flex flex-wrap items-center gap-2"><input value={newMall} onChange={e => setNewMall(e.target.value)} placeholder="새 쇼핑몰 ID" className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"/><button disabled={malls.length >= 2 || !newMall.trim()} onClick={() => location.href = `/api/cafe24/connect?mall=${encodeURIComponent(newMall.trim())}`} className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-2 text-sm text-white"><Plus size={15}/> 쇼핑몰 연결</button></div><p className="mt-2 text-xs text-slate-500">최대 2개 쇼핑몰 운영 기준 · OAuth 연결은 각 쇼핑몰에서 승인</p></section>
    <div className="grid grid-cols-3 gap-2">{([{ id: 'stop', label: '1. 품절' }, { id: 'resume', label: '2. 품절해제' }, { id: 'queue', label: '3. 해제 예정' }] as const).map(t => <button key={t.id} onClick={() => changeTab(t.id)} className={`rounded-xl border px-2 py-4 text-sm font-bold md:text-base ${tab === t.id ? 'border-blue-600 bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>{t.label}{t.id === 'queue' && <span className="ml-1 text-xs">({queue.filter(q => mall === 'all' || q.mall_id === mall).length})</span>}</button>)}</div>
    <section className="space-y-4 rounded-xl border bg-white p-4 md:p-5"><div><h2 className="text-lg font-bold">{tab === 'stop' ? '판매 중인 상품 품절 처리' : tab === 'resume' ? '품절 상품 해제' : '직접 해제할 예정 상품'}</h2><p className="text-sm text-slate-500">{tab === 'queue' ? '등록만으로는 해제되지 않습니다. 직접 버튼을 눌러주세요.' : '상품을 체크한 다음 아래 버튼을 누르세요.'}</p></div>
    <form onSubmit={e => { e.preventDefault(); setPage(1); void loadProducts(mall, tab, 1, query); }} className="flex gap-2"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="상품명 · 상품코드 검색" className="min-w-0 flex-1 rounded-lg border px-3 py-3"/><button className="flex items-center gap-1 rounded-lg bg-slate-800 px-4 text-white"><Search size={16}/> 검색</button></form>
    <div className="flex items-center justify-between text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={visible.length > 0 && visible.every(p => selected.includes(key(p)))} onChange={e => setSelected(e.target.checked ? visible.map(key) : [])}/> 현재 목록 전체 선택</label><span className="text-slate-500">{selected.length}개 선택 · {visible.length}개 표시</span></div>
    <div className="max-h-[560px] space-y-2 overflow-y-auto">{visible.map(p => <label key={key(p)} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:bg-slate-50"><input type="checkbox" checked={selected.includes(key(p))} onChange={e => setSelected(s => e.target.checked ? [...s, key(p)] : s.filter(x => x !== key(p))}/><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{p.product_name}</p><p className="mt-1 text-xs text-slate-500">{p.mall} · {p.product_code || `상품번호 ${p.product_no}`}</p></div><span className={`shrink-0 rounded-md px-2 py-1 text-xs ${p.selling ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{p.selling ? '판매함' : '판매안함'}</span></label>)}{!visible.length && <p className="rounded-lg bg-slate-50 p-10 text-center text-sm text-slate-500">표시할 상품이 없습니다.</p>}</div>
    {tab !== 'queue' && <div className="flex items-center justify-between gap-3"><button disabled={busy || page === 1} onClick={() => setPage(p => p - 1)} className="rounded-lg border px-4 py-2">이전</button><span className="text-sm">{page} 페이지 · 쇼핑몰별 최대 50개씩</span><button disabled={busy || products.length === 0} onClick={() => setPage(p => p + 1)} className="rounded-lg border px-4 py-2">다음</button></div>}
    {tab === 'stop' ? <button disabled={busy || !selected.length} onClick={() => void act('stop')} className="w-full rounded-lg bg-red-600 p-4 font-bold text-white">선택 {selected.length}개 일괄 품절</button> : tab === 'resume' ? <div className="grid gap-2 md:grid-cols-2"><button disabled={busy || !selected.length} onClick={() => void act('resume')} className="rounded-lg bg-blue-600 p-4 font-bold text-white">선택 {selected.length}개 품절 해제</button><button disabled={busy || !selected.length} onClick={() => void queueAction('POST')} className="rounded-lg border border-blue-600 p-4 font-bold text-blue-700">해제 예정에 등록</button></div> : <div className="grid gap-2 md:grid-cols-2"><button disabled={busy || !selected.length} onClick={() => void act('resume')} className="rounded-lg bg-blue-600 p-4 font-bold text-white">선택 {selected.length}개 직접 품절 해제</button><button disabled={busy || !selected.length} onClick={() => void queueAction('DELETE')} className="rounded-lg border p-4 font-bold">예정 목록에서 삭제</button></div>}
    <button onClick={() => setSettings(x => !x)} className="flex items-center gap-2 text-sm font-semibold text-slate-600"><Settings2 size={17}/> 추가 설정 {settings ? '닫기' : '열기'}</button>
    {settings && <div className="space-y-3 rounded-lg bg-slate-50 p-4"><p className="text-sm">선택 상품 진열 및 판매가 대체문구</p><div className="grid grid-cols-2 gap-2"><button disabled={busy || !selected.length} onClick={() => void act('show')} className="rounded-lg border bg-white p-3">진열함</button><button disabled={busy || !selected.length} onClick={() => void act('hide')} className="rounded-lg border bg-white p-3">진열안함</button></div><input maxLength={20} value={priceText} onChange={e => setPriceText(e.target.value)} placeholder="판매가 대체문구 (20자 이내)" className="w-full rounded-lg border p-3"/><button disabled={busy || !selected.length} onClick={() => void act('price')} className="w-full rounded-lg border bg-white p-3">선택 상품에 문구 적용</button><p className="text-xs text-slate-500">대체문구 사용 체크박스는 별도 API 지원 확인이 필요합니다.</p></div>}
    </section>{message && <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">{message}</div>}{busy && <p className="text-center text-sm text-slate-500">처리 중입니다. 잠시 기다려주세요.</p>}
  </main>;
}
