const suits = ['♠', '♥', '♦', '♣'];
const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

function createDeck() {
  const deck = [];
  for (let suit of suits) {
    for (let rank of ranks) {
      deck.push(rank + suit);
    }
  }
  // 洗牌
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function createRoomIfNotExists(rooms, roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      players: [],
      communityCards: [],
      deck: [],
      pot: 0,
      currentPlayerIndex: 0,
      phase: 'waiting',
    };
  }
}

function getRoomState(room, currentPlayerId) {
  return {
    players: room.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      chips: p.chips,
      hand: p.id === currentPlayerId ? p.hand : [],  // 只给自己显示手牌
      folded: p.folded,
      isTurn: p.id === room.players[room.currentPlayerIndex]?.id

    })),
    communityCards: room.communityCards,
    pot: room.pot,
    phase: room.phase,
  };
}

function startGame(room) {
  room.deck = createDeck();
  room.communityCards = [];
  room.pot = 0;
  room.phase = 'preflop';
  room.currentPlayerIndex = 0;
  room.actionsInRound = new Set(); // 记录本轮已行动玩家

  room.players.forEach(p => {
    p.hand = [room.deck.pop(), room.deck.pop()];
    p.folded = false;
  });

  // 确保 currentPlayerIndex 指向第一个未弃牌玩家
  room.currentPlayerIndex = room.players.findIndex(p => !p.folded);
}

function nextPhase(room) {
  switch (room.phase) {
    case 'preflop':
      room.phase = 'flop';
      room.communityCards = [room.deck.pop(), room.deck.pop(), room.deck.pop()];
      break;
    case 'flop':
      room.phase = 'turn';
      room.communityCards.push(room.deck.pop());
      break;
    case 'turn':
      room.phase = 'river';
      room.communityCards.push(room.deck.pop());
      break;
    case 'river':
      room.phase = 'showdown';
      settleGame(room); // 结算
      break;
    default:
      break;
  }
  // 重置行动到第一位活跃玩家
  room.currentPlayerIndex = room.players.findIndex(p => !p.folded);
}

function handlePlayerAction(room, playerId, action) {
  if (room.phase === 'end' || room.phase === 'showdown') return;
  const player = room.players.find(p => p.id === playerId);
  if (!player || player.folded) return;

  switch (action) {
    case 'fold':
      player.folded = true;
      break;
    case 'call':
      room.pot += 10;
      player.chips -= 10;
      break;
    case 'raise':
      room.pot += 20;
      player.chips -= 20;
      break;
  }

  room.actionsInRound.add(playerId);  // 记录玩家已行动

  const activePlayers = room.players.filter(p => !p.folded);

  if (activePlayers.length <= 1) {
    settleGame(room); // 结算   
    room.phase = 'end';
    return;
  }

  // 判断本轮所有未弃牌玩家是否都已行动
  const allActed = activePlayers.every(p => room.actionsInRound.has(p.id));

  if (allActed) {
    room.actionsInRound.clear();
    nextPhase(room);
  } else {
    // 继续下一位玩家行动
    do {
      room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    } while (room.players[room.currentPlayerIndex].folded);
  }
}

function settleGame(room) {
    const activePlayers = room.players.filter(p => !p.folded);
  
    // 没有活跃玩家？异常情况
    if (activePlayers.length === 0) {
      console.warn('无玩家参与结算');
      room.phase = 'end';
      return;
    }
  
    // 仅剩一人，直接获胜
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      winner.chips += room.pot;
      console.log(`仅剩一人 ${winner.name} 获胜，获得 ${room.pot} 筹码`);
      room.pot = 0;
      room.phase = 'end';
      return;
    }
  
    // 简化：比最大牌点数
    function cardRank(card) {
      const rankOrder = '23456789TJQKA';
      return rankOrder.indexOf(card[0]);
    }
  
    let winner = null;
    let bestRank = -1;
  
    for (const player of activePlayers) {
      const allCards = [...player.hand, ...room.communityCards];
      const playerBestRank = Math.max(...allCards.map(cardRank));
      if (playerBestRank > bestRank) {
        bestRank = playerBestRank;
        winner = player;
      }
    }
  
    if (winner) {
      winner.chips += room.pot;
      console.log(`${winner.name} 获胜，获得 ${room.pot} 筹码`);
      room.pot = 0;
    } else {
      console.warn('无人获胜？可能有bug');
    }
  
    room.phase = 'end';
  }
  

function emitRoomUpdate(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  room.players.forEach(player => {
    io.to(player.id).emit('roomUpdate', getRoomState(room, player.id));
  });
}

module.exports = {
  createRoomIfNotExists,
  getRoomState,
  startGame,
  handlePlayerAction,
  nextPhase,
  settleGame,
  emitRoomUpdate,
};
