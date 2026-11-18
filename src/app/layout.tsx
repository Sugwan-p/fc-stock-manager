import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'FC 상품 품절관리', description: '카페24 2개 쇼핑몰 상품관리' };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="ko"><body>{children}</body></html>; }
