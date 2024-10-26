FROM node:lts

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install
#node .output/server/index.mjs


EXPOSE 3000

CMD ["npm", "run", "dev"]
