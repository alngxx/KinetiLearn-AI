FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite bakes the API origin into the JS at build time, so it is a build arg, not a runtime env var.
ARG VITE_API_BASE_URL
RUN test -n "$VITE_API_BASE_URL" && npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
