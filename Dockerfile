# GRAFF — образ боевого сервера кафе.
#
# Из одного файла собираются два образа (стадия выбирается в docker-compose.yml):
#   docker build --target app .  → Node-сервер API (стадия по умолчанию, она последняя);
#   docker build --target web .  → nginx со статикой приложения внутри.
#
# Почему статика лежит в образе nginx, а не в общем томе: том пришлось бы наполнять
# при каждом запуске и следить, чтобы старые файлы не оставались. Здесь же
# `docker compose build` собирает клиента один раз, и оба образа получают согласованные версии.

# ---------- 1. Сборка приложения (Vite) ----------
FROM node:22-alpine AS client
WORKDIR /app

# Зависимости отдельным слоем: пока package-lock.json не менялся, слой берётся из кэша.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src

# В бою клиент ходит в API по относительному пути: nginx проксирует /api на сервер Node.
# Значение можно переопределить: docker build --build-arg VITE_API_URL=https://graff.example.ru/api
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
# Скрипт build сначала проверяет типы (tsc --noEmit), затем собирает bundle в /app/dist.
RUN npm run build

# ---------- 2. Зависимости сервера ----------
FROM node:22-alpine AS deps
WORKDIR /app/server

# better-sqlite3 — нативный модуль. Готовой сборки под Alpine (musl) нет,
# поэтому нужен компилятор: node-gyp собирает модуль из исходников.
RUN apk add --no-cache python3 make g++

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---------- 3. nginx со статикой ----------
FROM nginx:alpine AS web
# Собранное приложение кладём в корень сайта. Конфигурация монтируется из deploy/nginx.conf,
# чтобы правки прокси и сертификатов не требовали пересборки образа.
COPY --from=client /app/dist /usr/share/nginx/html

# ---------- 4. Сервер API ----------
FROM node:22-alpine AS app
ENV NODE_ENV=production
# Часовой пояс кафе: время заказов в журналах совпадает с временем на кухне.
ENV TZ=Europe/Moscow
WORKDIR /app/server

# Скомпилированный better-sqlite3 и остальные рабочие зависимости из стадии deps.
COPY --from=deps /app/server/node_modules ./node_modules
# Исходники сервера: TypeScript выполняется Node напрямую (--experimental-strip-types),
# отдельной сборки сервера не требуется.
COPY server ./
# Статика нужна и здесь: по ней удобно проверить, что образ собран из той же версии,
# и её можно раздать любым другим способом. Основной раздачей занимается nginx.
COPY --from=client /app/dist /app/dist

# Каталог базы данных: сюда монтируется том graff-data, писать в него должен пользователь node.
RUN mkdir -p /app/server/data && chown -R node:node /app/server/data
VOLUME ["/app/server/data"]

# Работаем без прав root.
USER node
EXPOSE 3000

CMD ["node", "--experimental-strip-types", "src/server.ts"]
