import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail } from '@/lib/http';
export async function GET() {
  try {
    await requireAdmin();
    const { data, error } = await db().from('fc_malls').select('mall_id,access_expires_at,refresh_expires_at').order('mall_id');
    if (error) throw error;
    return NextResponse.json({ malls: data || [] });
  } catch(e) { return fail(e); }
}
