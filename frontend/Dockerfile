# Этап 1: Сборка
FROM node:20-alpine AS build

WORKDIR /app

# Копируем файлы зависимостей
COPY package.json yarn.lock ./

# Устанавливаем зависимости
RUN yarn install --frozen-lockfile

# Копируем остальные файлы проекта
COPY . .

ARG REACT_APP_BACKEND_URL
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL

ARG REACT_APP_ENV
ENV REACT_APP_ENV=$REACT_APP_ENV

# Собираем проект через craco
RUN yarn build

# Этап 2: Раздача статики через Nginx
FROM nginx:stable-alpine

# Копируем билд из предыдущего этапа в папку nginx
COPY --from=build /app/build /usr/share/nginx/html

# Копируем кастомный конфиг (если нужен, см. ниже)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]