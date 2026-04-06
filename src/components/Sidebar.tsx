"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  {
    section: "Main",
    items: [
      { href: "/", icon: "📊", label: "Dashboard" },
      { href: "/scan", icon: "📷", label: "Scan Document" },
    ],
  },
  {
    section: "Library",
    items: [
      { href: "/collections", icon: "📁", label: "Collections" },
      { href: "/documents", icon: "📄", label: "All Documents" },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <>
      <button className="mobile-menu-toggle" id="mobile-menu-toggle" onClick={() => {
        document.querySelector('.sidebar')?.classList.toggle('open');
      }}>
        ☰
      </button>
      <aside className="sidebar" id="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon">⚡</div>
            <span className="sidebar-logo-text">ScanDB</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          {navItems.map((section) => (
            <div key={section.section}>
              <div className="nav-section-label">{section.section}</div>
              {section.items.map((item) => {
                const isActive = pathname === item.href || 
                  (item.href !== "/" && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-link ${isActive ? "active" : ""}`}
                    onClick={() => {
                      document.querySelector('.sidebar')?.classList.remove('open');
                    }}
                  >
                    <span className="nav-link-icon">{item.icon}</span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div style={{ padding: "16px 12px", borderTop: "1px solid var(--border-secondary)" }}>
          <div style={{ 
            padding: "16px", 
            background: "var(--bg-glass)", 
            borderRadius: "var(--radius-md)", 
            border: "1px solid var(--border-secondary)",
            fontSize: "13px",
            color: "var(--text-secondary)"
          }}>
            <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
              💡 Quick Tip
            </div>
            Upload any document to extract text and save it to your database.
          </div>
        </div>
      </aside>
    </>
  );
}
