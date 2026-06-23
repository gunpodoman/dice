const DICE_META = {
  fire: { key: 'fire', name: '화염', short: '화', color: '#ff7f7a', damage: 15, attackMs: 850 },
  ice: { key: 'ice', name: '빙결', short: '빙', color: '#7fc5ff', damage: 7, attackMs: 920, slow: 0.55, slowMs: 1500 },
  blast: { key: 'blast', name: '폭발', short: '폭', color: '#ffd06c', damage: 10, attackMs: 1150, splashRadius: 0.09, splashRatio: 0.55 },
  poison: { key: 'poison', name: '맹독', short: '독', color: '#baf45b', damage: 5, attackMs: 980, poisonDps: 6, poisonMs: 2600 },
  rapid: { key: 'rapid', name: '속사', short: '속', color: '#a88aff', damage: 4, attackMs: 360 }
};

const DICE_TYPES = Object.keys(DICE_META);
const BOARD_SIZE = 15;
const BOARD_COLS = 5;
const MAX_PIP = 7;
const WAVE_DURATION_MS = 66000;
const STORAGE_KEY = 'dice-frontline-solo-records-v3';

const menuScreen = document.getElementById('menuScreen');
const gameScreen = document.getElementById('gameScreen');
const soloModeButton = document.getElementById('soloModeButton');
const onlineModeButton = document.getElementById('onlineModeButton');
const waveValue = document.getElementById('waveValue');
const timerValue = document.getElementById('timerValue');
const heartValue = document.getElementById('heartValue');
const spValue = document.getElementById('spValue');
const killValue = document.getElementById('killValue');
const scoreValue = document.getElementById('scoreValue');
const playerNameLabel = document.getElementById('playerNameLabel');
const fieldWaveLabel = document.getElementById('fieldWaveLabel');
const enemyCountLabel = document.getElementById('enemyCountLabel');
const summonButton = document.getElementById('summonButton');
const summonCostValue = document.getElementById('summonCostValue');
const upgradeList = document.getElementById('upgradeList');
const pauseButton = document.getElementById('pauseButton');
const exitButton = document.getElementById('exitButton');
const pauseOverlay = document.getElementById('pauseOverlay');
const resumeButton = document.getElementById('resumeButton');
const pauseExitButton = document.getElementById('pauseExitButton');
const resultOverlay = document.getElementById('resultOverlay');
const retryButton = document.getElementById('retryButton');
const resultMenuButton = document.getElementById('resultMenuButton');
const resultSummary = document.getElementById('resultSummary');
const resultWave = document.getElementById('resultWave');
const resultKills = document.getElementById('resultKills');
const resultScore = document.getElementById('resultScore');
const diceBoard = document.getElementById('diceBoard');
const toast = document.getElementById('toast');
const dragGhost = document.getElementById('dragGhost');
const mergeHint = document.getElementById('mergeHint');
const floatingTextLayer = document.getElementById('floatingTextLayer');

const laneCanvas = document.getElementById('laneCanvas');
const laneCtx = laneCanvas.getContext('2d');
const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

const pathPoints = [
  { x: 62, y: 60 },
  { x: 858, y: 60 },
  { x: 858, y: 192 },
  { x: 62, y: 192 }
];

const pathSegments = [];
let totalPathLength = 0;
for (let i = 0; i < pathPoints.length - 1; i += 1) {
  const a = pathPoints[i];
  const b = pathPoints[i + 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  totalPathLength += len;
  pathSegments.push({ a, b, len, acc: totalPathLength });
}

const records = loadRecords();
let app = {
  screen: 'menu',
  running: false,
  paused: false,
  gameOver: false,
  playerName: '플레이어',
  wave: 1,
  waveStartedAt: 0,
  nextSpawnAt: 0,
  spawnInterval: 1450,
  enemies: [],
  board: Array(BOARD_SIZE).fill(null),
  sp: 100,
  summonCost: 10,
  hearts: 3,
  kills: 0,
  score: 0,
  upgrades: Object.fromEntries(DICE_TYPES.map((type) => [type, 1])),
  attackBursts: [],
  particles: [],
  lastFrame: 0,
  tapSelectedIndex: null,
  enemySerial: 0,
  diceSerial: 0,
  bossSpawnedThisWave: false,
  enemiesSpawnedThisWave: 0,
  maxEnemiesThisWave: 10,
  lastTickTime: 0,
  floatingNumbers: []
};

let dragState = null;
let toastTimer = null;
let animationFrameId = 0;

function loadRecords() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      bestWave: Number(parsed.bestWave) || 0,
      bestKills: Number(parsed.bestKills) || 0,
      bestScore: Number(parsed.bestScore) || 0
    };
  } catch {
    return { bestWave: 0, bestKills: 0, bestScore: 0 };
  }
}

function saveRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function showScreen(name) {
  app.screen = name;
  menuScreen.classList.toggle('active', name === 'menu');
  gameScreen.classList.toggle('active', name === 'game');
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1500);
}

function formatTime(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  const remainder = String(seconds % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function randItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function nextEnemyId() {
  app.enemySerial += 1;
  return `enemy_${app.enemySerial}`;
}

function nextDiceId() {
  app.diceSerial += 1;
  return `dice_${app.diceSerial}`;
}

function createDie(type = randItem(DICE_TYPES), pip = 1) {
  return {
    id: nextDiceId(),
    type,
    pip,
    nextAttackAt: performance.now() + 250
  };
}

function getWaveConfig(wave) {
  return {
    hpBase: 32 * Math.pow(1.24, wave - 1),
    speed: 0.060 + wave * 0.0032,
    count: 9 + Math.floor(wave * 1.3),
    spawnInterval: Math.max(470, 1350 - wave * 55),
    boss: wave % 5 === 0
  };
}

function resetGame() {
  app.running = true;
  app.paused = false;
  app.gameOver = false;
  app.wave = 1;
  app.waveStartedAt = performance.now();
  app.nextSpawnAt = app.waveStartedAt + 700;
  app.enemies = [];
  app.board = Array(BOARD_SIZE).fill(null);
  app.sp = 100;
  app.summonCost = 10;
  app.hearts = 3;
  app.kills = 0;
  app.score = 0;
  app.upgrades = Object.fromEntries(DICE_TYPES.map((type) => [type, 1]));
  app.attackBursts = [];
  app.particles = [];
  app.tapSelectedIndex = null;
  app.enemySerial = 0;
  app.diceSerial = 0;
  app.bossSpawnedThisWave = false;
  app.lastFrame = performance.now();
  app.lastTickTime = app.lastFrame;
  app.floatingNumbers = [];
  const config = getWaveConfig(app.wave);
  app.spawnInterval = config.spawnInterval;
  app.maxEnemiesThisWave = config.count;
  app.enemiesSpawnedThisWave = 0;
  resultOverlay.classList.add('hidden');
  pauseOverlay.classList.add('hidden');
  renderBoard();
  renderUpgrades();
  updateUi();
}

function startSoloGame() {
  app.playerName = '플레이어';
  playerNameLabel.textContent = app.playerName;
  resetGame();
  showScreen('game');
}

function endGame() {
  app.running = false;
  app.gameOver = true;
  app.paused = false;
  pauseOverlay.classList.add('hidden');
  resultSummary.textContent = `웨이브 ${app.wave}에서 방어에 실패했습니다.`;
  resultWave.textContent = String(app.wave);
  resultKills.textContent = String(app.kills);
  resultScore.textContent = String(app.score);
  resultOverlay.classList.remove('hidden');

  records.bestWave = Math.max(records.bestWave, app.wave);
  records.bestKills = Math.max(records.bestKills, app.kills);
  records.bestScore = Math.max(records.bestScore, app.score);
  saveRecords();
}

function updateUi() {
  waveValue.textContent = String(app.wave);
  fieldWaveLabel.textContent = `웨이브 ${app.wave}`;
  heartValue.textContent = String(app.hearts);
  spValue.textContent = String(Math.floor(app.sp));
  killValue.textContent = String(app.kills);
  scoreValue.textContent = String(app.score);
  summonCostValue.textContent = `${app.summonCost} SP`;
  enemyCountLabel.textContent = `${app.enemies.length} enemies`;
  const elapsed = app.paused ? app.lastTickTime - app.waveStartedAt : performance.now() - app.waveStartedAt;
  timerValue.textContent = formatTime(Math.max(0, WAVE_DURATION_MS - elapsed));
  summonButton.disabled = app.sp < app.summonCost || !app.board.includes(null) || !app.running || app.paused;
  syncUpgradeButtons();
}

function renderBoard() {
  diceBoard.innerHTML = '';
  app.board.forEach((die, index) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = `dice-cell${die ? '' : ' empty'}`;
    cell.dataset.index = String(index);

    if (app.tapSelectedIndex === index) cell.classList.add('tap-selected');
    if (dragState && dragState.sourceIndex === index) {
      cell.classList.add('source-highlight');
      cell.classList.add('drag-hidden');
    }

    if (die) {
      cell.appendChild(createDiceElement(die));
    }

    diceBoard.appendChild(cell);
  });
}

function createDiceElement(die) {
  const meta = DICE_META[die.type];
  const wrapper = document.createElement('div');
  wrapper.className = 'dice';
  wrapper.dataset.type = die.type;
  wrapper.dataset.diceId = die.id;

  const badge = document.createElement('div');
  badge.className = 'dice-name-badge';
  badge.textContent = meta.short;
  wrapper.appendChild(badge);

  const pipLayer = document.createElement('div');
  pipLayer.className = 'pip-layer';
  const positions = getPipPositions(die.pip);
  positions.forEach(({ x, y }) => {
    const pip = document.createElement('div');
    pip.className = 'pip';
    pip.style.left = `${x}%`;
    pip.style.top = `${y}%`;
    pipLayer.appendChild(pip);
  });
  wrapper.appendChild(pipLayer);

  const level = document.createElement('div');
  level.className = 'pip-level';
  level.textContent = `Lv.${die.pip}`;
  wrapper.appendChild(level);
  return wrapper;
}

function getPipPositions(pip) {
  if (pip >= 7) {
    return [
      { x: 50, y: 50 }, { x: 28, y: 28 }, { x: 72, y: 28 },
      { x: 28, y: 72 }, { x: 72, y: 72 }, { x: 28, y: 50 }, { x: 72, y: 50 }
    ];
  }
  const map = {
    1: [{ x: 50, y: 50 }],
    2: [{ x: 34, y: 34 }, { x: 66, y: 66 }],
    3: [{ x: 34, y: 34 }, { x: 50, y: 50 }, { x: 66, y: 66 }],
    4: [{ x: 34, y: 34 }, { x: 66, y: 34 }, { x: 34, y: 66 }, { x: 66, y: 66 }],
    5: [{ x: 34, y: 34 }, { x: 66, y: 34 }, { x: 50, y: 50 }, { x: 34, y: 66 }, { x: 66, y: 66 }],
    6: [{ x: 34, y: 30 }, { x: 66, y: 30 }, { x: 34, y: 50 }, { x: 66, y: 50 }, { x: 34, y: 70 }, { x: 66, y: 70 }]
  };
  return map[pip] || map[1];
}

function renderUpgrades() {
  DICE_TYPES.forEach((type) => {
    const meta = DICE_META[type];
    let button = upgradeList.querySelector(`[data-type=\"${type}\"]`);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'upgrade-button';
      button.dataset.type = type;
      button.innerHTML = `
        <span class="upgrade-icon" style="--icon-color:${meta.color}">${meta.short}</span>
        <span class="upgrade-main">
          <strong></strong>
          <span></span>
        </span>
        <span class="upgrade-price"></span>
      `;
      button.addEventListener('click', () => upgradeDie(type));
      upgradeList.appendChild(button);
    }
  });
  syncUpgradeButtons();
}

