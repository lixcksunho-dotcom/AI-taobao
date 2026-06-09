import Link from 'next/link'

const NAV = [
  { href: '/dashboard',  label: '대시보드' },
  { href: '/orders',     label: '주문 관리' },
  { href: '/products',   label: '상품 관리' },
  { href: '/pipeline',   label: '번역/지재권' },
  { href: '/trademark',  label: '상표 관리' },
  { href: '/cs',         label: 'CS 문의' },
  { href: '/scraper',    label: '스크래퍼' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 bg-gray-900 text-white flex flex-col py-8 px-4 gap-2">
        <p className="text-lg font-bold mb-6 px-2">타오바오 관리자</p>
        {NAV.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className="px-3 py-2 rounded-lg hover:bg-gray-700 text-sm transition-colors"
          >
            {item.label}
          </Link>
        ))}
      </aside>
      <main className="flex-1 bg-gray-50">{children}</main>
    </div>
  )
}
