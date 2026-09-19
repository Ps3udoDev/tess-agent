# syntax=docker/dockerfile:1
# Build desde la RAÍZ del monorepo:
#   docker build -f services/api/Dockerfile -t tess-api .

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ---------- dependencias + build ----------
FROM base AS build
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY services/api ./services/api
# `...` incluye las dependencias del workspace de las que depende el servicio.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store     pnpm install --frozen-lockfile --filter @teams4soft/api...
RUN pnpm --filter @teams4soft/api build
# `deploy` materializa node_modules sin symlinks, para poder copiarlo de stage.
# `--legacy` es necesario mientras el workspace no use inject-workspace-packages.
RUN pnpm deploy --filter=@teams4soft/api --prod --legacy /prod/api

# ---------- runtime ----------
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
COPY --from=build --chown=node:node /prod/api/node_modules ./node_modules
COPY --from=build --chown=node:node /prod/api/dist ./dist
COPY --from=build --chown=node:node /prod/api/package.json ./package.json
USER node
EXPOSE 8080
# Sentry debe cargarse antes que la aplicación.
CMD ["node", "--import", "./dist/instrument.js", "dist/main.js"]
