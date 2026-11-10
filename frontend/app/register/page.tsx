"use client";

import { ArrowRight, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { useAuth } from "../providers";

function friendlyError(message: string) {
  if (message.includes("already registered")) return "这个邮箱已经注册，可以直接登录。";
  if (message.includes("Failed to fetch")) return "暂时无法连接，请稍后重试。";
  return message;
}

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    if (password !== confirmation) { setError("两次输入的密码不一致。"); return; }
    setPending(true);
    try { await register(displayName.trim(), email.trim(), password, true); router.replace("/profile?welcome=1"); }
    catch (reason) { setError(friendlyError(reason instanceof Error ? reason.message : "注册失败")); }
    finally { setPending(false); }
  };

  return <main className="auth-page">
    <section className="auth-intro register-intro">
      <Link className="auth-brand" href="/"><span className="brand-mark">IA</span><span><strong>IELTS Coach</strong><small>自适应学习助手</small></span></Link>
      <div><h1>从你的目标，<br />开始。</h1><ol className="auth-path" aria-label="开始学习"><li><b>01</b>注册</li><li><b>02</b>目标</li><li><b>03</b>计划</li></ol></div>
    </section>
    <section className="auth-card">
      <div><h2>注册</h2></div>
      <form onSubmit={submit}>
        <label>昵称<input required minLength={1} maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如：小林" /></label>
        <label>邮箱<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label>
        <label>密码<div className="password-input"><input type={visible ? "text" : "password"} minLength={8} maxLength={128} required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" /><button type="button" aria-label={visible ? "隐藏密码" : "显示密码"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
        <label>确认密码<input type={visible ? "text" : "password"} minLength={8} maxLength={128} required autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="再次输入密码" /></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="auth-submit" disabled={pending}>{pending ? "正在创建账号…" : <>注册<ArrowRight size={17} /></>}</button>
      </form>
      <p className="auth-switch">已有账号？<Link href="/login">返回登录</Link></p>
    </section>
  </main>;
}
