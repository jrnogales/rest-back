FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production || npm install --production
COPY src ./src
EXPOSE 3001
# Fuerza TLS no-verify solo para desbloquear el error de certificado
ENV NODE_TLS_REJECT_UNAUTHORIZED=0

CMD ["node", "src/server.js"]
