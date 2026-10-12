import { useState } from "react";
import { Download, FileText, FileType2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { downloadFile, errorMessage } from "@/lib/api";

const FORMATS = {
  word: { label: "Word (.docx)", icon: FileText, ext: "docx" },
  pdf: { label: "PDF с диаграммами", icon: FileType2, ext: "pdf" },
};

export function ExportReportButton({ divisionId }) {
  const [exporting, setExporting] = useState(null);

  const exportReport = async (type) => {
    setExporting(type);
    try {
      const name = await downloadFile(`/divisions/${divisionId}/export/${type}`, `report.${FORMATS[type].ext}`);
      toast.success(`Отчёт скачан: ${name}`);
    } catch (err) {
      let message = errorMessage(err, "Ошибка экспорта отчёта");
      // Ответ об ошибке пришёл как Blob — достаём текст
      if (err?.response?.data instanceof Blob) {
        try {
          message = JSON.parse(await err.response.data.text()).detail || message;
        } catch {
          // оставляем общее сообщение
        }
      }
      toast.error(message);
    } finally {
      setExporting(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={Boolean(exporting)} data-testid="export-report-btn">
          {exporting ? <Loader2 className="animate-spin" /> : <Download />}
          {exporting ? "Формирование…" : "Отчёт"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {Object.entries(FORMATS).map(([type, format]) => (
          <DropdownMenuItem key={type} onClick={() => exportReport(type)} className="cursor-pointer" data-testid={`export-${type}-btn`}>
            <format.icon className="mr-2 h-4 w-4 text-primary" /> {format.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
