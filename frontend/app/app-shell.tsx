"use client";

import {
  BookOpenCheck,
  CalendarDays,
  FilePenLine,
  FolderOpen,
  Gauge,
  LibraryBig,
  LogOut,
  Menu,
  Settings,
  CircleUserRound,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "./providers";

const links = [
  { href: "/", label: "学习概览", icon: Gauge },
  { href: "/profile", label: "学习档案", icon: UserRound },
  { href: "/plan", label: "本周计划", icon: CalendarDays },
  { href: "/vocabulary", label: "词汇测评", icon: BookOpenCheck },
  { href: "/question-bank", label: "练习题库", icon: LibraryBig },
  { href: "/resources", label: "学习资料", icon: FolderOpen },
  { href: "/writing", label: "写作反馈", icon: FilePenLine },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, error, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const isAuthPage = pathname === "/login" || pathname === "/register";

  if (isAuthPage) return <div className="auth-shell">{children}</div>;

  const displayName = user?.display_name || user?.email.split("@")[0] || "学习者";
  const initial = displayName.slice(0, 1).toUpperCase();
  const signOut = () => { logout(); router.replace("/login"); };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand-lockup">
          <span className="brand-mark">IA</span>
          <div><strong>IELTS Coach</strong><small>自适应学习助手</small></div>
        </div>
        <nav className="side-nav" aria-label="主要功能">
          {links.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === href : pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={active ? "active" : ""} onClick={() => setOpen(false)}>
                <Icon size={19} />{label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-account">
          <Link href="/account" className="account-summary" onClick={() => setOpen(false)}>
            <span className="account-avatar">{initial}</span>
            <span><strong>{displayName}</strong><small>{user?.demo ? "演示账号" : user?.email}</small></span>
          </Link>
          <div className="account-actions">
            <Link href="/settings" onClick={() => setOpen(false)}><Settings size={16} />设置</Link>
            <button onClick={signOut}><LogOut size={16} />退出</button>
          </div>
          <div className="sidebar-footer">
            <span className={`connection-dot ${error ? "error" : ""}`} />
            {loading ? "正在验证登录状态" : error ? "后端连接失败" : "学习数据已同步"}
          </div>
        </div>
      </aside>
      {open && <button className="nav-backdrop" aria-label="关闭导航" onClick={() => setOpen(false)} />}
      <div className="app-content">
        <header className="mobile-header">
          <button aria-label="打开导航" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
          <strong>IELTS Coach</strong>
          <Link className="mobile-account" href="/account" aria-label="用户中心"><CircleUserRound size={21} /></Link>
        </header>
        {children}
      </div>
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, action }: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
      {action && <div className="page-action">{action}</div>}
    </header>
  );
}

export function SessionGate({ children }: { children: React.ReactNode }) {
  const { token, loading, error } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !token) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, pathname, router, token]);
  if (loading) return <main className="page loading-state">正在准备学习空间…</main>;
  if (error) return <main className="page loading-state error-text">登录状态校验失败：{error}</main>;
  if (!token) return <main className="page loading-state">正在前往登录页面…</main>;
  return <>{children}</>;
}
