const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const {
  createRoomIfNotExists,
  getRoomState,
  startGame,
  handlePlayerAction,
  nextPhase,
  settleGame
} = require('../shared/gameLogic');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const rooms = {};

// 服务静态前端
app.use(express.static(path.join(__dirname, 'build')));

io.on('connection', (socket) => {
  console.log('玩家连接：', socket.id);

  socket.on('joinRoom', ({ roomId, playerName }) => {
    socket.join(roomId);
    createRoomIfNotExists(rooms, roomId);

    // 避免重复加入
    const existing = rooms[roomId].players.find(p => p.id === socket.id);
    if (!existing) {
      rooms[roomId].players.push({
        id: socket.id,
        name: playerName,
        hand: [],
        chips: 1000,
        folded: false,
      });
    }
    rooms[roomId].players.forEach(player => {
        io.to(player.id).emit('roomUpdate', getRoomState(rooms[roomId], player.id));
      });
  });

  socket.on('startGame', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    startGame(room);
    room.players.forEach(player => {
        io.to(player.id).emit('roomUpdate', getRoomState(room, player.id));
    });
  });

  socket.on('playerAction', ({ roomId, playerId, action }) => {
    const room = rooms[roomId];
    if (!room) return;
  
    handlePlayerAction(room, playerId, action);
  
    // 结算逻辑
    if (room.phase === 'end') {
      settleGame(room);
    }
  
    // 逐个发送玩家视角
    room.players.forEach(player => {
      io.to(player.id).emit('roomUpdate', getRoomState(room, player.id));
    });
  });
  

  socket.on('disconnect', () => {
    for (let roomId in rooms) {
      const room = rooms[roomId];
      room.players = room.players.filter(p => p.id !== socket.id);
      io.to(roomId).emit('roomUpdate', getRoomState(room));
    }
  });
});

server.listen(PORT, () => {
  console.log(`德扑服务运行中: http://localhost:${PORT}`);
});