function syncUpgradeButtons() {
  upgradeList.querySelectorAll('.upgrade-button').forEach((button) => {
    const type = button.dataset.type;
    const meta = DICE_META[type];
    const level = app.upgrades[type];
    const cost = level >= 5 ? null : level * 50;
    button.disabled = !app.running || app.paused || level >= 5 || app.sp < cost;
    button.querySelector('.upgrade-main strong').textContent = meta.name;
    button.querySelector('.upgrade-main span').textContent = `Lv.${level}`;
    button.querySelector('.upgrade-price').textContent = cost ? `${cost} SP` : '최대';
  });
}

function summonDie() {
  if (!app.running || app.paused) return;
  const emptyIndex = app.board.findIndex((cell) => cell === null);
  if (emptyIndex === -1) return showToast('빈 칸이 없습니다.');
  if (app.sp < app.summonCost) return showToast('SP가 부족합니다.');
  app.sp -= app.summonCost;
  app.board[emptyIndex] = createDie();
  app.summonCost = Math.min(200, app.summonCost + 5);
  addBoardPulse(emptyIndex);
  renderBoard();
  renderUpgrades();
  updateUi();
}

function addBoardPulse(index) {
  const cell = diceBoard.querySelector(`[data-index="${index}"]`);
  if (!cell) return;
  cell.animate([
    { transform: 'scale(0.86)' },
    { transform: 'scale(1.05)' },
    { transform: 'scale(1)' }
  ], { duration: 240, easing: 'ease-out' });
}

