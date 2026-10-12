import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, Trash2, Loader2, File, FileSpreadsheet, Presentation } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

const FILE_ICONS = {
  ".pdf": FileText,
  ".docx": File,
  ".xlsx": FileSpreadsheet,
  ".pptx": Presentation,
  ".txt": FileText,
};

const formatSize = (bytes) => {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
};

export const DocumentsTab = ({ divisionId }) => {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);

  const load = () => {
    api.get(`/divisions/${divisionId}/documents`).then((r) => setDocs(r.data)).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [divisionId]);

  const uploadFiles = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    let success = 0;
    for (const file of files) {
      const allowed = [".pdf", ".docx", ".xlsx", ".pptx", ".txt"];
      const ext = "." + file.name.split(".").pop().toLowerCase();
      if (!allowed.includes(ext)) {
        toast.error(`Формат ${ext} не поддерживается`);
        continue;
      }
      try {
        const formData = new FormData();
        formData.append("file", file);
        await api.post(`/divisions/${divisionId}/documents`, formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        success++;
      } catch (err) {
        toast.error(`Ошибка загрузки: ${file.name}`);
      }
    }
    if (success > 0) toast.success(`Загружено файлов: ${success}`);
    setUploading(false);
    load();
  };

  const deleteDoc = async (docId) => {
    try {
      await api.delete(`/divisions/${divisionId}/documents/${docId}`);
      toast.success("Документ удалён");
      load();
    } catch (err) {
      toast.error("Ошибка удаления");
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    uploadFiles(e.dataTransfer.files);
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-blue-500 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6" data-testid="documents-tab">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Документы подразделения</h2>
          <p className="text-sm text-slate-400 mt-1">Загрузите ВНД, регламенты, инструкции, шаблоны</p>
        </div>
        <Badge variant="outline" className="border-slate-700 text-slate-400">{docs.length} файлов</Badge>
      </div>

      <div
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
          isDragging ? "border-blue-500 bg-blue-500/5" : "border-slate-700 hover:border-slate-600"
        }`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        data-testid="dropzone"
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.xlsx,.pptx,.txt"
          className="hidden"
          onChange={(e) => uploadFiles(e.target.files)}
          data-testid="file-input"
        />
        {uploading ? (
          <Loader2 className="w-10 h-10 text-blue-400 mx-auto mb-3 animate-spin" />
        ) : (
          <Upload className="w-10 h-10 text-slate-500 mx-auto mb-3" strokeWidth={1.5} />
        )}
        <p className="text-white font-medium mb-1">
          {uploading ? "Загрузка..." : "Перетащите файлы или кликните для выбора"}
        </p>
        <p className="text-sm text-slate-500">PDF, DOCX, XLSX, PPTX, TXT</p>
      </div>

      {docs.length > 0 && (
        <div className="space-y-2">
          {docs.map((doc, i) => {
            const Icon = FILE_ICONS[doc.file_type] || FileText;
            return (
              <div
                key={doc.id}
                className="flex items-center justify-between p-4 rounded-lg bg-slate-900/40 border border-slate-800 hover:border-slate-700 transition-colors animate-fade-in-up"
                style={{ animationDelay: `${i * 0.05}s` }}
                data-testid={`doc-item-${i}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-blue-600/10 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{doc.filename}</p>
                    <p className="text-xs text-slate-500">{formatSize(doc.file_size)} &middot; {new Date(doc.uploaded_at).toLocaleDateString("ru-RU")}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteDoc(doc.id)}
                  className="text-slate-500 hover:text-red-400 hover:bg-red-500/10 shrink-0"
                  data-testid={`delete-doc-${i}`}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
