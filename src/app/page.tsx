

"use client";



import {

  useCallback,

  useEffect,

  useMemo,

  useState,
  useRef,

  type FormEvent,

} from "react";

import {

  AlertCircle,

  Ban,

  CheckCircle2,

  ChevronDown,

  ChevronLeft,

  ChevronRight,

  ClipboardList,

  Loader2,

  LogOut,

  Package,

  Plus,

  RefreshCw,

  Search,

  Settings2,

  ShoppingBag,

} from "lucide-react";
import { ConfirmDialog, InputDialog, ResultDialog, type ResultInfo } from "@/components/action-dialogs";



type Product = {

  mall: string;

  product_no: number;

  product_code: string;
  custom_product_code?: string;

  product_name: string;

  selling: boolean;

  display: boolean;

  price_content: string;

};



type Mall = {

  mall_id: string;

  refresh_expires_at: string;

};



type QueueItem = {

  mall_id: string;

  product_no: number;

  memo: string;

};



type Tab = "stop" | "resume" | "queue";

type Action = "stop" | "resume" | "show" | "hide" | "price";

type AuthStatus = "checking" | "authenticated" | "login";



type ProductResponse = {

  products: Product[];

  errors?: string[];
  hasMore?: boolean;

};



const productKey = (product: Product) =>

  `${product.mall}:${product.product_no}`;



async function api<T>(

  url: string,

  options?: RequestInit

): Promise<T> {

  const response = await fetch(url, {

    ...options,

    headers: {

      "Content-Type": "application/json",

      ...(options?.headers || {}),

    },

    cache: "no-store",

  });



  const data: unknown = await response.json().catch(() => ({}));



  if (!response.ok) {

    const result = data as { error?: string };

    throw new Error(

      result.error || `요청 실패 (${response.status})`

    );

  }



  return data as T;

}



function getErrorMessage(

  error: unknown,

  fallback: string

): string {

  return error instanceof Error ? error.message : fallback;

}



