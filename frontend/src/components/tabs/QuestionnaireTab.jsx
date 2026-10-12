import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Save, ChevronRight, ChevronLeft, Check, Loader2, Mic, FileText, ClipboardPaste } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { AudioInput, DocExtractInput } from "@/components/AudioInput";

const InputToolbar = ({ questionId, onAppendText }) => {
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        onAppendText(text);
        toast.success("Текст вставлен из буфера обмена");
      }
    } catch (err) {
      toast.error("Нет доступа к буферу обмена. Используйте Ctrl+V.");
    }
  };

  return (
    <div className="flex items-center gap-1 mt-1.5 pl-1" data-testid={`toolbar-${questionId}`}>
      <AudioInput onTranscript={(text) => onAppendText(" " + text)} />
      <DocExtractInput onTextExtracted={(text) => onAppendText("\n" + text)} />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handlePaste}
        className="h-8 px-2 text-muted-foreground hover:text-foreground"
        title="Вставить из буфера"
        data-testid={`paste-btn-${questionId}`}
      >
        <ClipboardPaste className="w-4 h-4" />
      </Button>
      <span className="text-[10px] text-muted-foreground ml-1">
        <Mic className="w-3 h-3 inline mr-0.5" />голос
        <FileText className="w-3 h-3 inline mx-0.5 ml-2" />документ
        <ClipboardPaste className="w-3 h-3 inline mx-0.5 ml-2" />вставка
      </span>
    </div>
  );
};

export const QuestionnaireTab = ({ divisionId }) => {
  const [schema, setSchema] = useState([]);
  const [answers, setAnswers] = useState({});
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get("/questionnaire/schema"),
      api.get(`/divisions/${divisionId}/questionnaire`),
    ]).then(([schemaRes, answersRes]) => {
      setSchema(schemaRes.data);
      setAnswers(answersRes.data?.answers || {});
    }).catch(console.error).finally(() => setLoading(false));
  }, [divisionId]);

  const visibleSections = schema.filter((section) => {
    if (!section.condition) return true;
    const { question_id, value } = section.condition;
    return answers[question_id] === value;
  });

  const currentSection = visibleSections[step];

  const handleAnswer = (qId, value) => {
    setAnswers((prev) => ({ ...prev, [qId]: value }));
  };

  const appendText = (qId, text) => {
    setAnswers((prev) => ({
      ...prev,
      [qId]: ((prev[qId] || "") + text).trim(),
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.post(`/divisions/${divisionId}/questionnaire`, { answers });
      toast.success("Анкета сохранена");
    } catch (err) {
      toast.error("Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-blue-500 animate-spin" /></div>;
  }

  if (!currentSection) return null;

  const filledCount = Object.keys(answers).filter((k) => answers[k] !== "" && answers[k] !== undefined && answers[k] !== null).length;
  const totalQuestions = visibleSections.reduce((sum, s) => sum + s.questions.length, 0);

  return (
    <div className="max-w-3xl mx-auto space-y-6" data-testid="questionnaire-tab">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Анкетирование подразделения</h2>
          <p className="text-sm text-muted-foreground mt-1">Заполняйте текстом, голосом или из документа</p>
        </div>
        <Badge variant="outline" className="border-border text-muted-foreground">
          {filledCount}/{totalQuestions} ответов
        </Badge>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {visibleSections.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setStep(i)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors border ${
              i === step
                ? "bg-blue-600/15 text-blue-500 border-blue-500/20"
                : i < step
                ? "bg-emerald-600/10 text-emerald-500 border-emerald-500/20"
                : "bg-secondary/40 text-muted-foreground border-border"
            }`}
            data-testid={`step-${s.id}`}
          >
            {i < step ? <Check className="w-3.5 h-3.5" /> : <span className="w-5 h-5 rounded-full bg-secondary flex items-center justify-center text-xs">{i + 1}</span>}
            {s.title}
          </button>
        ))}
      </div>

      <div className="glass-card rounded-xl p-6 space-y-6 animate-fade-in-up">
        <h3 className="text-lg font-semibold text-foreground">{currentSection.title}</h3>

        {currentSection.questions.map((q) => (
          <div key={q.id} className="space-y-1" data-testid={`question-${q.id}`}>
            <Label className="text-muted-foreground text-sm">
              {q.text}
              {q.required && <span className="text-red-400 ml-1">*</span>}
            </Label>

            {q.type === "textarea" && (
              <>
                <Textarea
                  value={answers[q.id] || ""}
                  onChange={(e) => handleAnswer(q.id, e.target.value)}
                  placeholder={q.placeholder || ""}
                  className="bg-background border-input focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder:text-muted-foreground/50 min-h-[100px]"
                />
                <InputToolbar questionId={q.id} onAppendText={(text) => appendText(q.id, text)} />
              </>
            )}

            {q.type === "text" && (
              <>
                <Input
                  value={answers[q.id] || ""}
                  onChange={(e) => handleAnswer(q.id, e.target.value)}
                  placeholder={q.placeholder || ""}
                  className="bg-background border-input focus:border-blue-500 placeholder:text-muted-foreground/50"
                />
                <InputToolbar questionId={q.id} onAppendText={(text) => appendText(q.id, text)} />
              </>
            )}

            {q.type === "number" && (
              <Input
                type="number"
                value={answers[q.id] || ""}
                onChange={(e) => handleAnswer(q.id, parseInt(e.target.value) || 0)}
                className="bg-background border-input focus:border-blue-500"
              />
            )}

            {q.type === "select" && (
              <Select value={answers[q.id] || ""} onValueChange={(val) => handleAnswer(q.id, val)}>
                <SelectTrigger className="bg-background border-input focus:border-blue-500 text-foreground">
                  <SelectValue placeholder="Выберите..." />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {(q.options || []).map((opt) => (
                    <SelectItem key={opt} value={opt} className="text-foreground hover:bg-secondary focus:bg-secondary">
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {q.type === "boolean" && (
              <div className="flex items-center gap-3">
                <Switch
                  checked={answers[q.id] || false}
                  onCheckedChange={(val) => handleAnswer(q.id, val)}
                  className="data-[state=checked]:bg-blue-600"
                />
                <span className="text-sm text-muted-foreground">{answers[q.id] ? "Да" : "Нет"}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
          className="border-border text-foreground hover:bg-secondary"
          data-testid="prev-step-btn"
        >
          <ChevronLeft className="w-4 h-4 mr-1" /> Назад
        </Button>

        <Button
          onClick={save}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_15px_rgba(59,130,246,0.3)]"
          data-testid="save-questionnaire-btn"
        >
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Сохранить
        </Button>

        <Button
          onClick={() => setStep(Math.min(visibleSections.length - 1, step + 1))}
          disabled={step >= visibleSections.length - 1}
          className="bg-secondary hover:bg-secondary/80 text-foreground border border-border"
          data-testid="next-step-btn"
        >
          Далее <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
};
