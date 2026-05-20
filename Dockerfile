FROM node:20-alpine
WORKDIR /app
COPY backend/server.js .
RUN mkdir -p /app/uploads /app/data
EXPOSE 3000
CMD ["node", "server.js"]
