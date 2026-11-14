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
import { localizeError, useI18n } from "@/lib/i18n";

import { useAuth } from "./providers";
import { TutorProvider } from "./floating-tutor";
import { AppearanceControls } from "./appearance-controls";

const links = [
  { href: "/", label: "shell.overview", icon: Gauge },
  { href: "/profile", label: "shell.profile", icon: UserRound },
  { href: "/plan", label: "shell.plan", icon: CalendarDays },
  { href: "/vocabulary", label: "shell.vocabulary", icon: BookOpenCheck },
  { href: "/question-bank", label: "shell.questions", icon: LibraryBig },
  { href: "/resources", label: "shell.resources", icon: FolderOpen },
  { href: "/writing", label: "shell.writing", icon: FilePenLine },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, error, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const isAuthPage = pathname === "/login" || pathname === "/register";

  if (isAuthPage) return <div className="auth-shell"><header className="auth-preferences"><AppearanceControls /></header>{children}</div>;

  const displayName = user?.display_name || user?.email.split("@")[0] || t("shell.learner");
  const initial = displayName.slice(0, 1).toUpperCase();
  const signOut = () => { logout(); router.replace("/login"); };

  return (
    <TutorProvider><div className="app-shell">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand-lockup">
          <span className="brand-mark">IA</span>
          <div><strong>IELTS Coach</strong><small>{t("shell.subtitle")}</small></div>
        </div>
        <nav className="side-nav" aria-label={t("shell.navigation")}>
          {links.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === href : pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={active ? "active" : ""} onClick={() => setOpen(false)}>
                <Icon size={19} />{t(label)}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-account">
          <Link href="/account" className="account-summary" onClick={() => setOpen(false)}>
            <span className="account-avatar">{initial}</span>
            <span><strong>{displayName}</strong><small>{user?.demo ? t("shell.demo") : user?.email}</small></span>
          </Link>
          <div className="account-actions">
            <Link href="/settings" onClick={() => setOpen(false)}><Settings size={16} />{t("shell.settings")}</Link>
            <button onClick={signOut}><LogOut size={16} />{t("shell.logout")}</button>
          </div>
          <AppearanceControls />
          <div className="sidebar-footer">
            <span className={`connection-dot ${error ? "error" : ""}`} />
            {loading ? t("shell.connecting") : error ? t("shell.connectionFailed") : t("shell.synced")}
          </div>
        </div>
      </aside>
      {open && <button className="nav-backdrop" aria-label={t("shell.closeNavigation")} onClick={() => setOpen(false)} />}
      <div className="app-content">
        <header className="mobile-header">
          <button aria-label={t(open ? "shell.closeNavigation" : "shell.openNavigation")} onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
          <strong>IELTS Coach</strong>
          <Link className="mobile-account" href="/account" aria-label={t("shell.account")}><CircleUserRound size={21} /></Link>
        </header>
        {children}
      </div>
    </div></TutorProvider>
  );
}

export function PageHeader({ eyebrow, title, description, action }: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p>{description}</p>}</div>
      {action && <div className="page-action">{action}</div>}
    </header>
  );
}

export function SessionGate({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const { token, loading, error } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !token) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, pathname, router, token]);
  if (loading) return <main className="page loading-state">{t("shell.preparing")}</main>;
  if (error) return <main className="page loading-state error-text">{t("shell.sessionFailed", { error: localizeError(error) })}</main>;
  if (!token) return <main className="page loading-state">{t("shell.redirecting")}</main>;
  return <>{children}</>;
}
