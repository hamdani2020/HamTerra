# Node 22 LTS (Node 20 is end of life). See the frontend design, Technology Choices.
FROM node:22-alpine AS base
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json .npmrc ./
RUN npm ci

FROM base AS dev
# Source arrives by bind mount (./frontend:/app). node_modules stays in the named volume
# frontend-node-modules, seeded from this image, so host modules never shadow it.
ENV HOST=0.0.0.0
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

FROM base AS build
COPY --chown=node:node . .
RUN npm run build
