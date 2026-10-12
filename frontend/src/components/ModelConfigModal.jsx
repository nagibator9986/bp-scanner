import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, Server, Key, Globe, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

const PROVIDERS = [
  { value: "openai", label: "OpenAI", desc: "GPT-4o, GPT-5.2 и др.", icon: "O" },
  { value: "anthropic", label: "Anthropic", desc: "Claude Sonnet, Opus", icon: "A" },
  { value: "google", label: "Google", desc: "Gemini Pro, Flash", icon: "G" },
  { value: "custom", label: "On-Prem / Custom", desc: "Своя модель (OpenAI-compatible API)", icon: "C" },
];

export const ModelConfigModal = ({ open, onOpenChange }) => {
  const [settings, setSettings] = useState({
    provider: "openai", api_key: "", model_name: "gpt-5.2", endpoint_url: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      api.get("/settings").then((r) => {
        setSettings({
          provider: r.data.provider === "emergent" ? "openai" : (r.data.provider || "openai"),
          api_key: r.data.api_key || "",
          model_name: r.data.model_name || "gpt-5.2",
          endpoint_url: r.data.endpoint_url || "",
        });
      }).catch(console.error).finally(() => setLoading(false));
    }
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.post("/settings", settings);
      toast.success("Настройки модели сохранены");
      onOpenChange(false);
    } catch (err) {
      toast.error("Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const needsKey = true;
  const needsEndpoint = settings.provider === "custom";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-lg" data-testid="model-config-modal">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-400" /> Настройки AI модели
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 text-blue-500 animate-spin" /></div>
        ) : (
          <div className="space-y-5 mt-2">
            <div className="space-y-2">
              <Label className="text-muted-foreground text-sm">Провайдер</Label>
              <div className="grid grid-cols-1 gap-2">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setSettings((s) => ({ ...s, provider: p.value }))}
                    className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                      settings.provider === p.value
                        ? "border-blue-500/40 bg-blue-500/5"
                        : "border-border hover:border-muted-foreground/30 bg-transparent"
                    }`}
                    data-testid={`provider-${p.value}`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${
                      settings.provider === p.value ? "bg-blue-600 text-white" : "bg-secondary text-muted-foreground"
                    }`}>
                      {p.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{p.label}</p>
                      <p className="text-xs text-muted-foreground">{p.desc}</p>
                    </div>
                    {settings.provider === p.value && <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />}
                  </button>
                ))}
              </div>
            </div>

            {needsKey && (
              <div className="space-y-2">
                <Label className="text-muted-foreground text-sm flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5" /> API Key
                </Label>
                <Input
                  data-testid="api-key-input"
                  type="password"
                  value={settings.api_key}
                  onChange={(e) => setSettings((s) => ({ ...s, api_key: e.target.value }))}
                  placeholder={settings.provider === "openai" ? "sk-..." : settings.provider === "anthropic" ? "sk-ant-..." : "Введите API ключ"}
                  className="bg-background border-input focus:border-blue-500"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-muted-foreground text-sm">Модель</Label>

              <Input
                data-testid="model-name-input"
                value={settings.model_name}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, model_name: e.target.value }))
                }
                placeholder={
                  settings.provider === "custom"
                    ? "llama-3.1-70b, mistral-7b..."
                    : settings.provider === "openai"
                    ? "gpt-5.2, gpt-4o..."
                    : settings.provider === "anthropic"
                    ? "claude-sonnet-4.5..."
                    : "gemini-pro..."
                }
                className="bg-background border-input focus:border-blue-500"
              />
            </div>

            {needsEndpoint && (
              <div className="space-y-2">
                <Label className="text-muted-foreground text-sm flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5" /> Endpoint URL
                </Label>
                <Input
                  data-testid="endpoint-url-input"
                  value={settings.endpoint_url}
                  onChange={(e) => setSettings((s) => ({ ...s, endpoint_url: e.target.value }))}
                  placeholder="https://your-server.com/v1"
                  className="bg-background border-input focus:border-blue-500"
                />
                <p className="text-xs text-muted-foreground">OpenAI-совместимый API endpoint (vLLM, Ollama, TGI и др.)</p>
              </div>
            )}

            <Button
              onClick={handleSave}
              disabled={saving || (needsKey && !settings.api_key)}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white"
              data-testid="save-settings-btn"
            >
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Сохранить настройки
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
