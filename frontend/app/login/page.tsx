"use client";

import { ArrowRight, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { useAuth } from "../providers";

const startPages = { overview: "/", plan: "/plan", "question-bank": "/question-bank" } as const;

function friendlyError(message: string) {
  if (message.includes("Invalid email or password")) return "邮箱或密码不正确，请重新输入。";
  if (message.includes("Failed to fetch")) return "暂时无法连接，请稍后重试。";
  return message;
}

export default function LoginPage() {
  const router = useRouter();
  const { login, enterDemo } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [pending, setPending] = useState<"login" | "demo" | null>(null);
  const [error, setError] = useState("");

  const destination = (fallback: string) => {
    const requested = new URLSearchParams(window.location.search).get("next");
    return requested?.startsWith("/") && !requested.startsWith("//") ? requested : fallback;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setPending("login");
    try {
      const account = await login(email.trim(), password, remember);
      router.replace(destination(startPages[account.preferences.default_start_page]));
    } catch (reason) {
      setError(friendlyError(reason instanceof Error ? reason.message : "登录失败"));
    } finally { setPending(null); }
  };

  const useDemo = async () => {
    setError(""); setPending("demo");
    try { await enterDemo(); router.replace(destination("/")); }
    catch (reason) { setError(friendlyError(reason instanceof Error ? reason.message : "演示账号进入失败")); }
    finally { setPending(null); }
  };

  return <main className="auth-page">
    <section className="auth-intro">
      <Link className="auth-brand" href="/"><span className="brand-mark">IA</span><span><strong>IELTS Coach</strong><small>自适应学习助手</small></span></Link>
      <div><h1>每天练习，<br />看见进步。</h1><ol className="auth-path" aria-label="学习路径"><li><b>01</b>目标</li><li><b>02</b>练习</li><li><b>03</b>复习</li></ol></div>
    </section>
    <section className="auth-card">
      <div><h2>登录</h2></div>
      <form onSubmit={submit}>
        <label>邮箱<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label>
        <PasswordField value={password} onChange={setPassword} autoComplete="current-password" />
        <label className="remember-row"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />保持登录</label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="auth-submit" disabled={pending !== null}>{pending === "login" ? "正在登录…" : <>登录<ArrowRight size={17} /></>}</button>
      </form>
      <div className="auth-divider"><span>或</span></div>
      <button className="demo-entry" disabled={pending !== null} onClick={useDemo}>{pending === "demo" ? "载入中…" : "体验演示"}</button>
      <p className="auth-switch">还没有账号？<Link href="/register">注册</Link></p>
      <details className="auth-help"><summary>登录帮助</summary><p>暂不支持找回密码，请妥善保存账号。</p></details>
    </section>
  </main>;
}

function PasswordField({ value, onChange, autoComplete }: { value: string; onChange: (value: string) => void; autoComplete: string }) {
  const [visible, setVisible] = useState(false);
  return <label>密码<div className="password-input"><input type={visible ? "text" : "password"} minLength={8} maxLength={128} required autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} placeholder="至少 8 位" /><button type="button" aria-label={visible ? "隐藏密码" : "显示密码"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>;
}
