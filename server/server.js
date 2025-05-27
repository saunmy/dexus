const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Hand } = require('pokersolver');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

const PORT = 3001;

let games = {}; // 所有房间的状态

// 工具函数
function createDeck() {
  const suits = ['s', 'h', 'd', 'c'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const deck = [];
  for (const suit of suits) {
    for (const value of values) {
      deck.push(value + suit);
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

function createRoom(room) {
  if (!games[room]) {
    games[room] = {
      players: [],
      gameStarted: false,
    };
  }
}

function joinRoom(room, playerName) {
  createRoom(room);
  const game = games[room];
  if (!game.players.some(p => p.name === playerName)) {
    game.players.push({
      name: playerName,
      chips: 1000,
    });
  }
}

function startGame(room) {
  if (!games[room] || games[room].players.length === 0) return;

  const game = {
    players: games[room].players,
    deck: createDeck(),
    communityCards: [],
    pot: 0,
    currentPlayerIndex: 0,
    round: 'preflop',
    gameStarted: true,
  };

  shuffleDeck(game.deck);

  for (const player of game.players) {
    player.hand = [game.deck.pop(), game.deck.pop()];
    player.folded = false;
    player.allIn = false;
    player.currentBet = 0;
    player.totalBet = 0;
    player.bet = 0;
    player.winner = false;
  }

  games[room] = game;
  broadcastGameState(room);
}

function broadcastGameState(room) {
  const game = games[room];
  if (!game) return;

  for (const player of game.players) {
    const playerSocketId = player.id;
    if (playerSocketId) {
      io.to(playerSocketId).emit('roomUpdate', getGameState(room, player.name));
    }
  }
}

function getGameState(roomId, playerName) {
  const game = games[roomId];
  if (!game) return {};

  return {
    yourName: playerName,
    yourHand: game.players.find(p => p.name === playerName)?.hand || [],
    communityCards: game.communityCards,
    players: game.players.map(p => ({
      name: p.name,
      chips: p.chips,
      bet: p.bet,
      folded: p.folded,
      winner: p.winner || false,
      handDesc: p.handDesc || '',
      handSolved: p.handSolved || [],
    })),
    pot: game.pot,
    round: game.round,
    currentPlayer: game.players[game.currentPlayerIndex]?.name,
    phase: game.round === 'showdown' ? 'end' : 'playing',
  };
}

function getActivePlayers(game) {
  return game.players.filter(p => !p.folded && !p.allIn);
}
function advanceRound(game) {
  if (game.round === 'preflop') {
    game.communityCards = game.deck.splice(0, 3);
    game.round = 'flop';
  } else if (game.round === 'flop') {
    game.communityCards.push(game.deck.pop());
    game.round = 'turn';
  } else if (game.round === 'turn') {
    game.communityCards.push(game.deck.pop());
    game.round = 'river';
  } else if (game.round === 'river') {
    game.round = 'showdown';
    settleGame(game);
    return;
  }

  for (const p of game.players) {
    p.currentBet = 0;
    p.hasActed = false;
  }

  game.lastAggressorIndex = null; // ⭐ 新轮开始重置加注者
  game.currentPlayerIndex = game.players.findIndex(p => !p.folded && !p.allIn);
}

function handlePlayerAction(game, playerName, action, amount = 0) {
  const player = game.players.find(p => p.name === playerName);
  if (!player || player.folded || player.allIn || game.round === 'showdown') return;

  const maxBet = Math.max(...game.players.map(p => p.currentBet));

  switch (action) {
    case 'fold':
      player.folded = true;
      player.hasActed = true;
      break;

    case 'call':
      const toCall = maxBet - player.currentBet;
      player.currentBet += toCall;
      player.totalBet += toCall;
      game.pot += toCall;
      player.hasActed = true;
      break;

    case 'raise':
      if (amount <= 0) return;
      const raiseTotal = (maxBet - player.currentBet) + amount;
      player.currentBet += raiseTotal;
      player.totalBet += raiseTotal;
      game.pot += raiseTotal;

      // ⭐ 设置为最后加注者
      game.lastAggressorIndex = game.players.indexOf(player);

      // ⭐ 所有其他人需要重新行动
      for (const p of game.players) {
        if (p !== player && !p.folded && !p.allIn) {
          p.hasActed = false;
        }
      }

      player.hasActed = true;
      break;

    case 'allin':
      const allInAmount = amount;
      player.currentBet += allInAmount;
      player.totalBet += allInAmount;
      game.pot += allInAmount;
      player.allIn = true;
      player.hasActed = true;
      break;
  }

  const activePlayers = getActivePlayers(game);
  if (activePlayers.length <= 1) {
    game.round = 'showdown';
    settleGame(game);
    return;
  }

  // ⭐ 判断是否轮到最后一个加注者，并且所有人都已响应（hasActed）
  const betsEqual = activePlayers.every(p => p.currentBet === activePlayers[0].currentBet);
  const allActed = activePlayers.every(p => p.hasActed || p.allIn);

  if (
    betsEqual &&
    allActed &&
    (game.lastAggressorIndex === null || game.currentPlayerIndex === game.lastAggressorIndex)
  ) {
    advanceRound(game);
    return;
  }

  // 找下一个要行动的人
  let nextIndex = game.currentPlayerIndex;
  let loopCount = 0;
  do {
    nextIndex = (nextIndex + 1) % game.players.length;
    loopCount++;
  } while (
    (game.players[nextIndex].folded || game.players[nextIndex].allIn) &&
    loopCount <= game.players.length
  );

  game.currentPlayerIndex = nextIndex;

  console.log(
    `当前轮次: ${game.round}, 当前行动玩家: ${game.players[game.currentPlayerIndex].name}`
  );
}



function settleGame(game) {
  const livePlayers = game.players.filter(p => !p.folded);
  const community = game.communityCards;

  const playerHands = livePlayers.map(p => {
    const fullHand = Hand.solve([...p.hand, ...community]);
    return {
      player: p,
      solverHand: fullHand
    };
  });

  const winners = Hand.winners(playerHands.map(p => p.solverHand));

  for (const { player, solverHand } of playerHands) {
    player.handDesc = solverHand.descr;
    player.handSolved = solverHand.cards.map(c => c.value + c.suit);
  }

  winners.forEach(w => {
    const winnerPlayer = playerHands.find(p => p.solverHand === w)?.player;
    if (winnerPlayer) winnerPlayer.winner = true;
  });

  const winAmount = Math.floor(game.pot / winners.length);
  for (const w of winners) {
    const winnerPlayer = playerHands.find(p => p.solverHand === w)?.player;
    if (winnerPlayer) winnerPlayer.chips += winAmount;
  }

  game.phase = 'showdown';
}

// 前端构建资源（可选）
app.use(express.static(path.join(__dirname, '../client/build')));

io.on('connection', (socket) => {
  console.log('玩家连接：', socket.id);

  socket.on('joinRoom', ({ roomId, playerName }) => {
    socket.join(roomId);
    joinRoom(roomId, playerName);
    const game = games[roomId];
    const player = game.players.find(p => p.name === playerName);
    if (player) player.id = socket.id;
    broadcastGameState(roomId);
  });

  socket.on('startGame', (roomId) => {
    if (!games[roomId]) return;
    startGame(roomId);
  });

  socket.on('playerAction', ({ roomId, playerId, action, amount }) => {
    console.log('收到玩家操作:', { roomId, playerId, action, amount });
    if (!games[roomId]) return;
    handlePlayerAction(games[roomId], playerId, action, amount);
    broadcastGameState(roomId);
  });

  socket.on('disconnect', () => {
    for (const roomId in games) {
      const room = games[roomId];
      const beforeCount = room.players.length;
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length !== beforeCount) {
        broadcastGameState(roomId);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`德扑服务器运行中：http://localhost:${PORT}`);
});