function upgradeDie(type) {
  if (!app.running || app.paused) return;
  const level = app.upgrades[type];
  if (level >= 5) return showToast('이미 최대 강화입니다.');
  const cost = level * 50;
  if (app.sp < cost) return showToast('SP가 부족합니다.');
  app.sp -= cost;
  app.upgrades[type] += 1;
  renderUpgrades();
  updateUi();
}

function canMerge(fromIndex, toIndex) {
  const a = app.board[fromIndex];
  const b = app.board[toIndex];
  return Boolean(a && b && a.type === b.type && a.pip === b.pip && a.pip < MAX_PIP);
}

function performMerge(fromIndex, toIndex) {
  if (!canMerge(fromIndex, toIndex)) return false;
  const source = app.board[fromIndex];
  app.board[fromIndex] = null;
  app.board[toIndex] = createDie(randItem(DICE_TYPES), source.pip + 1);
  app.tapSelectedIndex = null;
  renderBoard();
  addBoardPulse(toIndex);
  return true;
}

function beginDrag(cell, event) {
  if (!app.running || app.paused) return;
  const index = Number(cell.dataset.index);
  const die = app.board[index];
  if (!die) return;

  const rect = cell.getBoundingClientRect();
  dragState = {
    sourceIndex: index,
    die,
    pointerId: event.pointerId,
    moved: false,
    startX: event.clientX,
    startY: event.clientY,
    currentTargetIndex: null
  };

  const ghost = createDiceElement(die);
  dragGhost.innerHTML = '';
  dragGhost.appendChild(ghost);
  dragGhost.classList.remove('hidden');
  updateGhostPosition(event.clientX, event.clientY);

  cell.classList.add('drag-hidden');
  renderBoard();
  window.addEventListener('pointermove', onGlobalPointerMove);
  window.addEventListener('pointerup', onGlobalPointerUp, { once: false });
}

function updateGhostPosition(x, y) {
  dragGhost.style.left = `${x}px`;
  dragGhost.style.top = `${y}px`;
}

function clearMergeReady() {
  diceBoard.querySelectorAll('.merge-ready').forEach((el) => el.classList.remove('merge-ready'));
}

function onGlobalPointerMove(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  dragState.moved = dragState.moved || Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) > 5;
  updateGhostPosition(event.clientX, event.clientY);

  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.dice-cell');
  clearMergeReady();
  dragState.currentTargetIndex = null;
  if (target) {
    const targetIndex = Number(target.dataset.index);
    if (canMerge(dragState.sourceIndex, targetIndex)) {
      target.classList.add('merge-ready');
      dragState.currentTargetIndex = targetIndex;
      mergeHint.textContent = '놓으면 합성됩니다';
    } else {
      mergeHint.textContent = '같은 종류와 같은 눈금만 합성됩니다';
    }
  } else {
    mergeHint.textContent = '같은 주사위를 드래그해서 합성하세요';
  }
}

