'use client';
import Link from 'next/link';
export default function ErrorPage({reset}:{reset:()=>void}){return <main className="auth-page"><div className="auth-body"><p className="eyebrow">WORKSPACE INTERRUPTED</p><h1>Something went wrong.</h1><p className="auth-subtitle">Try loading the workspace again. Saved organization data remains in your account.</p><button className="primary" onClick={reset}>Try again</button><div className="invite-links"><Link href="/login">Sign in</Link><Link href="/demo">Open demo</Link></div></div></main>;}
