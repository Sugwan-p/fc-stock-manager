import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail } from '@/lib/http';
export async function GET() {
  try { await requireAdmin(); const { data, error } = await db().from('fc_release_queue').select('mall_id,product_no,memo,created_at').order('created_at', { ascending: false }); if (error) throw error; return NextResponse.json({ items: data || [] }); }
  catch(e) { return fail(e); }
}
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const { items } = await req.json() as { items: { mall: string; product_no: number; memo?: string }[] };
    if (!Array.isArray(items) || !items.length || items.length > 200 || items.some(x => !/^[a-z0-9_-]{2,40}$/.test(x.mall) || !Number.isSafeInteger(x.product_no) || x.product_no <= 0 || (x.memo || '').length > 200)) throw new Error('BAD_REQUEST');
    const { error } = await db().from('fc_release_queue').upsert(items.map(x => ({ mall_id: x.mall, product_no: x.product_no, memo: x.memo || '' })), { onConflict: 'mall_id,product_no' });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch(e) { return fail(e); }
}
export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin(); const { items } = await req.json() as { items: { mall: string; product_no: number }[] };
    if (!Array.isArray(items) || !items.length || items.length > 200 || items.some(x => !/^[a-z0-9_-]{2,40}$/.test(x.mall) || !Number.isSafeInteger(x.product_no) || x.product_no <= 0)) throw new Error('BAD_REQUEST');
    for (const x of items) { const { error } = await db().from('fc_release_queue').delete().eq('mall_id', x.mall).eq('product_no', x.product_no); if (error) throw error; }
    return NextResponse.json({ ok: true });
  } catch(e) { return fail(e); }
}