function endDrag(event) {
  if (!dragState) return;
  const sourceIndex = dragState.sourceIndex;
  const wasMoved = dragState.moved;
  const targetIndex = dragState.currentTargetIndex;
  dragGhost.classList.add('hidden');
  dragGhost.innerHTML = '';
  clearMergeReady();
  mergeHint.textContent = '같은 주사위를 드래그해서 합성하세요';
  window.removeEventListener('pointermove', onGlobalPointerMove);
  window.removeEventListener('pointerup', onGlobalPointerUp);

  if (wasMoved && Number.isInteger(targetIndex) && canMerge(sourceIndex, targetIndex)) {
    performMerge(sourceIndex, targetIndex);
  } else if (!wasMoved) {
    if (app.tapSelectedIndex === null) {
      app.tapSelectedIndex = sourceIndex;
    } else if (app.tapSelectedIndex === sourceIndex) {
      app.tapSelectedIndex = null;
    } else if (canMerge(app.tapSelectedIndex, sourceIndex)) {
      performMerge(app.tapSelectedIndex, sourceIndex);
    } else {
      app.tapSelectedIndex = sourceIndex;
      showToast('같은 주사위를 선택해 합성할 수 있습니다.');
    }
    renderBoard();
  } else if (wasMoved && targetIndex === null) {
    renderBoard();
  } else {
    renderBoard();
  }

  dragState = null;
}

function onGlobalPointerUp(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  endDrag(event);
}

function getPathPoint(progress) {
  const distance = Math.max(0, Math.min(1, progress)) * totalPathLength;
  let prevAcc = 0;
  for (const seg of pathSegments) {
    if (distance <= seg.acc) {
      const local = (distance - prevAcc) / seg.len;
      return {
        x: seg.a.x + (seg.b.x - seg.a.x) * local,
        y: seg.a.y + (seg.b.y - seg.a.y) * local
      };
    }
    prevAcc = seg.acc;
  }
  return { ...pathPoints[pathPoints.length - 1] };
}

function spawnEnemy(isBoss = false) {
  const cfg = getWaveConfig(app.wave);
  const hp = cfg.hpBase * (isBoss ? 14 : 1) * (0.86 + Math.random() * 0.28);
  const speed = cfg.speed * (isBoss ? 0.65 : 1);
  app.enemies.push({
    id: nextEnemyId(),
    progress: 0,
    hp,
    maxHp: hp,
    speed,
    isBoss,
    slowUntil: 0,
    slowFactor: 1,
    poisonUntil: 0,
    poisonDps: 0
  });
}

function spawnWaveEnemies(now) {
  const cfg = getWaveConfig(app.wave);
  app.spawnInterval = cfg.spawnInterval;
  app.maxEnemiesThisWave = cfg.count;
  if (cfg.boss && !app.bossSpawnedThisWave) {
    spawnEnemy(true);
    app.bossSpawnedThisWave = true;
  }

  while (app.enemiesSpawnedThisWave < app.maxEnemiesThisWave && now >= app.nextSpawnAt) {
    spawnEnemy(false);
    app.enemiesSpawnedThisWave += 1;
    app.nextSpawnAt += app.spawnInterval;
  }
}

function advanceWave(now) {
  const elapsed = now - app.waveStartedAt;
  if (elapsed < WAVE_DURATION_MS) return;
  app.wave += 1;
  app.waveStartedAt = now;
  app.nextSpawnAt = now + 700;
  app.bossSpawnedThisWave = false;
  app.enemiesSpawnedThisWave = 0;
}

