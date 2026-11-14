# Image de base légère avec Node.js
FROM node:18-alpine

WORKDIR /app

# Installe uniquement les dépendances de production
COPY package*.json ./
RUN npm ci --omit=dev

# Copie le reste du code de l'application
COPY . .

# Back4App Containers fournit le port via la variable d'environnement PORT ;
# server.js la lit déjà (process.env.PORT || 3000).
EXPOSE 3000

CMD ["node", "server.js"]
