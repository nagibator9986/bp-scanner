import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { BookOpen, Plus, Upload, Trash2, Edit, Eye, Search, Globe, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

const CATEGORIES = [
  { value: "general", label: "Общее" },
  { value: "regulations", label: "Регламенты" },
  { value: "standards", label: "Стандарты" },
  { value: "processes", label: "Процессы" },
  { value: "templates", label: "Шаблоны" }
];

export function KnowledgeTab() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [globalFilter, setGlobalFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [createForm, setCreateForm] = useState({ title: "", content: "", category: "general", is_global: true });
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadItems();
    loadCategories();
  }, [categoryFilter, globalFilter]);

  const loadItems = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (categoryFilter !== "all") params.append("category", categoryFilter);
      if (globalFilter !== "all") params.append("is_global", globalFilter === "global" ? "true" : "false");
      
      const { data } = await api.get(`/admin/knowledge?${params}`);
      setItems(data);
    } catch (err) {
      toast.error("Ошибка загрузки базы знаний");
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const { data } = await api.get("/admin/knowledge/categories/list");
      setCategories(data);
    } catch (err) {
      console.error("Failed to load categories:", err);
    }
  };

  const createItem = async () => {
    try {
      await api.post("/admin/knowledge", createForm);
      toast.success("Элемент создан");
      setCreateOpen(false);
      setCreateForm({ title: "", content: "", category: "general", is_global: true });
      loadItems();
      loadCategories();
    } catch (err) {
      toast.error("Ошибка создания");
    }
  };

  const uploadFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      setUploading(true);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", createForm.category);
      formData.append("is_global", createForm.is_global.toString());
      
      await api.post("/admin/knowledge/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      toast.success("Документ загружен");
      setCreateOpen(false);
      loadItems();
      loadCategories();
    } catch (err) {
      toast.error("Ошибка загрузки файла");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const updateItem = async () => {
    try {
      await api.patch(`/admin/knowledge/${selectedItem.id}`, {
        title: selectedItem.title,
        content: selectedItem.content,
        category: selectedItem.category,
        is_global: selectedItem.is_global,
        is_active: selectedItem.is_active
      });
      toast.success("Элемент обновлён");
      setEditOpen(false);
      loadItems();
    } catch (err) {
      toast.error("Ошибка обновления");
    }
  };

  const deleteItem = async (id) => {
    if (!confirm("Удалить элемент из базы знаний?")) return;
    try {
      await api.delete(`/admin/knowledge/${id}`);
      toast.success("Элемент удалён");
      loadItems();
      loadCategories();
    } catch (err) {
      toast.error("Ошибка удаления");
    }
  };

  const openView = (item) => {
    setSelectedItem(item);
    setViewOpen(true);
  };

  const openEdit = (item) => {
    setSelectedItem({ ...item });
    setEditOpen(true);
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString("ru-RU");
  };

  const filteredItems = items.filter(item => 
    searchQuery === "" || 
    item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.content?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4" data-testid="knowledge-tab">
      {/* Категории */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <Badge 
              key={cat.category}
              variant={categoryFilter === cat.category ? "default" : "outline"}
              className={`cursor-pointer ${categoryFilter === cat.category ? 'bg-blue-600' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}
              onClick={() => setCategoryFilter(categoryFilter === cat.category ? "all" : cat.category)}
            >
              {CATEGORIES.find(c => c.value === cat.category)?.label || cat.category} ({cat.count})
            </Badge>
          ))}
        </div>
      )}

      {/* Фильтры и действия */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск по названию и содержимому..."
            className="pl-9 bg-slate-900 border-slate-700"
          />
        </div>

        <Select value={globalFilter} onValueChange={setGlobalFilter}>
          <SelectTrigger className="w-[150px] bg-slate-900 border-slate-700">
            <SelectValue placeholder="Область" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="global">Глобальные</SelectItem>
            <SelectItem value="local">Локальные</SelectItem>
          </SelectContent>
        </Select>

        <Button onClick={() => setCreateOpen(true)} className="bg-blue-600 hover:bg-blue-500">
          <Plus className="w-4 h-4 mr-2" />
          Добавить
        </Button>
      </div>

      {/* Список */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full text-center py-8 text-slate-500">Загрузка...</div>
        ) : filteredItems.length === 0 ? (
          <div className="col-span-full text-center py-8 text-slate-500">
            {searchQuery ? "Ничего не найдено" : "База знаний пуста"}
          </div>
        ) : (
          filteredItems.map((item) => (
            <Card key={item.id} className={`glass-card border-slate-800 ${item.is_active === false ? 'opacity-50' : ''}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base text-white flex items-center gap-2 truncate">
                      <BookOpen className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <span className="truncate">{item.title}</span>
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500 mt-1">
                      {formatDate(item.created_at)}
                      {item.source_filename && ` • ${item.source_filename}`}
                    </CardDescription>
                  </div>
                  <div className="flex gap-1 flex-shrink-0 ml-2">
                    {item.is_global ? (
                      <Globe className="w-4 h-4 text-blue-400" title="Глобальный" />
                    ) : (
                      <FolderOpen className="w-4 h-4 text-slate-400" title="Локальный" />
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
                    {CATEGORIES.find(c => c.value === item.category)?.label || item.category}
                  </Badge>
                  {item.is_active === false && (
                    <Badge variant="outline" className="text-xs border-red-600 text-red-400">Неактивно</Badge>
                  )}
                </div>
                <p className="text-xs text-slate-400 line-clamp-3 mb-3">
                  {item.content?.substring(0, 200)}...
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" className="flex-1 text-xs" onClick={() => openView(item)}>
                    <Eye className="w-3 h-3 mr-1" />
                    Просмотр
                  </Button>
                  <Button size="sm" variant="ghost" className="text-xs" onClick={() => openEdit(item)}>
                    <Edit className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-xs text-red-400" onClick={() => deleteItem(item.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Модальное окно создания */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl bg-slate-900 border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-white">Добавить в базу знаний</DialogTitle>
            <DialogDescription className="text-slate-400">
              Создайте текстовую запись или загрузите документ
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-slate-300 text-sm">Категория</Label>
                <Select value={createForm.category} onValueChange={(v) => setCreateForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-3">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={createForm.is_global}
                    onCheckedChange={(v) => setCreateForm(f => ({ ...f, is_global: v }))}
                  />
                  <Label className="text-slate-300 text-sm">Глобальное</Label>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-800 pt-4">
              <h4 className="text-sm font-medium text-slate-300 mb-3">Вариант 1: Загрузить документ</h4>
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.xlsx,.pptx,.txt"
                  onChange={uploadFile}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="border-slate-700"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {uploading ? "Загрузка..." : "Выбрать файл"}
                </Button>
                <span className="text-xs text-slate-500 self-center">PDF, DOCX, XLSX, PPTX, TXT</span>
              </div>
            </div>

            <div className="border-t border-slate-800 pt-4">
              <h4 className="text-sm font-medium text-slate-300 mb-3">Вариант 2: Создать текстовую запись</h4>
              <div className="space-y-3">
                <div>
                  <Label className="text-slate-300 text-sm">Название</Label>
                  <Input
                    value={createForm.title}
                    onChange={(e) => setCreateForm(f => ({ ...f, title: e.target.value }))}
                    className="bg-slate-800 border-slate-700 text-white mt-1"
                    placeholder="Название документа или темы..."
                  />
                </div>
                <div>
                  <Label className="text-slate-300 text-sm">Содержимое</Label>
                  <Textarea
                    value={createForm.content}
                    onChange={(e) => setCreateForm(f => ({ ...f, content: e.target.value }))}
                    className="bg-slate-800 border-slate-700 text-white mt-1 min-h-[150px]"
                    placeholder="Текст, правила, регламенты, шаблоны..."
                  />
                </div>
              </div>
            </div>
          </div>
          
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)} className="border-slate-700">
              Отмена
            </Button>
            <Button 
              onClick={createItem} 
              disabled={!createForm.title || !createForm.content}
              className="bg-blue-600 hover:bg-blue-500"
            >
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Модальное окно просмотра */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] bg-slate-900 border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-white">{selectedItem?.title}</DialogTitle>
            <DialogDescription className="text-slate-400">
              {CATEGORIES.find(c => c.value === selectedItem?.category)?.label} • {selectedItem?.is_global ? "Глобальное" : "Локальное"}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto max-h-[60vh] bg-slate-800 p-4 rounded">
            <pre className="text-sm text-slate-300 whitespace-pre-wrap font-sans">{selectedItem?.content}</pre>
          </div>
        </DialogContent>
      </Dialog>

      {/* Модальное окно редактирования */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl bg-slate-900 border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-white">Редактирование</DialogTitle>
          </DialogHeader>
          
          {selectedItem && (
            <div className="space-y-4">
              <div>
                <Label className="text-slate-300 text-sm">Название</Label>
                <Input
                  value={selectedItem.title}
                  onChange={(e) => setSelectedItem(i => ({ ...i, title: e.target.value }))}
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-slate-300 text-sm">Категория</Label>
                  <Select value={selectedItem.category} onValueChange={(v) => setSelectedItem(i => ({ ...i, category: v }))}>
                    <SelectTrigger className="bg-slate-800 border-slate-700 mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end gap-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={selectedItem.is_global}
                      onCheckedChange={(v) => setSelectedItem(i => ({ ...i, is_global: v }))}
                    />
                    <Label className="text-slate-300 text-sm">Глобальное</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={selectedItem.is_active !== false}
                      onCheckedChange={(v) => setSelectedItem(i => ({ ...i, is_active: v }))}
                    />
                    <Label className="text-slate-300 text-sm">Активно</Label>
                  </div>
                </div>
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Содержимое</Label>
                <Textarea
                  value={selectedItem.content}
                  onChange={(e) => setSelectedItem(i => ({ ...i, content: e.target.value }))}
                  className="bg-slate-800 border-slate-700 text-white mt-1 min-h-[200px]"
                />
              </div>
            </div>
          )}
          
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditOpen(false)} className="border-slate-700">
              Отмена
            </Button>
            <Button onClick={updateItem} className="bg-blue-600 hover:bg-blue-500">
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
