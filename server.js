/**
 * Serveur de signalisation pour le système de surveillance à distance.
 *
 * Rôle : ce serveur NE transporte PAS la vidéo. Il sert uniquement à mettre
 * en relation deux navigateurs (la "caméra" et le "viewer") pour qu'ils
 * puissent établir une connexion WebRTC directe (pair à pair). Le flux
 * vidéo, lui, passe directement entre les deux appareils une fois la
 * connexion établie.
 */

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function getOrCreateRoom(roomCode) {
  if (!rooms[roomCode]) {
    rooms[roomCode] = {
      password: null,
      cameraSocketId: null,
      viewerSocketIds: new Set(),
    };
  }
  return rooms[roomCode];
}

io.on('connection', (socket) => {
  let joinedRoom = null;
  let joinedRole = null;

  socket.on('camera:join', ({ roomCode, password }) => {
    if (!roomCode) return socket.emit('error:message', 'Code de salle manquant.');

    const room = getOrCreateRoom(roomCode);

    if (room.cameraSocketId && room.cameraSocketId !== socket.id) {
      return socket.emit('error:message', 'Une caméra est déjà active sur cette salle.');
    }

    if (room.password && room.password !== password) {
      return socket.emit('error:message', 'Mot de passe incorrect pour cette salle.');
    }

    room.password = password || room.password;
    room.cameraSocketId = socket.id;
    joinedRoom = roomCode;
    joinedRole = 'camera';

    socket.join(roomCode);
    socket.emit('camera:joined', { roomCode });
    console.log(`[camera] connectée sur la salle ${roomCode}`);
  });

  socket.on('viewer:join', ({ roomCode, password }) => {
    if (!roomCode) return socket.emit('error:message', 'Code de salle manquant.');

    const room = rooms[roomCode];
    if (!room || !room.cameraSocketId) {
      return socket.emit('error:message', 'Aucune caméra active sur ce code de salle.');
    }

    if (room.password && room.password !== password) {
      return socket.emit('error:message', 'Mot de passe incorrect.');
    }

    room.viewerSocketIds.add(socket.id);
    joinedRoom = roomCode;
    joinedRole = 'viewer';

    socket.join(roomCode);
    socket.emit('viewer:joined', { roomCode });

    io.to(room.cameraSocketId).emit('viewer:request-offer', { viewerId: socket.id });
    console.log(`[viewer] connecté sur la salle ${roomCode}`);
  });

  socket.on('signal', ({ to, data }) => {
    if (!to) return;
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('disconnect', () => {
    if (!joinedRoom || !rooms[joinedRoom]) return;
    const room = rooms[joinedRoom];

    if (joinedRole === 'camera' && room.cameraSocketId === socket.id) {
      room.cameraSocketId = null;
      io.to(joinedRoom).emit('camera:disconnected');
      console.log(`[camera] déconnectée de la salle ${joinedRoom}`);
    } else if (joinedRole === 'viewer') {
      room.viewerSocketIds.delete(socket.id);
      if (room.cameraSocketId) {
        io.to(room.cameraSocketId).emit('viewer:left', { viewerId: socket.id });
      }
      console.log(`[viewer] déconnecté de la salle ${joinedRoom}`);
    }

    if (!room.cameraSocketId && room.viewerSocketIds.size === 0) {
      delete rooms[joinedRoom];
    }
  });
});

server.listen(PORT, () => {
  console.log(`Serveur de signalisation démarré sur http://localhost:${PORT}`);
  console.log(`- Ouvrez /camera.html sur l'appareil qui filme`);
  console.log(`- Ouvrez /viewer.html sur l'appareil qui regarde`);
});
