import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FileText, FileSpreadsheet, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

export function ExportReportButton({ divisionId, divisionName }) {
  const [exporting, setExporting] = useState(false);
  const [exportType, setExportType] = useState(null);

  const exportReport = async (type) => {
    try {
      setExporting(true);
      setExportType(type);
      
      const response = await api.get(`/divisions/${divisionId}/export/${type}`, {
        responseType: 'blob'
      });
      
      const blob = new Blob([response.data], { 
        type: type === 'word' 
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'application/pdf'
      });
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(divisionName || 'report').replace(/[^a-zA-Zа-яА-Я0-9]/g, '_')}_report.${type === 'word' ? 'docx' : 'pdf'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success(`Отчёт ${type === 'word' ? 'Word' : 'PDF'} скачан`);
    } catch (err) {
      console.error('Export error:', err);
      toast.error('Ошибка экспорта отчёта');
    } finally {
      setExporting(false);
      setExportType(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-600/10"
          disabled={exporting}
          data-testid="export-report-btn"
        >
          {exporting ? (
            <>
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              Экспорт...
            </>
          ) : (
            <>
              <Download className="w-4 h-4 mr-1.5" />
              Экспорт отчёта
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-slate-900 border-slate-800">
        <DropdownMenuItem 
          onClick={() => exportReport('word')}
          className="text-slate-300 focus:bg-slate-800 focus:text-white cursor-pointer"
          data-testid="export-word-btn"
        >
          <FileText className="w-4 h-4 mr-2 text-blue-400" />
          Скачать Word (.docx)
        </DropdownMenuItem>
        <DropdownMenuItem 
          onClick={() => exportReport('pdf')}
          className="text-slate-300 focus:bg-slate-800 focus:text-white cursor-pointer"
          data-testid="export-pdf-btn"
        >
          <FileSpreadsheet className="w-4 h-4 mr-2 text-red-400" />
          Скачать PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