function applyAttack(die, enemy, now, boardIndex) {
  const meta = DICE_META[die.type];
  const upgrade = app.upgrades[die.type];
  const damage = meta.damage * die.pip * (1 + (upgrade - 1) * 0.34);
  enemy.hp -= damage;
  spawnFloatingNumber(enemy, Math.round(damage));
  const enemyPos = getPathPoint(enemy.progress);
  app.attackBursts.push({
    x: enemyPos.x,
    y: enemyPos.y,
    color: meta.color,
    life: 180,
    maxLife: 180
  });

  if (meta.slow) {
    enemy.slowFactor = Math.min(enemy.slowFactor, meta.slow);
    enemy.slowUntil = Math.max(enemy.slowUntil, now + meta.slowMs + die.pip * 80);
  }

  if (meta.poisonDps) {
    enemy.poisonDps = Math.max(enemy.poisonDps, meta.poisonDps * die.pip);
    enemy.poisonUntil = Math.max(enemy.poisonUntil, now + meta.poisonMs);
  }

  if (meta.splashRadius) {
    app.enemies.forEach((other) => {
      if (other.id === enemy.id) return;
      if (Math.abs(other.progress - enemy.progress) <= meta.splashRadius) {
        const splash = damage * meta.splashRatio;
        other.hp -= splash;
        spawnFloatingNumber(other, Math.round(splash));
      }
    });
  }

  const attackRate = meta.attackMs / (1 + (upgrade - 1) * 0.12) / (1 + (die.pip - 1) * 0.08);
  die.nextAttackAt = now + attackRate;
}

function spawnFloatingNumber(enemy, damage) {
  const point = getPathPoint(enemy.progress);
  const scaleX = laneCanvas.getBoundingClientRect().width / laneCanvas.width;
  const scaleY = laneCanvas.getBoundingClientRect().height / laneCanvas.height;
  const layerRect = floatingTextLayer.getBoundingClientRect();
  const canvasRect = laneCanvas.getBoundingClientRect();
  const x = point.x * scaleX + (canvasRect.left - layerRect.left);
  const y = point.y * scaleY + (canvasRect.top - layerRect.top) - 10;
  const text = document.createElement('div');
  text.className = 'floating-number';
  text.style.left = `${x}px`;
  text.style.top = `${y}px`;
  text.textContent = String(damage);
  floatingTextLayer.appendChild(text);
  setTimeout(() => text.remove(), 700);
}

function updateDiceCombat(now) {
  if (!app.enemies.length) return;
  for (let i = 0; i < app.board.length; i += 1) {
    const die = app.board[i];
    if (!die || now < die.nextAttackAt) continue;
    const target = app.enemies.reduce((best, enemy) => (!best || enemy.progress > best.progress ? enemy : best), null);
    if (target) applyAttack(die, target, now, i);
  }
}

function rewardEnemy(enemy) {
  const reward = enemy.isBoss ? 55 + app.wave * 4 : 4 + Math.floor(app.wave / 2);
  app.sp = Math.min(9999, app.sp + reward);
  app.kills += 1;
  app.score += Math.round(enemy.maxHp);
}

function updateEnemies(now, dt) {
  const survivors = [];
  for (const enemy of app.enemies) {
    if (enemy.poisonUntil > now) enemy.hp -= enemy.poisonDps * dt;
    else enemy.poisonDps = 0;

    if (enemy.slowUntil <= now) enemy.slowFactor = 1;

    enemy.progress += enemy.speed * enemy.slowFactor * dt;
    if (enemy.hp <= 0) {
      rewardEnemy(enemy);
      continue;
    }
    if (enemy.progress >= 1) {
      app.hearts -= enemy.isBoss ? 2 : 1;
      if (app.hearts <= 0) {
        app.hearts = 0;
      }
      continue;
    }
    survivors.push(enemy);
  }
  app.enemies = survivors;
}

function updateBursts(dtMs) {
  app.attackBursts = app.attackBursts
    .map((burst) => ({ ...burst, life: burst.life - dtMs }))
    .filter((burst) => burst.life > 0);
}

