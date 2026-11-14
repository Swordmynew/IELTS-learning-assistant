"use client";

import { useI18n, localizeError } from "@/lib/i18n";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LockKeyhole, SlidersHorizontal, UserRound } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import { PageHeader, SessionGate } from "../app-shell";
import { useAuth } from "../providers";
import { api, UserPreferences } from "@/lib/api";

export default function SettingsPage() {
  return <SessionGate><SettingsContent /></SessionGate>;
}

function SettingsContent() {
  const { t } = useI18n();
  const { token, user, refreshUser } = useAuth();
  const client = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [preferences, setPreferences] = useState<UserPreferences>({ default_start_page: "overview", listening_rate: 0.92, compact_question_options: true, show_learning_details: false });
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.display_name ?? "");
    setPreferences(user.preferences);
  }, [user]);

  const profileMutation = useMutation({
    mutationFn: () => api.updateAccount(token!, displayName.trim()),
    onSuccess: async () => { await refreshUser(); client.invalidateQueries(); },
  });
  const preferenceMutation = useMutation({
    mutationFn: () => api.updateSettings(token!, preferences),
    onSuccess: refreshUser,
  });
  const passwordMutation = useMutation({
    mutationFn: () => api.changePassword(token!, currentPassword, newPassword),
    onSuccess: () => { setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setPasswordError(""); },
  });

  const changePassword = (event: FormEvent) => {
    event.preventDefault(); setPasswordError("");
    if (newPassword !== confirmPassword) { setPasswordError("ui.theNewPasswordsDoNotMatch"); return; }
    if (currentPassword === newPassword) { setPasswordError("ui.yourNewPasswordMustBeDifferentFromYourCurrentPassword"); return; }
    passwordMutation.mutate();
  };

  return <main className="page narrow-page">
    <PageHeader title={t("ui.settings")} />
    <div className="settings-stack">
      <section className="settings-card panel"><header><UserRound /><div><h2>{t("ui.personalDetails")}</h2></div></header><form onSubmit={(event) => { event.preventDefault(); profileMutation.mutate(); }} className="settings-form"><label>{t("ui.displayName")}<input required minLength={1} maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><label>{t("ui.signInEmailReadOnly")}<input value={user?.email ?? ""} disabled /></label><div className="setting-action"><button className="primary-button" disabled={profileMutation.isPending}>{profileMutation.isPending ? t("ui.saving2") : t("ui.save2")}</button>{profileMutation.isSuccess && <span className="save-success">{t("ui.saved")}</span>}{profileMutation.isError && <span className="error-text">{localizeError(profileMutation.error.message)}</span>}</div></form></section>
      <section className="settings-card panel"><header><SlidersHorizontal /><div><h2>{t("ui.learningPreferences")}</h2></div></header><form onSubmit={(event) => { event.preventDefault(); preferenceMutation.mutate(); }} className="settings-form"><label>{t("ui.defaultPage")}<select value={preferences.default_start_page} onChange={(event) => setPreferences({ ...preferences, default_start_page: event.target.value as UserPreferences["default_start_page"] })}><option value="overview">{t("ui.overview")}</option><option value="plan">{t("ui.weeklyPlan")}</option><option value="question-bank">{t("ui.questionBank")}</option></select></label><label>{t("ui.listeningSpeed")}<select value={preferences.listening_rate} onChange={(event) => setPreferences({ ...preferences, listening_rate: Number(event.target.value) })}><option value={0.75}>{t("ui.075Slow")}</option><option value={0.92}>{t("ui.normal")}</option><option value={1.1}>{t("ui.125Fast")}</option></select></label><label className="switch-setting"><input type="checkbox" checked={preferences.compact_question_options} onChange={(event) => setPreferences({ ...preferences, compact_question_options: event.target.checked })} /><span><strong>{t("ui.compactAnswerOptions")}</strong></span></label><label className="switch-setting"><input type="checkbox" checked={preferences.show_learning_details} onChange={(event) => setPreferences({ ...preferences, show_learning_details: event.target.checked })} /><span><strong>{t("ui.expandWordCardLearningHistoryByDefault")}</strong></span></label><div className="setting-action"><button className="primary-button" disabled={preferenceMutation.isPending}>{preferenceMutation.isPending ? t("ui.saving2") : t("ui.save2")}</button>{preferenceMutation.isSuccess && <span className="save-success">{t("ui.saved")}</span>}</div></form></section>
      <section className="settings-card panel"><header><LockKeyhole /><div><h2>{t("ui.signInSecurity")}</h2>{user?.demo && <span className="coach-chip">{t("ui.demoAccountPasswordIsReadOnly")}</span>}</div></header><form onSubmit={changePassword} className="settings-form"><label>{t("ui.currentPassword")}<input type="password" required minLength={8} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={user?.demo} autoComplete="current-password" /></label><label>{t("ui.newPassword")}<input placeholder={t("ui.atLeast8Characters")} type="password" required minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={user?.demo} autoComplete="new-password" /></label><label>{t("ui.confirmNewPassword")}<input type="password" required minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={user?.demo} autoComplete="new-password" /></label>{passwordError && <p className="error-text">{t(passwordError)}</p>}{passwordMutation.isError && <p className="error-text">{passwordMutation.error.message.includes("Current password") ? t("ui.incorrectCurrentPassword") : localizeError(passwordMutation.error.message)}</p>}<div className="setting-action"><button className="secondary-button" disabled={user?.demo || passwordMutation.isPending}>{passwordMutation.isPending ? t("ui.changing") : t("ui.changePassword")}</button>{passwordMutation.isSuccess && <span className="save-success">{t("ui.passwordUpdated")}</span>}</div></form></section>
    </div>
  </main>;
}
