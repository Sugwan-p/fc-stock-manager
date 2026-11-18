import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { api, mallId } from '@/lib/cafe24';
import { db } from '@/lib/db';
import { fail } from '@/lib/http';
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const requested = req.nextUrl.searchParams.get('mall') || 'all';
    const search = (req.nextUrl.searchParams.get('q') || '').trim();
    const page = Math.max(1, Math.min(10000, Number(req.nextUrl.searchParams.get('page')) || 1));
    const { data: malls, error } = await db().from('fc_malls').select('mall_id').order('mall_id');
    if (error) throw error;
    const ids = (malls || []).map(x => x.mall_id).filter(x => requested === 'all' || x === requested);
    if (requested !== 'all') mallId(requested);
    const queueMode = req.nextUrl.searchParams.get('mode') === 'queue';
    const { data: queueRows } = queueMode ? await db().from('fc_release_queue').select('mall_id,product_no') : { data: [] as {mall_id:string;product_no:number}[] };
    const results = await Promise.all(ids.map(async mall => {
      try {
        const qs = new URLSearchParams({ limit: '50', offset: String((page - 1) * 50) });
        if (search) qs.set('product_name', search);
        const data = queueMode ? { products: (await Promise.all((queueRows || []).filter(x => x.mall_id === mall).map(async x => { try { const one = await api(mall, `products/${x.product_no}`) as { product?: Record<string,unknown> }; return one.product; } catch { return undefined; } }))).filter(Boolean) as Record<string,unknown>[] } : await api(mall, `products?${qs.toString()}`) as { products?: Record<string, unknown>[] };
        return { mall, products: (data.products || []).map(p => ({ mall, product_no: Number(p.product_no), product_code: String(p.product_code || ''), product_name: String(p.product_name || ''), selling: p.selling === 'T', display: p.display === 'T', price_content: String(p.price_content || '') })), error: '' };
      } catch { return { mall, products: [], error: `${mall} 상품 조회 실패 (연결 또는 권한 확인)` }; }
    }));
    return NextResponse.json({ products: results.flatMap(x => x.products), errors: results.filter(x => x.error).map(x => x.error), page });
  } catch(e) { return fail(e); }
}
