import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Upload, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

const SpeechRecognition = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

export const AudioInput = ({ onTranscript }) => {
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef(null);

  const toggleRecording = useCallback(() => {
    if (!SpeechRecognition) {
      toast.error("Браузер не поддерживает распознавание речи. Используйте Chrome.");
      return;
    }

    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "ru-RU";
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          transcript += event.results[i][0].transcript + " ";
        }
      }
      if (transcript.trim()) {
        onTranscript(transcript.trim());
      }
    };

    recognition.onerror = (event) => {
      if (event.error !== "aborted") {
        toast.error("Ошибка распознавания: " + event.error);
      }
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
    toast.info("Запись начата. Говорите...");
  }, [isRecording, onTranscript]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={toggleRecording}
      className={`h-8 px-2 ${isRecording ? "text-red-400 bg-red-500/10 hover:bg-red-500/20 animate-pulse" : "text-muted-foreground hover:text-foreground"}`}
      data-testid="audio-input-btn"
      title={isRecording ? "Остановить запись" : "Голосовой ввод"}
    >
      {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
    </Button>
  );
};

export const DocExtractInput = ({ onTextExtracted }) => {
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    const allowed = [".pdf", ".docx", ".xlsx", ".pptx", ".txt"];
    const ext = "." + file.name.split(".").pop().toLowerCase();
    if (!allowed.includes(ext)) {
      toast.error(`Формат ${ext} не поддерживается`);
      return;
    }
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await api.post("/extract-text", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (data.text) {
        onTextExtracted(data.text);
        toast.success(`Текст извлечён из ${data.filename}`);
      } else {
        toast.warning("Не удалось извлечь текст из документа");
      }
    } catch (err) {
      toast.error("Ошибка извлечения текста");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.xlsx,.pptx,.txt"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="h-8 px-2 text-muted-foreground hover:text-foreground"
        data-testid="doc-extract-btn"
        title="Загрузить документ и извлечь текст"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
      </Button>
    </>
  );
};