export default function HomePage() {
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; description: string; yesLabel: string; noLabel: string } | null>(null);
  const [inputDialog, setInputDialog] = useState<{ title: string; description: string } | null>(null);
  const [resultDialog, setResultDialog] = useState<ResultInfo | null>(null);
  const confirmResolver = useRef<((answer: boolean) => void) | null>(null);
  const inputResolver = useRef<((answer: string | null) => void) | null>(null);
  const askConfirm = (title: string, description: string, yesLabel = "예", noLabel = "아니요") => new Promise<boolean>((resolve) => {
    confirmResolver.current = resolve;
    setConfirmDialog({ title, description, yesLabel, noLabel });
  });
  const askInput = (title: string, description: string) => new Promise<string | null>((resolve) => {
    inputResolver.current = resolve;
    setInputDialog({ title, description });
  });
  const closeConfirm = (answer: boolean) => {
    setConfirmDialog(null);
    confirmResolver.current?.(answer);
    confirmResolver.current = null;
  };
  const closeInput = (answer: string | null) => {
    setInputDialog(null);
    inputResolver.current?.(answer);
    inputResolver.current = null;
  };


  const [authStatus, setAuthStatus] =

    useState<AuthStatus>("checking");



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



  const loadMalls = useCallback(async () => {

    const data = await api<{ malls: Mall[] }>("/api/malls");

    setMalls(data.malls || []);

  }, []);



  const loadQueue = useCallback(async () => {

    const data = await api<{ items: QueueItem[] }>("/api/queue");

    setQueue(data.items || []);

  }, []);



  const loadProducts = useCallback(

    async (

      currentMall: string,

      currentTab: Tab,

      currentPage: number,

      currentQuery: string

    ) => {

      setBusy(true);



      try {

        const params = new URLSearchParams({

          mall: currentMall,

          page: String(currentPage),

          q: currentQuery,
          mode: currentTab,

        });



        if (currentTab === "queue") {

          params.set("mode", "queue");

        }



        const data = await api<ProductResponse>(

          `/api/products?${params.toString()}`

        );



        setProducts(data.products || []);
        setHasMore(Boolean(data.hasMore));

        setSelected([]);



        if (data.errors?.length) {

          setMessage(data.errors.join(" / "));

        }

      } catch (error) {

        setProducts([]);

        setMessage(

          getErrorMessage(error, "상품 조회에 실패했습니다.")

        );

      } finally {

        setBusy(false);

      }

    },

    []

  );



  useEffect(() => {

    let cancelled = false;



    async function initialize() {

      try {

        const data = await api<{ malls: Mall[] }>(

          "/api/malls"

        );



        if (cancelled) return;



        setMalls(data.malls || []);

        setAuthStatus("authenticated");



        try {

          const queueData = await api<{

            items: QueueItem[];

          }>("/api/queue");



          if (!cancelled) {

            setQueue(queueData.items || []);

          }

        } catch (error) {

          if (!cancelled) {

            setMessage(

              getErrorMessage(

                error,

                "해제 예정 목록을 불러오지 못했습니다."

              )

            );

          }

        }

      } catch {

        if (!cancelled) {

          setAuthStatus("login");

        }

      }

    }



    void initialize();



    return () => {

      cancelled = true;

    };

  }, []);



  useEffect(() => {

    if (authStatus !== "authenticated") return;



    void loadProducts(

      mall,

      tab,

      page,

      searchQuery

    );

  }, [

    authStatus,

    mall,

    tab,

    page,

    searchQuery,

    loadProducts,

  ]);



  const visible = useMemo(() => {

    return products.filter((product) => {

      if (tab === "stop") {

        return product.selling;

      }



      if (tab === "resume") {

        return !product.selling;

      }



      return queue.some(

        (item) =>

          item.mall_id === product.mall &&

          item.product_no === product.product_no

      );

    });

  }, [products, queue, tab]);



  const chosen = useMemo(() => {

    return products.filter((product) =>

      selected.includes(productKey(product))

    );

  }, [products, selected]);



  const scopedQueue = useMemo(() => {

    return queue.filter(

      (item) =>

        mall === "all" || item.mall_id === mall

    );

  }, [queue, mall]);



  const stats = [

    {

      label: "조회 상품",

      value: products.length,

      icon: ShoppingBag,

      color: "text-blue-600",

      bg: "bg-blue-50",

    },

    {

      label: "판매 중",

      value: products.filter((p) => p.selling).length,

      icon: CheckCircle2,

      color: "text-emerald-600",

      bg: "bg-emerald-50",

    },

    {

      label: "판매안함",

      value: products.filter((p) => !p.selling).length,

      icon: Ban,

      color: "text-rose-600",

      bg: "bg-rose-50",

    },

    {

      label: "해제 예정",

      value: scopedQueue.length,

      icon: ClipboardList,

      color: "text-amber-600",

      bg: "bg-amber-50",

    },

  ];



  function changeTab(next: Tab) {

    setTab(next);

    setPage(1);

    setQuery("");

    setSearchQuery("");

    setSelected([]);

    setMessage("");

  }



  async function login(event: FormEvent<HTMLFormElement>) {

    event.preventDefault();



    if (busy) return;



    setBusy(true);

    setMessage("");



    try {

      await api("/api/auth/login", {

        method: "POST",

        body: JSON.stringify({ password }),

      });



      setPassword("");



      await loadMalls();

      await loadQueue();



      setAuthStatus("authenticated");

    } catch (error) {

      setMessage(

        getErrorMessage(error, "로그인에 실패했습니다.")

      );

    } finally {

      setBusy(false);

    }

  }



  async function logout() {

    try {

      await api("/api/auth/logout", {

        method: "POST",

      });



      setAuthStatus("login");

      setMalls([]);

      setProducts([]);

      setQueue([]);

      setSelected([]);

      setMessage("");

    } catch (error) {

      setMessage(

        getErrorMessage(error, "로그아웃에 실패했습니다.")

      );

    }

  }



  async function refreshAll() {

    setMessage("");



    try {

      await Promise.all([

        loadMalls(),

        loadQueue(),

        loadProducts(mall, tab, page, searchQuery),

      ]);

    } catch (error) {

      setMessage(

        getErrorMessage(error, "새로고침에 실패했습니다.")

      );

    }

  }



  async function performAction(action: Action) {
    if (busy || chosen.length === 0) return;
    const items = chosen.map((p) => ({ mall: p.mall, product_no: p.product_no }));
    const labels: Record<Action, string> = { stop: "품절 처리", resume: "품절 해제", show: "진열함", hide: "진열안함", price: "대체문구 변경" };
    if (!(await askConfirm(`${labels[action]} 확인`, `선택한 ${items.length}개 상품을 ${labels[action]}하시겠습니까?`, "예, 진행", "아니요"))) return;

    let text: string | undefined;
    let clearPriceContent = false;
    if (action === "stop") {
      const wantsText = await askConfirm("대체 문구 등록", "품절 처리하면서 대체 문구도 등록하시겠습니까? 아니요를 선택하면 기존 문구는 변경하지 않고 품절 처리합니다.", "예, 등록", "아니요, 품절만");
      if (wantsText) {
        const entered = await askInput("대체 문구 입력", "최대 20자까지 입력할 수 있습니다. 빈칸으로 저장하면 문구 변경 없이 품절 처리됩니다.");
        if (entered === null) return;
        if (entered.trim()) text = entered.trim();
      }
    }
    if (action === "resume") {
      const hasPhrase = chosen.some((p) => Boolean(p.price_content?.trim()));
      if (hasPhrase) clearPriceContent = await askConfirm("기존 대체 문구 삭제", "선택 상품 중 기존 대체 문구가 있습니다. 문구를 삭제한 뒤 품절 해제하시겠습니까? 아니요를 선택하면 문구를 유지합니다.", "예, 삭제 후 해제", "아니요, 유지 후 해제");
    }
    if (action === "price") text = priceText;
    setBusy(true);
    setMessage("");
    try {
      const result = await api<{ success: number; failed: number; results?: { mall: string; product_no: number; ok: boolean; error?: string }[] }>("/api/bulk", {
        method: "POST",
        body: JSON.stringify({ items, action, ...(text !== undefined ? { text } : {}), ...(action === "resume" ? { clearPriceContent } : {}) }),
      });
      const failed = (result.results || []).filter((r) => !r.ok);
      const warnings = (result.results || []).filter((r) => r.ok && r.error);
      setResultDialog({
        title: result.failed === 0 && warnings.length === 0 ? `${labels[action]} 완료` : `${labels[action]} 결과`,
        success: result.success,
        failed: result.failed,
        details: [...failed, ...warnings].slice(0, 8).map((r) => `${r.mall} / ${r.product_no}: ${r.error || "실패"}`),
      });
      try { await Promise.all([loadQueue(), loadProducts(mall, tab, page, searchQuery)]); }
      catch (refreshError) { setMessage(getErrorMessage(refreshError, "처리 후 목록 새로고침 실패")); }
    } catch (error) {
      setResultDialog({ title: `${labels[action]} 실패`, success: 0, failed: items.length, details: [getErrorMessage(error, "요청 실패")] });
    } finally { setBusy(false); }
  }

  async function updateQueue(

    method: "POST" | "DELETE"

  ) {

    if (busy || chosen.length === 0) return;



    setBusy(true);

    setMessage("");



    try {

      await api("/api/queue", {

        method,

        body: JSON.stringify({

          items: chosen.map((product) => ({

            mall: product.mall,

            product_no: product.product_no,

          })),

        }),

      });



      await loadQueue();

      await loadProducts(

        mall,

        tab,

        page,

        searchQuery

      );



      setResultDialog({ title: method === "POST" ? "해제 예정 등록 완료" : "해제 예정 삭제 완료", success: chosen.length, failed: 0, details: [] });

    } catch (error) {

      setMessage(

        getErrorMessage(error, "목록 변경에 실패했습니다.")

      );

    } finally {

      setBusy(false);

    }

  }



  function toggleProduct(

    product: Product,

    checked: boolean

  ) {

    const id = productKey(product);



    setSelected((current) =>

      checked

        ? [...new Set([...current, id])]

        : current.filter((item) => item !== id)

    );

  }



  function toggleAll(checked: boolean) {

    setSelected(

      checked ? visible.map(productKey) : []

    );

  }



  function submitSearch(

    event: FormEvent<HTMLFormElement>

  ) {

    event.preventDefault();



    setPage(1);

    setSearchQuery(query);



    if (page === 1 && searchQuery === query) {

      void loadProducts(mall, tab, 1, query);

    }

  }



  if (authStatus === "checking") {

    return (

      <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">

        <Loader2

          className="mr-2 animate-spin"

          size={20}

        />

        연결 확인 중...

      </main>

    );

  }



  if (authStatus === "login") {

    return (

      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">

        <form

          onSubmit={login}

          className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"

        >

          <h1 className="text-xl font-bold text-slate-900">

            FC 상품 품절관리

          </h1>



          <p className="text-sm text-slate-500">

            관리자 로그인

          </p>



          <input

            type="password"

            value={password}

            onChange={(event) =>

              setPassword(event.target.value)

            }

            placeholder="관리자 비밀번호"

            autoComplete="current-password"

            className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500"

          />



          <button

            type="submit"

            disabled={busy || !password}

            className="w-full rounded-xl bg-slate-900 py-3 font-semibold text-white disabled:opacity-40"

          >

            {busy ? "로그인 중..." : "로그인"}

          </button>



          {message && (

            <p

              role="alert"

              className="text-sm text-rose-600"

            >

              {message}

            </p>

          )}

        </form>

      </main>

    );

  }



  return (

    <main className="min-h-screen bg-slate-50 text-slate-900">

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-8 md:py-8">

        {/* 헤더 */}

        <header className="flex flex-wrap items-center justify-between gap-4">

          <h1 className="text-2xl font-bold tracking-tight">

            FC 상품 품절관리

          </h1>



          <button

            type="button"

            onClick={() => void logout()}

            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50"

          >

            <LogOut size={16} />

            로그아웃

          </button>

        </header>



        {/* 쇼핑몰 선택 */}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

          <div className="flex flex-wrap items-end gap-3">

            <div className="min-w-48 flex-1">

              <label

                htmlFor="mall-select"

                className="mb-2 block text-sm font-semibold"

              >

                관리 쇼핑몰

              </label>



              <select

                id="mall-select"

                value={mall}

                onChange={(event) => {

                  setMall(event.target.value);

                  setPage(1);

                  setSelected([]);

                }}

                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-blue-500"

              >

                <option value="all">

                  전체 쇼핑몰

                </option>



                {malls.map((item) => (

                  <option

                    key={item.mall_id}

                    value={item.mall_id}

                  >

                    {item.mall_id}

                  </option>

                ))}

              </select>

            </div>



            <button

              type="button"

              disabled={busy}

              onClick={() => void refreshAll()}

              className="flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-3 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"

            >

              <RefreshCw size={17} />

              새로고침

            </button>

          </div>



          {malls.length < 2 && (

            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">

              <input

                value={newMall}

                onChange={(event) =>

                  setNewMall(event.target.value)

                }

                placeholder="쇼핑몰 ID 입력"

                className="min-w-0 flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm"

              />



              <button

                type="button"

                disabled={!newMall.trim()}

                onClick={() => {

                  const mallId = newMall.trim();



                  window.location.href =

                    `/api/cafe24/connect?mall=${encodeURIComponent(mallId)}`;

                }}

                className="flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"

              >

                <Plus size={16} />

                쇼핑몰 연결

              </button>

            </div>

          )}

        </section>



        {/* 현황 카드 */}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">

          {stats.map((stat) => {

            const Icon = stat.icon;



            return (

              <div

                key={stat.label}

                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"

              >

                <div className="flex items-center justify-between gap-2">

                  <p className="text-sm font-medium text-slate-500">

                    {stat.label}

                  </p>



                  <div

                    className={`rounded-xl p-2 ${stat.bg} ${stat.color}`}

                  >

                    <Icon size={19} />

                  </div>

                </div>



                <p className="mt-4 text-3xl font-bold">

                  {stat.value.toLocaleString()}

                </p>

              </div>

            );

          })}

        </section>



        {/* 상품 관리 */}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

          {/* 탭 */}

          <div className="grid grid-cols-3 border-b border-slate-200 px-4 md:px-6">

            {(

              [

                {

                  id: "stop",

                  label: "품절 처리",

                },

                {

                  id: "resume",

                  label: "품절 해제",

                },

                {

                  id: "queue",

                  label: "해제 예정",

                },

              ] as const

            ).map((item) => (

              <button

                key={item.id}

                type="button"

                onClick={() => changeTab(item.id)}

                className={`border-b-2 px-2 py-5 text-sm font-semibold transition md:text-base ${

                  tab === item.id

                    ? "border-blue-600 text-blue-600"

                    : "border-transparent text-slate-500 hover:text-slate-900"

                }`}

              >

                {item.label}



                {item.id === "queue" && (

                  <span className="ml-1 text-xs">

                    ({scopedQueue.length})

                  </span>

                )}

              </button>

            ))}

          </div>



          <div className="space-y-5 p-4 md:p-6">

            {/* 제목 */}

            <div>

              <h2 className="text-lg font-bold">

                {tab === "stop"

                  ? "상품 품절 처리"

                  : tab === "resume"

                    ? "상품 품절 해제"

                    : "해제 예정 상품 관리"}

              </h2>



              <p className="mt-1 text-sm text-slate-500">

                {tab === "stop"

                  ? "판매 중인 상품을 선택하여 일괄 처리합니다."

                  : tab === "resume"

                    ? "판매안함 상품을 선택하여 판매를 재개합니다."

                    : "등록된 상품을 확인한 후 직접 품절 해제합니다."}

              </p>

            </div>



            {/* 검색 */}

            <form

              onSubmit={submitSearch}

              className="flex gap-2"

            >

              <div className="relative flex-1">

                <Search

                  size={18}

                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"

                />



                <input

                  value={query}

                  onChange={(event) =>

                    setQuery(event.target.value)

                  }

                  placeholder="상품명 또는 상품코드 검색"

                  className="w-full rounded-xl border border-slate-200 py-3 pl-11 pr-4 outline-none focus:border-blue-500"

                />

              </div>



              <button

                type="submit"

                disabled={busy}

                className="rounded-xl bg-slate-800 px-5 text-sm font-semibold text-white disabled:opacity-50"

              >

                검색

              </button>

            </form>



            {/* 전체 선택 */}

            <div className="flex flex-wrap items-center justify-between gap-2">

              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">

                <input

                  type="checkbox"

                  checked={

                    visible.length > 0 &&

                    visible.every((product) =>

                      selected.includes(

                        productKey(product)

                      )

                    )

                  }

                  onChange={(event) =>

                    toggleAll(event.target.checked)

                  }

                  className="h-4 w-4 accent-blue-600"

                />

                전체 선택

              </label>



              <p className="text-sm text-slate-500">

                <span className="font-semibold text-blue-600">

                  {selected.length}개 선택

                </span>

                {" · "}

                {visible.length}개 표시

              </p>

            </div>



            {/* 상품 목록 */}

            <div className="max-h-[540px] space-y-2 overflow-y-auto">

              {visible.map((product) => (

                <label

                  key={productKey(product)}

                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-4 transition hover:border-blue-200 hover:bg-blue-50/30"

                >

                  <input

                    type="checkbox"

                    checked={selected.includes(

                      productKey(product)

                    )}

                    onChange={(event) =>

                      toggleProduct(

                        product,

                        event.target.checked

                      )

                    }

                    className="h-4 w-4 accent-blue-600"

                  />



                  <div className="min-w-0 flex-1">

                    <p className="break-words text-sm font-semibold">

                      {product.product_name}

                    </p>



                    <p className="mt-1 text-xs text-slate-500">

                      {product.mall}

                      {" · "}

                      {product.product_code ||

                        `상품번호 ${product.product_no}`}

                    </p>

                  </div>



                  <span

                    className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ${

                      product.selling

                        ? "bg-emerald-50 text-emerald-700"

                        : "bg-rose-50 text-rose-700"

                    }`}

                  >

                    {product.selling

                      ? "판매함"

                      : "판매안함"}

                  </span>

                </label>

              ))}



              {visible.length === 0 && (

                <div className="flex flex-col items-center justify-center rounded-xl bg-slate-50 px-4 py-14 text-center">

                  <Package

                    size={32}

                    className="mb-3 text-slate-300"

                  />



                  <p className="text-sm font-medium text-slate-500">

                    표시할 상품이 없습니다.

                  </p>

                </div>

              )}

            </div>



            {/* 페이지 이동 */}

            {tab !== "queue" && (

              <div className="flex items-center justify-center gap-4">

                <button

                  type="button"

                  disabled={busy || page === 1}

                  onClick={() =>

                    setPage((current) =>

                      Math.max(1, current - 1)

                    )

                  }

                  className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-30"

                >

                  <ChevronLeft size={16} />

                  이전

                </button>



                <span className="text-sm font-medium text-slate-600">

                  {page} 페이지

                </span>



                <button

                  type="button"

                  disabled={

                    busy || !hasMore

                  }

                  onClick={() =>

                    setPage((current) => current + 1)

                  }

                  className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-30"

                >

                  다음

                  <ChevronRight size={16} />

                </button>

              </div>

            )}



            {/* 일괄 처리 */}

            <div className="border-t border-slate-100 pt-5">

              {tab === "stop" && (

                <button

                  type="button"

                  disabled={

                    busy || selected.length === 0

                  }

                  onClick={() =>

                    void performAction("stop")

                  }

                  className="w-full rounded-xl bg-rose-600 py-4 font-bold text-white hover:bg-rose-700 disabled:opacity-40"

                >

                  선택 {selected.length}개 일괄 품절 처리

                </button>

              )}



              {tab === "resume" && (

                <div className="grid gap-3 md:grid-cols-2">

                  <button

                    type="button"

                    disabled={

                      busy || selected.length === 0

                    }

                    onClick={() =>

                      void performAction("resume")

                    }

                    className="rounded-xl bg-blue-600 py-4 font-bold text-white disabled:opacity-40"

                  >

                    선택 {selected.length}개 품절 해제

                  </button>



                  <button

                    type="button"

                    disabled={

                      busy || selected.length === 0

                    }

                    onClick={() =>

                      void updateQueue("POST")

                    }

                    className="rounded-xl border border-blue-200 bg-blue-50 py-4 font-bold text-blue-700 disabled:opacity-40"

                  >

                    해제 예정에 등록

                  </button>

                </div>

              )}



              {tab === "queue" && (

                <div className="grid gap-3 md:grid-cols-2">

                  <button

                    type="button"

                    disabled={

                      busy || selected.length === 0

                    }

                    onClick={() =>

                      void performAction("resume")

                    }

                    className="rounded-xl bg-blue-600 py-4 font-bold text-white disabled:opacity-40"

                  >

                    선택 {selected.length}개 직접 품절 해제

                  </button>



                  <button

                    type="button"

                    disabled={

                      busy || selected.length === 0

                    }

                    onClick={() =>

                      void updateQueue("DELETE")

                    }

                    className="rounded-xl border border-slate-200 py-4 font-bold text-slate-600 disabled:opacity-40"

                  >

                    예정 목록에서 삭제

                  </button>

                </div>

              )}

            </div>



            {/* 추가 설정 */}

            <div className="border-t border-slate-100 pt-5">

              <button

                type="button"

                onClick={() =>

                  setSettingsOpen(

                    (previous) => !previous

                  )

                }

                className="flex w-full items-center justify-between text-sm font-semibold text-slate-600"

              >

                <span className="flex items-center gap-2">

                  <Settings2 size={17} />

                  추가 상품 설정

                </span>



                <ChevronDown

                  size={18}

                  className={`transition-transform ${

                    settingsOpen ? "rotate-180" : ""

                  }`}

                />

              </button>



              {settingsOpen && (

                <div className="mt-4 space-y-4 rounded-xl bg-slate-50 p-4">

                  <p className="text-sm font-semibold">

                    선택 상품 진열 설정

                  </p>



                  <div className="grid grid-cols-2 gap-3">

                    <button

                      type="button"

                      disabled={

                        busy || selected.length === 0

                      }

                      onClick={() =>

                        void performAction("show")

                      }

                      className="rounded-xl border bg-white p-3 text-sm font-semibold disabled:opacity-40"

                    >

                      진열함

                    </button>



                    <button

                      type="button"

                      disabled={

                        busy || selected.length === 0

                      }

                      onClick={() =>

                        void performAction("hide")

                      }

                      className="rounded-xl border bg-white p-3 text-sm font-semibold disabled:opacity-40"

                    >

                      진열안함

                    </button>

                  </div>



                  <p className="text-sm font-semibold">

                    판매가 대체문구

                  </p>



                  <input

                    maxLength={20}

                    value={priceText}

                    onChange={(event) =>

                      setPriceText(event.target.value)

                    }

                    placeholder="예: 가격문의, 일시품절"

                    className="w-full rounded-xl border bg-white px-4 py-3 text-sm"

                  />



                  <button

                    type="button"

                    disabled={

                      busy || selected.length === 0

                    }

                    onClick={() =>

                      void performAction("price")

                    }

                    className="w-full rounded-xl border bg-white py-3 text-sm font-semibold disabled:opacity-40"

                  >

                    선택 상품에 문구 적용

                  </button>



                  <p className="text-xs text-slate-500">

                    대체문구 사용 여부는 카페24 API

                    지원 및 설정을 확인해야 합니다.

                  </p>

                </div>

              )}

            </div>

          </div>

        </section>



        {/* 결과 메시지 */}



        {message && (

          <div

            role="status"

            className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"

          >

            <AlertCircle

              size={18}

              className="shrink-0"

            />

            <span>{message}</span>

          </div>

        )}



        {busy && (

          <div className="flex items-center justify-center gap-2 py-3 text-sm text-slate-500">

            <Loader2

              size={17}

              className="animate-spin"

            />

            처리 중입니다...

          </div>

        )}

      </div>

        <ConfirmDialog open={confirmDialog !== null} title={confirmDialog?.title || ""} description={confirmDialog?.description || ""} yesLabel={confirmDialog?.yesLabel || "예"} noLabel={confirmDialog?.noLabel || "아니요"} onAnswer={closeConfirm} />
        <InputDialog open={inputDialog !== null} title={inputDialog?.title || ""} description={inputDialog?.description || ""} onAnswer={closeInput} />
        <ResultDialog info={resultDialog} onClose={() => setResultDialog(null)} />
    </main>

  );

}
