"use client";

import { useI18n, localizeError } from "@/lib/i18n";

import { ArrowRight, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { useAuth } from "../providers";

function friendlyError(message: string) {
  if (message.includes("already registered")) return "ui.thisEmailIsAlreadyRegisteredYouCanSignInInstead";
  if (message.includes("Failed to fetch")) return "ui.unableToConnectPleaseTryAgainLater";
  return message;
}

export default function RegisterPage() {
  const { t } = useI18n();
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
    if (password !== confirmation) { setError("ui.thePasswordsDoNotMatch"); return; }
    setPending(true);
    try { await register(displayName.trim(), email.trim(), password, true); router.replace("/profile?welcome=1"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "ui.registrationFailed"); }
    finally { setPending(false); }
  };

  return <main className="auth-page">
    <section className="auth-intro register-intro">
      <Link className="auth-brand" href="/"><span className="brand-mark">IA</span><span><strong>IELTS Coach</strong><small>{t("ui.adaptiveLearningAssistant")}</small></span></Link>
      <div><h1>{t("auth.registerHeadline").split("\n")[0]}<br />{t("auth.registerHeadline").split("\n")[1]}</h1><ol className="auth-path" aria-label={t("ui.startLearning")}><li><b>01</b>{t("ui.createAccount")}</li><li><b>02</b>{t("ui.goals")}</li><li><b>03</b>{t("ui.plan")}</li></ol></div>
    </section>
    <section className="auth-card">
      <div><h2>{t("ui.createAccount")}</h2></div>
      <form onSubmit={submit}>
        <label>{t("ui.displayName")}<input required minLength={1} maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={t("ui.eGAlex")} /></label>
        <label>{t("ui.email")}<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("common.emailPlaceholder")} /></label>
        <label>{t("ui.password")}<div className="password-input"><input type={visible ? "text" : "password"} minLength={8} maxLength={128} required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("ui.atLeast8Characters")} /><button type="button" aria-label={visible ? t("ui.hidePassword") : t("ui.showPassword")} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
        <label>{t("ui.confirmPassword")}<input type={visible ? "text" : "password"} minLength={8} maxLength={128} required autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={t("ui.enterYourPasswordAgain")} /></label>
        {error && <p className="auth-error" role="alert">{t(localizeError(friendlyError(error)))}</p>}
        <button className="auth-submit" disabled={pending}>{pending ? t("ui.creatingAccount") : <>{t("ui.createAccount")}<ArrowRight size={17} /></>}</button>
      </form>
      <p className="auth-switch">{t("ui.alreadyHaveAnAccount")}<Link href="/login">{t("ui.backToSignIn")}</Link></p>
    </section>
  </main>;
}