function gameLoop(now) {
  animationFrameId = requestAnimationFrame(gameLoop);

  if (app.screen !== 'game') {
    drawLane();
    return;
  }

  const dtMs = Math.min(34, now - app.lastFrame || 16);
  app.lastFrame = now;
  const dt = dtMs / 1000;

  if (app.running && !app.paused) {
    advanceWave(now);
    spawnWaveEnemies(now);
    updateDiceCombat(now);
    updateEnemies(now, dt);
    updateBursts(dtMs);
    app.lastTickTime = now;

    if (app.hearts <= 0) {
      endGame();
    }
  }

  updateUi();
  drawLane();
}

function drawLane() {
  laneCtx.setTransform(1, 0, 0, 1, 0, 0);
  laneCtx.clearRect(0, 0, laneCanvas.width, laneCanvas.height);

  laneCtx.fillStyle = '#edf2f8';
  laneCtx.fillRect(0, 0, laneCanvas.width, laneCanvas.height);

  laneCtx.save();
  laneCtx.lineCap = 'round';
  laneCtx.lineJoin = 'round';
  laneCtx.lineWidth = 68;
  laneCtx.strokeStyle = '#0d1322';
  laneCtx.beginPath();
  laneCtx.moveTo(pathPoints[0].x, pathPoints[0].y);
  for (let i = 1; i < pathPoints.length; i += 1) laneCtx.lineTo(pathPoints[i].x, pathPoints[i].y);
  laneCtx.stroke();

  laneCtx.lineWidth = 56;
  const trackGrad = laneCtx.createLinearGradient(70, 40, 860, 220);
  trackGrad.addColorStop(0, '#99d6ea');
  trackGrad.addColorStop(0.46, '#a7b5cf');
  trackGrad.addColorStop(0.82, '#d1a4be');
  laneCtx.strokeStyle = trackGrad;
  laneCtx.beginPath();
  laneCtx.moveTo(pathPoints[0].x, pathPoints[0].y);
  for (let i = 1; i < pathPoints.length; i += 1) laneCtx.lineTo(pathPoints[i].x, pathPoints[i].y);
  laneCtx.stroke();

  laneCtx.lineWidth = 3;
  laneCtx.setLineDash([14, 16]);
  laneCtx.strokeStyle = 'rgba(255,255,255,0.36)';
  laneCtx.beginPath();
  laneCtx.moveTo(pathPoints[0].x + 14, pathPoints[0].y);
  for (let i = 1; i < pathPoints.length; i += 1) laneCtx.lineTo(pathPoints[i].x, pathPoints[i].y);
  laneCtx.stroke();
  laneCtx.restore();

  drawEndpointBadge(pathPoints[0].x, pathPoints[0].y, 52, 36, '#7fe9bd', 'START');
  drawEndpointBadge(pathPoints[pathPoints.length - 1].x, pathPoints[pathPoints.length - 1].y, 52, 36, '#ffb2be', 'GOAL');

  laneCtx.fillStyle = 'rgba(100, 225, 175, 0.8)';
  for (let i = 0; i < 10; i += 1) {
    const t = performance.now() * 0.004 + i;
    laneCtx.beginPath();
    laneCtx.arc(pathPoints[0].x + Math.sin(t) * 14, pathPoints[0].y + Math.cos(t * 1.3) * 14, 3 + (i % 3), 0, Math.PI * 2);
    laneCtx.fill();
  }

  app.enemies.forEach(drawEnemy);
  app.attackBursts.forEach(drawBurst);
}

function drawEndpointBadge(x, y, width, height, color, label) {
  laneCtx.save();
  roundRect(laneCtx, x - width / 2, y - height / 2, width, height, 16);
  laneCtx.fillStyle = 'rgba(255,255,255,0.25)';
  laneCtx.fill();
  laneCtx.strokeStyle = color;
  laneCtx.lineWidth = 2;
  laneCtx.stroke();
  laneCtx.fillStyle = label === 'START' ? '#ffffff' : '#ffeef2';
  laneCtx.font = 'bold 14px Segoe UI';
  laneCtx.textAlign = 'center';
  laneCtx.textBaseline = 'middle';
  laneCtx.fillText(label, x, y + 1);
  laneCtx.restore();
}

