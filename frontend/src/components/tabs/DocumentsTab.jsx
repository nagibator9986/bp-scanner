import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Download, File, FileSpreadsheet, FileText, Layers, Presentation, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog, EmptyState, ErrorState, LoadingState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useApi } from "@/hooks/useApi";
import api, { downloadFile, errorMessage } from "@/lib/api";
import { ACCEPTED_FILES } from "@/lib/constants";
import { formatDateTime, formatNumber, formatSize, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

const FILE_ICONS = {
  ".pdf": FileText,
  ".docx": File,
  ".xlsx": FileSpreadsheet,
  ".csv": FileSpreadsheet,
  ".pptx": Presentation,
};
const ALLOWED = ACCEPTED_FILES.split(",");

/** Сколько места документы займут в контекстном окне модели и будут ли они конспектироваться. */
function ContextBudget({ divisionId }) {
  const { data } = useApi(`/divisions/${divisionId}/documents/budget`);
  if (!data?.configured || !data.documents?.length) return null;
  const percent = data.budget_tokens ? Math.min(100, Math.round((data.documents_tokens / data.budget_tokens) * 100)) : 100;
  return (
    <div
      className={cn("rounded-xl border p-4", data.fits ? "border-emerald-500/30 bg-emerald-500/5" : "border-primary/30 bg-primary/5")}
      data-testid="context-budget"
    >
      <div className="flex items-start gap-3">
        {data.fits ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <Layers className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-medium text-foreground">
            {data.fits
              ? "Документы целиком помещаются в контекст модели"
              : `Документы больше окна модели — перед анализом ${data.digest_documents} ${plural(data.digest_documents, ["документ будет законспектирован", "документа будут законспектированы", "документов будут законспектированы"])}`}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div className={cn("h-full rounded-full", data.fits ? "bg-emerald-500" : "bg-primary")} style={{ width: `${percent}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DocumentRow({ doc, index, onDelete, divisionId }) {
  const [open, setOpen] = useState(false);
  const Icon = FILE_ICONS[doc.file_type] || FileText;
  const noText = doc.text_length === 0;

  const download = async () => {
    try {
      await downloadFile(`/divisions/${divisionId}/documents/${doc.id}/download`, doc.filename);
    } catch (err) {
      toast.error(errorMessage(err, "Не удалось скачать файл"));
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card/70 transition-colors hover:border-primary/30" data-testid={`doc-item-${index}`}>
      <div className="flex items-center gap-3 p-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen((v) => !v)}>
          <p className="truncate text-sm font-medium text-foreground">{doc.filename}</p>
          <p className="text-xs text-muted-foreground">
            {formatSize(doc.file_size)} · {formatDateTime(doc.uploaded_at)}
            {doc.text_length != null && !noText && ` · ${formatNumber(doc.text_length, 0)} символов текста`}
          </p>
        </button>
        {noText && (
          <span className="hidden items-center gap-1 text-xs text-amber-500 sm:flex" title="Модель не увидит содержимое: возможно, это скан без текстового слоя">
            <AlertTriangle className="h-3.5 w-3.5" /> нет текста
          </span>
        )}
        {doc.text_preview && (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => setOpen((v) => !v)} aria-label="Предпросмотр">
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={download} aria-label="Скачать">
          <Download />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-red-500"
          onClick={() => onDelete(doc)}
          aria-label="Удалить"
          data-testid={`delete-doc-${index}`}
        >
          <Trash2 />
        </Button>
      </div>
      {open && doc.text_preview && (
        <pre className="mx-3 mb-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-secondary/50 p-3 text-xs text-muted-foreground">
          {doc.text_preview}
          {doc.text_length > doc.text_preview.length && "…"}
        </pre>
      )}
    </div>
  );
}

export const DocumentsTab = ({ divisionId, onChange }) => {
  const { data: docs, error, loading, reload, setData } = useApi(`/divisions/${divisionId}/documents`, { initial: [] });
  const [uploads, setUploads] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!loading && !error) onChangeRef.current?.(docs.length);
  }, [docs, loading, error]);

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const queue = files.map((file, i) => ({ id: `${Date.now()}-${i}`, name: file.name, progress: 0, file }));
    setUploads((prev) => [...prev, ...queue]);
    let uploaded = 0;
    for (const item of queue) {
      const extension = `.${item.name.split(".").pop().toLowerCase()}`;
      if (!ALLOWED.includes(extension)) {
        toast.error(`«${item.name}»: формат ${extension} не поддерживается`);
        setUploads((prev) => prev.filter((u) => u.id !== item.id));
        continue;
      }
      try {
        const form = new FormData();
        form.append("file", item.file);
        const { data } = await api.post(`/divisions/${divisionId}/documents`, form, {
          onUploadProgress: (event) => {
            const progress = event.total ? Math.round((event.loaded / event.total) * 100) : 50;
            setUploads((prev) => prev.map((u) => (u.id === item.id ? { ...u, progress } : u)));
          },
        });
        setData((prev) => [...(prev || []), data]);
        uploaded += 1;
        if (data.text_length === 0) toast.warning(`«${item.name}»: текст не извлечён (возможно, скан)`);
      } catch (err) {
        toast.error(`«${item.name}»: ${errorMessage(err, "ошибка загрузки")}`);
      } finally {
        setUploads((prev) => prev.filter((u) => u.id !== item.id));
      }
    }
    if (uploaded) toast.success(`Загружено файлов: ${uploaded}`);
    if (inputRef.current) inputRef.current.value = "";
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await api.delete(`/divisions/${divisionId}/documents/${deleting.id}`);
      setData((prev) => prev.filter((d) => d.id !== deleting.id));
      toast.success("Документ удалён");
      setDeleting(null);
    } catch (err) {
      toast.error(errorMessage(err, "Ошибка удаления"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const totalChars = docs.reduce((sum, d) => sum + (d.text_length || 0), 0);

  return (
    <div className="space-y-5" data-testid="documents-tab">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Документы подразделения</h2>
          <p className="mt-1 text-sm text-muted-foreground">ВНД, регламенты, инструкции, шаблоны форм — модель извлечёт из них процессы и роли</p>
        </div>
        {docs.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {docs.length} {plural(docs.length, ["файл", "файла", "файлов"])} · {formatNumber(totalChars, 0)} символов текста
          </p>
        )}
      </div>

      <div
        role="button"
        tabIndex={0}
        className={cn(
          "cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          uploadFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        data-testid="dropzone"
      >
        <input ref={inputRef} type="file" multiple accept={ACCEPTED_FILES} className="hidden" onChange={(e) => uploadFiles(e.target.files)} data-testid="file-input" />
        <Upload className="mx-auto mb-3 h-9 w-9 text-muted-foreground" strokeWidth={1.5} />
        <p className="font-medium text-foreground">Перетащите файлы или нажмите для выбора</p>
        <p className="mt-1 text-sm text-muted-foreground">PDF, DOCX, XLSX, PPTX, TXT, CSV, MD</p>
      </div>

      {uploads.length > 0 && (
        <div className="space-y-2">
          {uploads.map((upload) => (
            <div key={upload.id} className="rounded-lg border border-border p-3">
              <div className="mb-1.5 flex justify-between text-xs">
                <span className="truncate text-foreground">{upload.name}</span>
                <span className="text-muted-foreground">{upload.progress < 100 ? `${upload.progress}%` : "Извлечение текста…"}</span>
              </div>
              <Progress value={upload.progress} className="h-1.5" />
            </div>
          ))}
        </div>
      )}

      {docs.length > 0 && <ContextBudget key={docs.map((d) => d.id).join()} divisionId={divisionId} />}

      {docs.length === 0 && uploads.length === 0 ? (
        <EmptyState icon={FileText} title="Документы не загружены" description="Без документов анализ опирается только на анкету" />
      ) : (
        <div className="space-y-2">
          {docs.map((doc, index) => (
            <DocumentRow key={doc.id} doc={doc} index={index} divisionId={divisionId} onDelete={setDeleting} />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Удалить документ?"
        description={deleting?.filename}
        onConfirm={confirmDelete}
        busy={busy}
      />
    </div>
  );
};
