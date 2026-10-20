import './style.css';
export const dynamic='force-dynamic';
export const metadata={title:'Quotient | Procurement workspace',description:'Compare supplier quotations and record purchasing decisions.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body suppressHydrationWarning>{children}</body></html>;}
