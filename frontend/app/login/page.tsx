"use client";

import { useI18n, localizeError } from "@/lib/i18n";

import { ArrowRight, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { useAuth } from "../providers";

const startPages = { overview: "/", plan: "/plan", "question-bank": "/question-bank" } as const;

function friendlyError(message: string) {
  if (message.includes("Invalid email or password")) return "ui.incorrectEmailOrPasswordPleaseTryAgain";
  if (message.includes("Failed to fetch")) return "ui.unableToConnectPleaseTryAgainLater";
  return message;
}

export default function LoginPage() {
  const { t } = useI18n();
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
      setError(reason instanceof Error ? reason.message : "ui.signInFailed");
    } finally { setPending(null); }
  };

  const useDemo = async () => {
    setError(""); setPending("demo");
    try { await enterDemo(); router.replace(destination("/")); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "ui.unableToOpenTheDemoAccount"); }
    finally { setPending(null); }
  };

  return <main className="auth-page">
    <section className="auth-intro">
      <Link className="auth-brand" href="/"><span className="brand-mark">IA</span><span><strong>IELTS Coach</strong><small>{t("ui.adaptiveLearningAssistant")}</small></span></Link>
      <div><h1>{t("ui.practiceDaily")}<br />{t("ui.seeYourProgress")}</h1><ol className="auth-path" aria-label={t("ui.learningPath")}><li><b>01</b>{t("ui.goals")}</li><li><b>02</b>{t("ui.practice2")}</li><li><b>03</b>{t("ui.review")}</li></ol></div>
    </section>
    <section className="auth-card">
      <div><h2>{t("ui.signIn")}</h2></div>
      <form onSubmit={submit}>
        <label>{t("ui.email")}<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("common.emailPlaceholder")} /></label>
        <PasswordField value={password} onChange={setPassword} autoComplete="current-password" />
        <label className="remember-row"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />{t("ui.keepMeSignedIn")}</label>
        {error && <p className="auth-error" role="alert">{t(localizeError(friendlyError(error)))}</p>}
        <button className="auth-submit" disabled={pending !== null}>{pending === "login" ? t("ui.signingIn") : <>{t("ui.signIn")}<ArrowRight size={17} /></>}</button>
      </form>
      <div className="auth-divider"><span>{t("ui.or")}</span></div>
      <button className="demo-entry" disabled={pending !== null} onClick={useDemo}>{pending === "demo" ? t("ui.loading") : t("ui.tryTheDemo")}</button>
      <p className="auth-switch">{t("ui.newHere")}<Link href="/register">{t("ui.createAccount")}</Link></p>
      <details className="auth-help"><summary>{t("ui.signInHelp")}</summary><p>{t("ui.passwordRecoveryIsNotAvailableYetKeepYourSignInDetailsSafe")}</p></details>
    </section>
  </main>;
}

function PasswordField({ value, onChange, autoComplete }: { value: string; onChange: (value: string) => void; autoComplete: string }) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return <label>{t("ui.password")}<div className="password-input"><input type={visible ? "text" : "password"} minLength={8} maxLength={128} required autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} placeholder={t("ui.atLeast8Characters")} /><button type="button" aria-label={visible ? t("ui.hidePassword") : t("ui.showPassword")} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>;
}
