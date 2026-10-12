import { useCallback, useEffect, useRef, useState } from "react";

import api, { errorMessage } from "@/lib/api";

/**
 * Загрузка данных с API: состояние загрузки, текст ошибки и повторный запрос.
 * Устаревшие ответы (после смены path или размонтирования) игнорируются.
 */
export function useApi(path, { enabled = true, initial = null } = {}) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled && path));
  const requestId = useRef(0);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!enabled || !path) return;
      const id = ++requestId.current;
      if (!silent) setLoading(true);
      try {
        const response = await api.get(path);
        if (id === requestId.current) {
          setData(response.data);
          setError(null);
        }
      } catch (err) {
        if (id === requestId.current) setError(errorMessage(err, "Не удалось загрузить данные"));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [path, enabled]
  );

  useEffect(() => {
    load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  return { data, error, loading, reload: load, setData };
}
