import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Mic, MicOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import api, { errorMessage } from "@/lib/api";
import { ACCEPTED_FILES } from "@/lib/constants";

const SpeechRecognition = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

/** Голосовой ввод через Web Speech API (Chrome/Edge). */
export const AudioInput = ({ onTranscript }) => {
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef(null);
  const callbackRef = useRef(onTranscript);
  callbackRef.current = onTranscript;

  // Запись останавливается при уходе со страницы/вопроса — текст не попадёт в чужое поле
  useEffect(() => () => recognitionRef.current?.abort(), []);

  const toggleRecording = () => {
    if (!SpeechRecognition) {
      toast.error("Браузер не поддерживает распознавание речи. Используйте Chrome или Edge.");
      return;
    }
    if (isRecording) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "ru-RU";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) transcript += `${event.results[i][0].transcript} `;
      }
      if (transcript.trim()) callbackRef.current(transcript.trim());
    };
    recognition.onerror = (event) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        toast.error(`Ошибка распознавания: ${event.error}`);
      }
    };
    recognition.onend = () => setIsRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={toggleRecording}
      className={isRecording ? "h-8 animate-pulse bg-red-500/10 px-2 text-red-500 hover:bg-red-500/20" : "h-8 px-2 text-muted-foreground"}
      title={isRecording ? "Остановить запись" : "Голосовой ввод"}
      data-testid="audio-input-btn"
    >
      {isRecording ? <MicOff /> : <Mic />}
      {isRecording && <span className="text-xs">Запись…</span>}
    </Button>
  );
};

/** Извлечение текста из документа и вставка в поле ответа. */
export const DocExtractInput = ({ onTextExtracted }) => {
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await api.post("/extract-text", formData);
      if (data.text) {
        onTextExtracted(data.text);
        toast.success(`Текст извлечён из «${data.filename}»`);
      } else {
        toast.warning("В документе не найден текст");
      }
    } catch (err) {
      toast.error(errorMessage(err, "Ошибка извлечения текста"));
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept={ACCEPTED_FILES} className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="h-8 px-2 text-muted-foreground"
        title="Извлечь текст из документа"
        data-testid="doc-extract-btn"
      >
        {loading ? <Loader2 className="animate-spin" /> : <FileText />}
      </Button>
    </>
  );
};
