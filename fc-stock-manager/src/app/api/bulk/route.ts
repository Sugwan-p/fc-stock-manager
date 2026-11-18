import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { api } from '@/lib/cafe24';
import { db } from '@/lib/db';
import { fail } from '@/lib/http';
type Item = { mall: string; product_no: number };
type Action = 'stop' | 'resume' | 'show' | 'hide' | 'price';
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json() as { items?: Item[]; action?: Action; text?: string };
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 200 || !['stop','resume','show','hide','price'].includes(body.action || '')) throw new Error('BAD_REQUEST');
    if (body.action === 'price' && (typeof body.text !== 'string' || body.text.length > 20)) throw new Error('BAD_REQUEST');
    const { data: rows, error } = await db().from('fc_malls').select('mall_id');
    if (error) throw error;
    const allowed = new Set((rows || []).map(x => x.mall_id));
    const unique = [...new Map(body.items.map(x => [`${x.mall}:${x.product_no}`, x])).values()];
    if (unique.some(x => !allowed.has(x.mall) || !Number.isSafeInteger(x.product_no) || x.product_no <= 0)) throw new Error('BAD_REQUEST');
    const results: { mall: string; product_no: number; ok: boolean; error?: string }[] = [];
    for (const item of unique) {
      try {
        const request = body.action === 'stop' ? { selling: 'F' } : body.action === 'resume' ? { selling: 'T' } : body.action === 'show' ? { display: 'T' } : body.action === 'hide' ? { display: 'F' } : { price_content: body.text };
        await api(item.mall, `products/${item.product_no}`, { method: 'PUT', body: { request } });
        if (body.action === 'resume') await db().from('fc_release_queue').delete().eq('mall_id', item.mall).eq('product_no', item.product_no);
        results.push({ ...item, ok: true });
      } catch { results.push({ ...item, ok: false, error: '수정 실패. 상품 설정 또는 API 권한 확인' }); }
    }
    return NextResponse.json({ results, success: results.filter(x => x.ok).length, failed: results.filter(x => !x.ok).length });
  } catch(e) { return fail(e); }
}
