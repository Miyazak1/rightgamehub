FROM node:22-bookworm-slim AS dependencies
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/creator-tools/package.json packages/creator-tools/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/multiplayer-protocol/package.json packages/multiplayer-protocol/package.json
COPY packages/rules-sdk/package.json packages/rules-sdk/package.json
RUN pnpm install --frozen-lockfile --filter @gamehub/api...

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/apps/api/node_modules ./apps/api/node_modules
COPY --chown=node:node apps/api/src/web-package-policy.mjs apps/api/src/source-build-policy.mjs apps/api/src/zip-buffer-writer.mjs apps/api/src/source-static-builder.mjs apps/api/src/source-static-builder-cli.mjs apps/api/src/source-build-runner.mjs apps/api/src/source-builder-service.mjs ./apps/api/src/
RUN mkdir -p /data/builder && chown -R node:node /data
USER node
CMD ["node", "apps/api/src/source-builder-service.mjs"]
