import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Building2, Plus, ArrowRight, Trash2, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { Checkbox } from "@/components/ui/checkbox";
import { Share2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";

const STATUS_MAP = {
  not_started: { label: "Не начат", color: "bg-slate-600" },
  in_progress: { label: "Анализ...", color: "bg-amber-500" },
  completed: { label: "Завершён", color: "bg-emerald-500" },
  error: { label: "Ошибка", color: "bg-red-500" },
};

export default function DivisionsPage() {
  const navigate = useNavigate();
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", description: "", head_name: "", employees_count: 0 });
  const [creating, setCreating] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareDivision, setShareDivision] = useState(null);
  const [users, setUsers] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [savingShare, setSavingShare] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [usersMap, setUsersMap] = useState({});
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteDivision, setDeleteDivision] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const currentUser = JSON.parse(localStorage.getItem("user") || "null");

  useEffect(() => {
    api.get("/users").then((res) => {
      const map = {};
      res.data.forEach((u) => {
        map[u.id] = u;
      });
      setUsersMap(map);
    });
  }, []);

  const load = () => {
    api.get("/divisions").then((r) => setDivisions(r.data)).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post("/divisions", form);
      toast.success("Подразделение создано");
      setDialogOpen(false);
      setForm({ name: "", description: "", head_name: "", employees_count: 0 });
      load();
    } catch (err) {
      toast.error("Ошибка создания");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = (e, division) => {
    e.stopPropagation();
    setDeleteDivision(division);
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteDivision) return;

    setDeleting(true);

    try {
      await api.delete(`/divisions/${deleteDivision.id}`);

      toast.success("Подразделение удалено");
      setDeleteOpen(false);
      setDeleteDivision(null);
      load();
    } catch (err) {
      toast.error("Ошибка удаления");
    } finally {
      setDeleting(false);
    }
  };

  const filtered = divisions.filter((d) => d.name.toLowerCase().includes(search.toLowerCase()));

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 text-blue-500 animate-spin" /></div>;
  }

  const openShareModal = async (e, division) => {
    e.stopPropagation();

    try {
      const res = await api.get(
          `/users?division_id=${division.id}`
      );

      setUsers(res.data);
      setShareDivision(division);
      setSelectedUsers(division.shared_with || []);
      setShareOpen(true);
    } catch (err) {
      toast.error("Не удалось загрузить пользователей");
    }
  };

  const saveShare = async () => {
    if (!shareDivision) return;

    setSavingShare(true);

    try {
      await api.post(
          `/divisions/${shareDivision.id}/share`,
          {
            user_ids: selectedUsers
          }
      );

      toast.success("Доступ обновлен");
      setShareOpen(false);
      load();
    } catch (err) {
      toast.error("Ошибка сохранения доступа");
    } finally {
      setSavingShare(false);
    }
  };

  const filteredUsers = users.filter((u) =>
      `${u.name} ${u.email}`
          .toLowerCase()
          .includes(userSearch.toLowerCase())
  );

  return (
    <div className="p-6 md:p-8 lg:p-10 space-y-6" data-testid="divisions-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Подразделения</h1>
          <p className="text-slate-400 mt-1">Управление подразделениями для анализа</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_15px_rgba(59,130,246,0.4)]" data-testid="create-division-btn">
              <Plus className="w-4 h-4 mr-2" /> Новое подразделение
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-slate-900 border-slate-800">
            <DialogHeader>
              <DialogTitle className="text-white">Создать подразделение</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label className="text-slate-300">Название *</Label>
                <Input
                  data-testid="division-name-input"
                  value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Департамент проблемных кредитов"
                  className="bg-slate-950 border-slate-800 focus:border-blue-500" required
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">Описание</Label>
                <Textarea
                  data-testid="division-desc-input"
                  value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Краткое описание подразделения..."
                  className="bg-slate-950 border-slate-800 focus:border-blue-500 min-h-[80px]"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-300">Руководитель</Label>
                  <Input
                    data-testid="division-head-input"
                    value={form.head_name} onChange={(e) => setForm({ ...form, head_name: e.target.value })}
                    placeholder="ФИО руководителя"
                    className="bg-slate-950 border-slate-800 focus:border-blue-500"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300">Кол-во сотрудников</Label>
                  <Input
                    data-testid="division-count-input"
                    type="number" value={form.employees_count}
                    onChange={(e) => setForm({ ...form, employees_count: parseInt(e.target.value) || 0 })}
                    className="bg-slate-950 border-slate-800 focus:border-blue-500"
                  />
                </div>
              </div>
              <Button type="submit" disabled={creating} className="w-full bg-blue-600 hover:bg-blue-500 text-white" data-testid="submit-division-btn">
                {creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                Создать
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {divisions.length > 0 && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            data-testid="search-divisions-input"
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск подразделений..."
            className="pl-9 bg-slate-950 border-slate-800 focus:border-blue-500"
          />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((d, i) => {
          const st = STATUS_MAP[d.analysis_status] || STATUS_MAP.not_started;

          const isOwner =
              currentUser?.is_admin ||
              d.created_by === currentUser?.id;

          const isShared =
              !isOwner &&
              Array.isArray(d.shared_with) &&
              d.shared_with.includes(currentUser?.id);

          const sharedCount = Array.isArray(d.shared_with)
              ? d.shared_with.length
              : 0;

          const sharedNames = (d.shared_with || [])
              .map((id) => usersMap[id]?.name)
              .filter(Boolean);

          return (
            <Card
              key={d.id}
              className="glass-card border-slate-800 bg-transparent cursor-pointer hover:border-slate-700 transition-all animate-fade-in-up group"
              style={{ animationDelay: `${i * 0.05}s` }}
              onClick={() => navigate(`/divisions/${d.id}`)}
              data-testid={`division-card-${i}`}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-600/10 flex items-center justify-center">
                    <Building2
                        className={`w-5 h-5 ${
                            isShared ? "text-purple-400" : "text-blue-400"
                        }`}
                    />
                  </div>

                  <div className="text-right space-y-1">
                    <div className="flex items-center gap-2 justify-end">
                      <div className={`w-2 h-2 rounded-full ${st.color}`}/>
                      <span className="text-xs text-slate-400">
        {st.label}
      </span>
                    </div>

                    {isOwner && sharedNames.length > 0 && (
                        <p className="text-xs text-slate-500">
                          Доступ: {sharedNames.slice(0, 2).join(", ")}
                          {sharedNames.length > 2 &&
                              ` +${sharedNames.length - 2}`}
                        </p>
                    )}
                  </div>
                </div>
                <h3 className="text-base font-semibold text-white mb-1 truncate">{d.name}</h3>
                <div className="flex gap-2 mb-2 flex-wrap">

                  {isOwner && sharedCount === 0 && (
                      <Badge
                          variant="outline"
                          className="border-blue-500/40 text-blue-400 text-xs"
                      >
                        Моё
                      </Badge>
                  )}
                  {isOwner && sharedCount > 0 && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge
                                variant="outline"
                                className="border-emerald-500/40 text-emerald-400 text-xs cursor-pointer"
                            >
                              Открыт доступ: {sharedCount}
                            </Badge>
                          </TooltipTrigger>

                          <TooltipContent className="bg-slate-900 border-slate-800 text-white max-w-xs">
                            <div className="space-y-1">
                              <p className="text-xs text-slate-400 mb-2">
                                Пользователи с доступом
                              </p>

                              {sharedNames.map((name, index) => (
                                  <div
                                      key={index}
                                      className="text-sm"
                                  >
                                    • {name}
                                  </div>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                  )}

                  {isShared && (
                      <Badge
                          variant="outline"
                          className="border-purple-500/40 text-purple-400 text-xs"
                      >
                        Поделились со мной
                      </Badge>
                  )}

                </div>
                <p className="text-sm text-slate-500 line-clamp-2 mb-4 min-h-[2.5rem]">
                  {d.description || "Описание не указано"}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    <Badge variant="outline"
                           className="border-slate-700 text-slate-400 text-xs">{d.employees_count || 0} чел.</Badge>
                    {d.processes_count > 0 && (
                        <Badge variant="outline"
                               className="border-slate-700 text-blue-400 text-xs">{d.processes_count} процессов</Badge>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {isOwner && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="w-8 h-8 text-slate-500 hover:text-blue-400 hover:bg-blue-500/10"
                            onClick={(e) => openShareModal(e, d)}
                        >
                          <Share2 className="w-4 h-4"/>
                        </Button>
                    )}
                    {isOwner && (
                        <Button
                            variant="ghost" size="icon"
                            className="w-8 h-8 text-slate-500 hover:text-blue-400 hover:bg-blue-500/10"
                            onClick={(e) => handleDelete(e, d)}
                            data-testid={`delete-division-${i}`}
                        >
                          <Trash2 className="w-4 h-4"/>
                        </Button>
                    )}
                    <ArrowRight className="w-5 h-5 text-slate-600 group-hover:text-blue-400 transition-colors mt-1.5"/>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {divisions.length === 0 && (
          <div className="text-center py-20 glass-card rounded-xl">
            <Building2 className="w-16 h-16 text-slate-600 mx-auto mb-4"/>
            <h3 className="text-xl font-semibold text-white mb-2">Нет подразделений</h3>
            <p className="text-slate-400 mb-6">Создайте первое подразделение для начала работы</p>
            <Button onClick={() => setDialogOpen(true)} className="bg-blue-600 hover:bg-blue-500 text-white"
                    data-testid="empty-create-btn">
              <Plus className="w-4 h-4 mr-2"/> Создать подразделение
            </Button>
          </div>
      )}

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">
              Поделиться подразделением
            </DialogTitle>
          </DialogHeader>

          {users.length > 5 && (
              <Input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Поиск пользователя..."
                  className="bg-slate-950 border-slate-800"
              />
          )}

          <div className="space-y-3 max-h-[400px] overflow-y-auto mt-3">
            {users.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-slate-300">
                    Список пользователей пуст
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Нет доступных пользователей для предоставления доступа
                  </p>
                </div>
            ) : (
                filteredUsers.map((u) => {
                  const checked = selectedUsers.includes(u.id);
                  return (
                      <label
                          key={u.id}
                          className="flex items-center gap-3 p-3 rounded-lg border border-slate-800 hover:bg-slate-800 cursor-pointer"
                      >
                        <Checkbox
                            checked={checked}
                            onCheckedChange={(val) => {
                              if (val) {
                                setSelectedUsers([...selectedUsers, u.id]);
                              } else {
                                setSelectedUsers(
                                    selectedUsers.filter((x) => x !== u.id)
                                );
                              }
                            }}
                        />
                        <div>
                          <div className="text-sm text-white">
                            {u.name}
                          </div>

                          <div className="text-xs text-slate-400">
                            {u.email}
                          </div>
                        </div>
                      </label>
                  );
                })
            )}
          </div>
          <div className="flex gap-2 mt-4">
            <Button
                variant="outline"
                onClick={() => setShareOpen(false)}
                className="flex-1 border-slate-700 text-slate-300"
            >
              Закрыть
            </Button>

            {users.length > 0 && (
                <Button
                    onClick={saveShare}
                    disabled={savingShare}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-white"
                >
                  {savingShare ? "Сохранение..." : "Сохранить"}
                </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>


      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">
              Удалить подразделение?
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 mt-2">
            <p className="text-sm text-slate-300">
              {deleteDivision?.name}
            </p>

            <p className="text-sm text-slate-500">
              Будут удалены все документы, процессы,
              результаты анализа и настройки доступа.
            </p>
          </div>

          <div className="flex gap-2 mt-4">
            <Button
                variant="outline"
                onClick={() => setDeleteOpen(false)}
                className="flex-1 border-slate-700 text-slate-300"
            >
              Отмена
            </Button>

            <Button
                onClick={confirmDelete}
                disabled={deleting}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white"
            >
              {deleting ? "Удаление..." : "Удалить"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
