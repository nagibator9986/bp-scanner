import { useMemo, useState } from "react";
import { Copy, Eye, EyeOff, KeyRound, Loader2, Power, PowerOff, Search, ShieldCheck, Users, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog, EmptyState, ErrorState, LoadingState, Panel } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/useApi";
import api, { errorMessage } from "@/lib/api";
import { formatDate, formatDateTime, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

const ROLES = {
  user: { label: "Пользователь" },
  analyst: { label: "Аналитик" },
  admin: { label: "Администратор" },
};
const MIN_PASSWORD = 6;
const MAX_PASSWORD = 128;
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

const roleOf = (user) => (user.is_admin ? "admin" : ROLES[user.role] ? user.role : "user");

const initials = (user) => {
  const source = (user.name || user.email || "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
};

function generatePassword(length = 12) {
  const values = new Uint32Array(length);
  window.crypto.getRandomValues(values);
  return Array.from(values, (value) => PASSWORD_ALPHABET[value % PASSWORD_ALPHABET.length]).join("");
}

function PasswordDialog({ open, onOpenChange, user }) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const valid = password.length >= MIN_PASSWORD && password.length <= MAX_PASSWORD;

  const submit = async (event) => {
    event.preventDefault();
    if (!valid || saving || !user) return;
    setSaving(true);
    try {
      await api.post(`/admin/users/${user.id}/password`, { password });
      toast.success(`Пароль пользователя ${user.name || user.email} изменён`);
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, "Не удалось сменить пароль"));
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      toast.success("Пароль скопирован");
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !saving && onOpenChange(value)}>
      <DialogContent className="max-w-md border-border bg-card" data-testid="reset-password-dialog">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-6">
              <KeyRound className="h-5 w-5 text-primary" /> Новый пароль
            </DialogTitle>
            <DialogDescription>
              {user ? `${user.name || "Пользователь"} · ${user.email}` : ""}. Текущий пароль перестанет действовать сразу.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reset-password-input" className="text-sm text-muted-foreground">
              Пароль (не менее {MIN_PASSWORD} символов)
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="reset-password-input"
                  type={visible ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  maxLength={MAX_PASSWORD}
                  className={cn("pr-9", visible && "font-mono")}
                  autoFocus
                  data-testid="reset-password-input"
                />
                <button
                  type="button"
                  onClick={() => setVisible((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                  aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
                >
                  {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  setPassword(generatePassword());
                  setVisible(true);
                }}
                title="Сгенерировать"
                aria-label="Сгенерировать пароль"
                data-testid="generate-password-btn"
              >
                <Wand2 />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={copy}
                disabled={!password}
                title="Скопировать"
                aria-label="Скопировать пароль"
              >
                <Copy />
              </Button>
            </div>
            {tooShort && <p className="text-xs text-red-500">Минимум {MIN_PASSWORD} символов</p>}
            {!tooShort && <p className="text-xs text-muted-foreground">Передайте новый пароль пользователю по защищённому каналу.</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Отмена
            </Button>
            <Button type="submit" disabled={!valid || saving} data-testid="reset-password-submit">
              {saving ? <Loader2 className="animate-spin" /> : <KeyRound />}
              Сменить пароль
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UsersTab({ onChanged }) {
  const { user: me } = useAuth() || {};
  const { data, error, loading, reload, setData } = useApi("/admin/users");
  const users = useMemo(() => data || [], [data]);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [busyId, setBusyId] = useState(null);
  const [roleChange, setRoleChange] = useState(null); // { user, role }
  const [toDisable, setToDisable] = useState(null);
  const [passwordFor, setPasswordFor] = useState({ open: false, user: null, seq: 0 });

  const counts = useMemo(
    () => ({
      admins: users.filter((u) => roleOf(u) === "admin").length,
      disabled: users.filter((u) => u.disabled).length,
    }),
    [users]
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "all" && roleOf(u) !== roleFilter) return false;
      if (!query) return true;
      return u.name?.toLowerCase().includes(query) || u.email?.toLowerCase().includes(query);
    });
  }, [users, search, roleFilter]);

  const patchLocal = (id, patch) => setData((list) => list?.map((u) => (u.id === id ? { ...u, ...patch } : u)));

  const applyRole = async (target, role) => {
    setBusyId(target.id);
    try {
      await api.patch(`/admin/users/${target.id}/role`, null, { params: { role } });
      patchLocal(target.id, { role, is_admin: role === "admin" });
      toast.success(`${target.name || target.email}: роль «${ROLES[role].label}»`);
      setRoleChange(null);
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err, "Не удалось изменить роль"));
    } finally {
      setBusyId(null);
    }
  };

  const requestRole = (target, role) => {
    if (role === roleOf(target)) return;
    // Выдача и снятие прав администратора — только после подтверждения
    if (role === "admin" || roleOf(target) === "admin") setRoleChange({ user: target, role });
    else applyRole(target, role);
  };

  const applyStatus = async (target, disabled) => {
    setBusyId(target.id);
    try {
      await api.patch(`/admin/users/${target.id}/status`, null, { params: { disabled } });
      patchLocal(target.id, { disabled });
      toast.success(disabled ? `Учётная запись ${target.email} отключена` : `Учётная запись ${target.email} включена`);
      setToDisable(null);
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err, "Не удалось изменить статус"));
    } finally {
      setBusyId(null);
    }
  };

  let body;
  if (loading) {
    body = <LoadingState label="Загрузка пользователей…" />;
  } else if (error) {
    body = <ErrorState message={error} onRetry={reload} />;
  } else if (!filtered.length) {
    body = users.length ? (
      <EmptyState icon={Search} title="Никого не найдено" description="Измените запрос или фильтр роли." />
    ) : (
      <EmptyState icon={Users} title="Пользователей нет" />
    );
  } else {
    body = (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[880px] text-sm" data-testid="users-table">
          <thead className="bg-secondary/50 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Пользователь</th>
              <th className="px-4 py-2.5 font-semibold">Роль</th>
              <th className="px-4 py-2.5 font-semibold">Статус</th>
              <th className="px-4 py-2.5 text-right font-semibold">Подразделений</th>
              <th className="px-4 py-2.5 font-semibold">Последний вход</th>
              <th className="px-4 py-2.5 font-semibold">Создан</th>
              <th className="px-4 py-2.5 text-right font-semibold">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((u) => {
              const isMe = u.id === me?.id;
              const role = roleOf(u);
              const busy = busyId === u.id;
              return (
                <tr key={u.id} className={cn("transition-colors hover:bg-secondary/30", u.disabled && "opacity-60")} data-testid={`user-row-${u.id}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                          role === "admin" ? "bg-purple-500/10 text-purple-500" : "bg-primary/10 text-primary"
                        )}
                      >
                        {initials(u)}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-foreground">{u.name || "Без имени"}</span>
                          {isMe && (
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal text-primary">
                              Вы
                            </Badge>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Select value={role} onValueChange={(value) => requestRole(u, value)} disabled={isMe || busy}>
                      <SelectTrigger
                        className="h-8 w-[170px]"
                        title={isMe ? "Нельзя изменить собственную роль" : undefined}
                        data-testid={`user-role-${u.id}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ROLES).map(([value, { label }]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    {u.disabled ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-500">
                        <span className="h-2 w-2 rounded-full bg-red-500" /> Отключён
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-500">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" /> Активен
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">{u.divisions_count ?? 0}</td>
                  <td className="px-4 py-3 text-muted-foreground">{u.last_login_at ? formatDateTime(u.last_login_at) : "Не входил"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(u.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPasswordFor((prev) => ({ open: true, user: u, seq: prev.seq + 1 }))}
                        disabled={busy}
                        data-testid={`user-password-${u.id}`}
                      >
                        <KeyRound /> Пароль
                      </Button>
                      {u.disabled ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => applyStatus(u, false)}
                          disabled={busy || isMe}
                          className="text-emerald-500"
                          data-testid={`user-enable-${u.id}`}
                        >
                          {busy ? <Loader2 className="animate-spin" /> : <Power />} Включить
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setToDisable(u)}
                          disabled={busy || isMe}
                          title={isMe ? "Нельзя отключить собственную учётную запись" : undefined}
                          className="text-red-500"
                          data-testid={`user-disable-${u.id}`}
                        >
                          {busy ? <Loader2 className="animate-spin" /> : <PowerOff />} Отключить
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const roleChangeTarget = roleChange?.user;
  const grantingAdmin = roleChange?.role === "admin";

  return (
    <div className="space-y-4" data-testid="users-tab">
      <Panel
        title="Пользователи"
        icon={Users}
        description={
          data
            ? `${users.length} ${plural(users.length, ["пользователь", "пользователя", "пользователей"])} · ${counts.admins} ${plural(
                counts.admins,
                ["администратор", "администратора", "администраторов"]
              )}${counts.disabled ? ` · ${counts.disabled} отключено` : ""}`
            : undefined
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по имени или email…"
                className="pl-9"
                data-testid="users-search"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-full sm:w-[200px]" data-testid="users-role-filter">
                <SelectValue placeholder="Роль" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все роли</SelectItem>
                {Object.entries(ROLES).map(([value, { label }]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            Администраторы видят все подразделения и панель администратора. Собственную роль и учётную запись изменить
            нельзя, а последнего активного администратора система не позволит лишить прав.
          </p>
          {body}
        </div>
      </Panel>

      <PasswordDialog
        key={passwordFor.seq}
        open={passwordFor.open}
        onOpenChange={(open) => setPasswordFor((prev) => ({ ...prev, open }))}
        user={passwordFor.user}
      />

      <ConfirmDialog
        open={Boolean(roleChange)}
        onOpenChange={(open) => !open && busyId === null && setRoleChange(null)}
        title={grantingAdmin ? "Выдать права администратора?" : "Снять права администратора?"}
        description={
          roleChangeTarget
            ? grantingAdmin
              ? `${roleChangeTarget.name || roleChangeTarget.email} получит доступ ко всем подразделениям, настройкам модели, промптам и пользователям.`
              : `${roleChangeTarget.name || roleChangeTarget.email} получит роль «${ROLES[roleChange.role].label}» и потеряет доступ к панели администратора.`
            : undefined
        }
        confirmLabel={grantingAdmin ? "Выдать права" : "Снять права"}
        destructive={!grantingAdmin}
        onConfirm={() => applyRole(roleChange.user, roleChange.role)}
        busy={Boolean(roleChangeTarget) && busyId === roleChangeTarget.id}
      />

      <ConfirmDialog
        open={Boolean(toDisable)}
        onOpenChange={(open) => !open && busyId === null && setToDisable(null)}
        title="Отключить учётную запись?"
        description={
          toDisable
            ? `${toDisable.name || toDisable.email} не сможет войти в систему. Данные пользователя и его подразделения сохранятся.`
            : undefined
        }
        confirmLabel="Отключить"
        onConfirm={() => applyStatus(toDisable, true)}
        busy={Boolean(toDisable) && busyId === toDisable.id}
      />
    </div>
  );
}
