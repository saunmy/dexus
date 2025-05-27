const { Hand } = require('pokersolver');

let games = {}; // 保存每个房间的游戏状态

function createDeck() {
  const suits = ['s', 'h', 'd', 'c']; // 黑红方梅
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

function startGame(room) {
  if (!games[room] || !games[room].players || games[room].players.length === 0) {
    console.log(`房间 ${room} 不存在或没有玩家，无法开始游戏`);
    return;
  }
  const game = {
    players: [],
    deck: [],
    communityCards: [],
    pot: 0,
    currentPlayerIndex: 0,
    round: 'preflop', // 可为 'preflop', 'flop', 'turn', 'river', 'showdown'
    gameStarted: true,
  };

  game.deck = createDeck();
  shuffleDeck(game.deck);

  for (const player of games[room].players) {
    player.hand = [game.deck.pop(), game.deck.pop()];
    player.folded = false;
    player.allIn = false;
    player.currentBet = 0;
    player.totalBet = 0;
    player.bet = 0;
    player.winner = false;
  }
  broadcastGameState(room);
  console.log(`房间 ${room} 游戏开始，玩家手牌已发`);
}
function broadcastGameState(room) {
  const game = games[room];
  if (!game) return;
  io.to(room).emit('roomUpdate', game);
}

function getActivePlayers(game) {
  return game.players.filter(p => !p.folded && !p.allIn);
}

function advanceRound(game) {
  if (game.round === 'preflop') {
    game.communityCards = game.deck.splice(0, 3); // Flop
    game.round = 'flop';
  } else if (game.round === 'flop') {
    game.communityCards.push(game.deck.pop()); // Turn
    game.round = 'turn';
  } else if (game.round === 'turn') {
    game.communityCards.push(game.deck.pop()); // River
    game.round = 'river';
  } else if (game.round === 'river') {
    game.round = 'showdown';
    settleGame(game);
    return;
  }

  // 重置下注
  for (const p of game.players) {
    p.currentBet = 0;
  }

  game.currentPlayerIndex = game.players.findIndex(p => !p.folded && !p.allIn);
}

function handlePlayerAction(game, playerName, action, amount = 0) {
  const player = game.players.find(p => p.name === playerName);
  if (!player || player.folded || player.allIn || game.round === 'showdown') return;

  switch (action) {
    case 'fold':
      player.folded = true;
      break;
    case 'call':
      const maxBet = Math.max(...game.players.map(p => p.currentBet));
      const toCall = maxBet - player.currentBet;
      player.currentBet += toCall;
      player.totalBet += toCall;
      player.bet += toCall;
      game.pot += toCall;
      break;
    case 'raise':
      const raiseAmount = amount;
      const currentMax = Math.max(...game.players.map(p => p.currentBet));
      const total = currentMax - player.currentBet + raiseAmount;
      player.currentBet += total;
      player.totalBet += total;
      player.bet += total;
      game.pot += total;
      break;
    case 'allin':
      player.allIn = true;
      const allInAmount = amount;
      player.currentBet += allInAmount;
      player.totalBet += allInAmount;
      player.bet += allInAmount;
      game.pot += allInAmount;
      break;
  }

  // 跳过下一个已弃牌/All-in玩家
  let nextIndex = (game.currentPlayerIndex + 1) % game.players.length;
  while (game.players[nextIndex].folded || game.players[nextIndex].allIn) {
    nextIndex = (nextIndex + 1) % game.players.length;
    if (nextIndex === game.currentPlayerIndex) break;
  }

  game.currentPlayerIndex = nextIndex;

  const activePlayers = getActivePlayers(game);
  const betsEqual = activePlayers.every(p => p.currentBet === activePlayers[0].currentBet);

  if (activePlayers.length <= 1) {
    game.round = 'showdown';
    settleGame(game);
    return;
  }

  if (betsEqual && action !== 'raise') {
    advanceRound(game);
  }
}

function settleGame(room) {
    const livePlayers = room.players.filter(p => !p.folded);
    const community = room.communityCards;
  
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
  
    const winAmount = Math.floor(room.pot / winners.length);
    for (const w of winners) {
      const winnerPlayer = playerHands.find(p => p.solverHand === w)?.player;
      if (winnerPlayer) winnerPlayer.chips += winAmount;
    }
  
    room.phase = 'showdown'; // 用于前端判断是否是结算阶段
}

function getGameState(room) {
  return games[room];
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
  const roomGame = games[room];
  if (!roomGame.players.some(p => p.name === playerName)) {
    roomGame.players.push({
      name: playerName,
      chips: 1000,
    });
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
  
module.exports = {
  games,
  startGame,
  handlePlayerAction,
  getGameState,
  createRoom,
  joinRoom,
  broadcastGameState
};
