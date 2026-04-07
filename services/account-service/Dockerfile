FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json jest.config.ts ./
COPY src ./src
COPY tests ./tests
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