function drawEnemy(enemy) {
  const point = getPathPoint(enemy.progress);
  const radius = enemy.isBoss ? 19 : 11;
  laneCtx.save();
  laneCtx.shadowColor = enemy.isBoss ? '#ff6d86' : enemy.poisonUntil > performance.now() ? '#8cf179' : '#4d5972';
  laneCtx.shadowBlur = enemy.isBoss ? 18 : 10;
  const grd = laneCtx.createRadialGradient(point.x - radius * 0.3, point.y - radius * 0.3, 2, point.x, point.y, radius);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(1, enemy.isBoss ? '#d74a6b' : enemy.slowUntil > performance.now() ? '#5db7f2' : '#5f6d87');
  laneCtx.fillStyle = grd;
  laneCtx.beginPath();
  laneCtx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  laneCtx.fill();
  laneCtx.restore();

  const hpRatio = Math.max(0, enemy.hp / enemy.maxHp);
  const barWidth = enemy.isBoss ? 60 : 34;
  roundRect(laneCtx, point.x - barWidth / 2, point.y - radius - 16, barWidth, 6, 3);
  laneCtx.fillStyle = 'rgba(32,40,60,0.5)';
  laneCtx.fill();
  roundRect(laneCtx, point.x - barWidth / 2, point.y - radius - 16, barWidth * hpRatio, 6, 3);
  laneCtx.fillStyle = enemy.isBoss ? '#ff7e98' : '#6bebb8';
  laneCtx.fill();

  if (enemy.isBoss) {
    laneCtx.fillStyle = '#33111b';
    laneCtx.font = '900 9px Segoe UI';
    laneCtx.textAlign = 'center';
    laneCtx.textBaseline = 'middle';
    laneCtx.fillText('BOSS', point.x, point.y + 1);
  }
}

function drawBurst(burst) {
  const alpha = burst.life / burst.maxLife;
  laneCtx.save();
  laneCtx.globalAlpha = alpha;
  laneCtx.strokeStyle = burst.color;
  laneCtx.lineWidth = 4;
  laneCtx.beginPath();
  laneCtx.arc(burst.x, burst.y, (1 - alpha) * 18 + 6, 0, Math.PI * 2);
  laneCtx.stroke();
  laneCtx.restore();
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function goToMenu() {
  app.running = false;
  app.paused = false;
  app.gameOver = false;
  pauseOverlay.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  showScreen('menu');
}

soloModeButton.addEventListener('click', startSoloGame);
onlineModeButton.addEventListener('click', () => showToast('온라인 대전은 Firebase 연동 후 추가할 예정입니다.'));
summonButton.addEventListener('click', summonDie);
pauseButton.addEventListener('click', () => {
  if (!app.running || app.gameOver) return;
  app.paused = true;
  pauseOverlay.classList.remove('hidden');
  updateUi();
});
resumeButton.addEventListener('click', () => {
  if (!app.running) return;
  app.paused = false;
  app.lastFrame = performance.now();
  app.lastTickTime = app.lastFrame;
  pauseOverlay.classList.add('hidden');
  updateUi();
});
retryButton.addEventListener('click', startSoloGame);
exitButton.addEventListener('click', goToMenu);
pauseExitButton.addEventListener('click', goToMenu);
resultMenuButton.addEventListener('click', goToMenu);

diceBoard.addEventListener('pointerdown', (event) => {
  const cell = event.target.closest('.dice-cell');
  if (!cell) return;
  event.preventDefault();
  beginDrag(cell, event);
});

window.addEventListener('resize', drawLane);
window.addEventListener('keydown', (event) => {
  if (app.screen !== 'game') return;
  if (event.code === 'Space') {
    event.preventDefault();
    if (!app.running || app.gameOver) return;
    if (app.paused) resumeButton.click();
    else pauseButton.click();
  }
  if (event.key.toLowerCase() === 's') summonDie();
});

renderBoard();
renderUpgrades();
updateUi();
drawLane();
showScreen('menu');
animationFrameId = requestAnimationFrame(gameLoop);
