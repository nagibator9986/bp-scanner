# Фронтенд AI BP Scanner

React 19 (CRA + craco), Tailwind CSS, shadcn/ui, Recharts, bpmn-js.

```bash
yarn install
yarn start   # http://localhost:3000, /api проксируется на DEV_BACKEND_URL (по умолчанию http://localhost:8000)
yarn build   # production-сборка в build/
```

Переменные — в `.env.example`. Продакшен-образ (`Dockerfile`) раздаёт сборку через nginx и проксирует `/api`
на `BACKEND_UPSTREAM` (шаблон `nginx/default.conf.template`).

Общие компоненты: `src/components/common.jsx` (панели, KPI-карточки, состояния загрузки и ошибок),
`src/hooks/useApi.js` (загрузка данных), `src/hooks/useChartTheme.js` (цвета графиков под тему).
