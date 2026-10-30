FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000 4000/tcp 5000/udp 6000/tcp
CMD ["npm", "start"]
