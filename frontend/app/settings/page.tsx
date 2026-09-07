"use client";

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
    if (newPassword !== confirmPassword) { setPasswordError("两次输入的新密码不一致。"); return; }
    if (currentPassword === newPassword) { setPasswordError("新密码不能与当前密码相同。"); return; }
    passwordMutation.mutate();
  };

  return <main className="page narrow-page">
    <PageHeader eyebrow="设置" title="账号与学习偏好" description="管理个人资料、默认学习入口和练习显示方式。设置会随账号保存。" />
    <div className="settings-stack">
      <section className="settings-card panel"><header><UserRound /><div><h2>个人资料</h2><p>这些信息用于识别你的个人学习空间。</p></div></header><form onSubmit={(event) => { event.preventDefault(); profileMutation.mutate(); }} className="settings-form"><label>昵称<input required minLength={1} maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><label>登录邮箱<input value={user?.email ?? ""} disabled /><small>当前版本暂不支持修改登录邮箱。</small></label><div className="setting-action"><button className="primary-button" disabled={profileMutation.isPending}>{profileMutation.isPending ? "保存中…" : "保存个人资料"}</button>{profileMutation.isSuccess && <span className="save-success">已保存</span>}{profileMutation.isError && <span className="error-text">{profileMutation.error.message}</span>}</div></form></section>
      <section className="settings-card panel"><header><SlidersHorizontal /><div><h2>学习偏好</h2><p>只提供当前产品真正会使用的选项。</p></div></header><form onSubmit={(event) => { event.preventDefault(); preferenceMutation.mutate(); }} className="settings-form"><label>登录后的默认页面<select value={preferences.default_start_page} onChange={(event) => setPreferences({ ...preferences, default_start_page: event.target.value as UserPreferences["default_start_page"] })}><option value="overview">学习概览</option><option value="plan">本周计划</option><option value="question-bank">练习题库</option></select></label><label>听力练习默认语速<select value={preferences.listening_rate} onChange={(event) => setPreferences({ ...preferences, listening_rate: Number(event.target.value) })}><option value={0.75}>0.75× 慢速</option><option value={0.92}>正常</option><option value={1.1}>1.25× 快速</option></select></label><label className="switch-setting"><input type="checkbox" checked={preferences.compact_question_options} onChange={(event) => setPreferences({ ...preferences, compact_question_options: event.target.checked })} /><span><strong>紧凑显示答题选项</strong><small>减少选项垂直间距，同屏展示更多题目。</small></span></label><label className="switch-setting"><input type="checkbox" checked={preferences.show_learning_details} onChange={(event) => setPreferences({ ...preferences, show_learning_details: event.target.checked })} /><span><strong>显示学习技术详情</strong><small>在词汇测评等页面默认展开置信度和估计参数。</small></span></label><div className="setting-action"><button className="primary-button" disabled={preferenceMutation.isPending}>{preferenceMutation.isPending ? "保存中…" : "保存学习偏好"}</button>{preferenceMutation.isSuccess && <span className="save-success">已保存并生效</span>}</div></form></section>
      <section className="settings-card panel"><header><LockKeyhole /><div><h2>登录安全</h2><p>{user?.demo ? "演示账号为共享入口，不能修改密码。" : "修改后请使用新密码登录。"}</p></div></header><form onSubmit={changePassword} className="settings-form"><label>当前密码<input type="password" required minLength={8} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={user?.demo} autoComplete="current-password" /></label><label>新密码<input type="password" required minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={user?.demo} autoComplete="new-password" /></label><label>确认新密码<input type="password" required minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={user?.demo} autoComplete="new-password" /></label>{passwordError && <p className="error-text">{passwordError}</p>}{passwordMutation.isError && <p className="error-text">{passwordMutation.error.message.includes("Current password") ? "当前密码不正确。" : passwordMutation.error.message}</p>}<div className="setting-action"><button className="secondary-button" disabled={user?.demo || passwordMutation.isPending}>{passwordMutation.isPending ? "修改中…" : "修改密码"}</button>{passwordMutation.isSuccess && <span className="save-success">密码已更新</span>}</div></form></section>
    </div>
  </main>;
}
