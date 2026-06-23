"use strict";

const CONFIG = Object.freeze({
  boardSize: 15,
  maxPip: 7,
  maxLevel: 5,
  waveSeconds: 30,
  startingHearts: 3,
  startingSp: 100,
  startingSummonCost: 10,
  summonCostStep: 5,
  maxEnemies: 120
});

const DICE = Object.freeze({
  ember: {
    name: "화염",
    short: "화",
    description: "높은 단일 피해",
    color: "#ff776d",
    accent: "#ffc2ad",
    damage: 8.4,
    interval: 0.88
  },
  frost: {
    name: "빙결",
    short: "빙",
    description: "이동 속도 감소",
    color: "#62baff",
    accent: "#caecff",
    damage: 3.7,
    interval: 1.04,
    slowFactor: 0.58,
    slowDuration: 1.65
  },
  blast: {
    name: "폭발",
    short: "폭",
    description: "주변 범위 피해",
    color: "#ffb34f",
    accent: "#ffe0a7",
    damage: 5.5,
    interval: 1.3,
    splashRadius: 0.065,
    splashRatio: 0.68
  },
  venom: {
    name: "맹독",
    short: "독",
    description: "지속 독 피해",
    color: "#70d979",
    accent: "#cbffca",
    damage: 2.7,
    interval: 1.02,
    poisonDps: 3.5,
    poisonDuration: 3
  },
  rapid: {
    name: "속사",
    short: "속",
    description: "매우 빠른 공격",
    color: "#aa82ff",
    accent: "#e7d9ff",
    damage: 2.25,
    interval: 0.31
  }
});

const DICE_TYPES = Object.keys(DICE);
const STORAGE_KEY = "dice-frontline-solo-record-v1";

const elements = {
  lobbyScreen: document.getElementById("lobbyScreen"),
  gameScreen: document.getElementById("gameScreen"),
  nicknameInput: document.getElementById("nicknameInput"),
  startSoloButton: document.getElementById("startSoloButton"),
  lobbyBestWave: document.getElementById("lobbyBestWave"),
  lobbyBestKills: document.getElementById("lobbyBestKills"),
  lobbyBestScore: document.getElementById("lobbyBestScore"),
  waveText: document.getElementById("waveText"),
  waveTimer: document.getElementById("waveTimer"),
  heartText: document.getElementById("heartText"),
  spText: document.getElementById("spText"),
  killText: document.getElementById("killText"),
  scoreText: document.getElementById("scoreText"),
  pauseButton: document.getElementById("pauseButton"),
  exitButton: document.getElementById("exitButton"),
  pauseOverlay: document.getElementById("pauseOverlay"),
  resumeButton: document.getElementById("resumeButton"),
  resultOverlay: document.getElementById("resultOverlay"),
  resultSummary: document.getElementById("resultSummary"),
  resultWave: document.getElementById("resultWave"),
  resultKills: document.getElementById("resultKills"),
  resultScore: document.getElementById("resultScore"),
  retryButton: document.getElementById("retryButton"),
  resultLobbyButton: document.getElementById("resultLobbyButton"),
  summonButton: document.getElementById("summonButton"),
  summonCostText: document.getElementById("summonCostText"),
  upgradeList: document.getElementById("upgradeList"),
  toast: document.getElementById("toast"),
  canvas: document.getElementById("gameCanvas")
};

const ctx = elements.canvas.getContext("2d");
const pathPoints = [
  { x: 75, y: 150 },
  { x: 925, y: 150 },
  { x: 925, y: 315 },
  { x: 75, y: 315 }
];
const pathSegments = createPathSegments(pathPoints);
const pathTotalLength = pathSegments.reduce((sum, segment) => sum + segment.length, 0);

let state = null;
let selectedIndex = null;
let pointerStartIndex = null;
let selfCellRects = [];
let previousFrameTime = performance.now();
let toastTimer = null;
let uiAccumulator = 0;

function createPathSegments(points) {
  const segments = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    segments.push({ start, end, dx, dy, length: Math.hypot(dx, dy) });
  }
  return segments;
}

function pathPosition(progress) {
  let remaining = clamp(progress, 0, 1) * pathTotalLength;
  for (const segment of pathSegments) {
    if (remaining <= segment.length) {
      const ratio = segment.length === 0 ? 0 : remaining / segment.length;
      return {
        x: segment.start.x + segment.dx * ratio,
        y: segment.start.y + segment.dy * ratio
      };
    }
    remaining -= segment.length;
  }
  return { ...pathPoints[pathPoints.length - 1] };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomChoice(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeName(value) {
  return String(value || "")
    .replace(/[<>"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 14) || "플레이어";
}

function loadRecord() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      wave: Number.isFinite(parsed.wave) ? parsed.wave : 0,
      kills: Number.isFinite(parsed.kills) ? parsed.kills : 0,
      score: Number.isFinite(parsed.score) ? parsed.score : 0
    };
  } catch {
    return { wave: 0, kills: 0, score: 0 };
  }
}

function saveRecord(run) {
  const record = loadRecord();
  const next = {
    wave: Math.max(record.wave, run.wave),
    kills: Math.max(record.kills, run.kills),
    score: Math.max(record.score, run.score)
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return next;
  }
  return next;
}

function updateLobbyRecord() {
  const record = loadRecord();
  elements.lobbyBestWave.textContent = record.wave.toLocaleString("ko-KR");
  elements.lobbyBestKills.textContent = record.kills.toLocaleString("ko-KR");
  elements.lobbyBestScore.textContent = record.score.toLocaleString("ko-KR");
}

function createInitialState() {
  const upgrades = {};
  for (const type of DICE_TYPES) upgrades[type] = 1;

  return {
    phase: "playing",
    paused: false,
    playerName: sanitizeName(elements.nicknameInput.value),
    wave: 1,
    waveRemaining: CONFIG.waveSeconds,
    spawnRemaining: 0.55,
    bossSpawnedWave: null,
    hearts: CONFIG.startingHearts,
    sp: CONFIG.startingSp,
    summonCost: CONFIG.startingSummonCost,
    board: Array(CONFIG.boardSize).fill(null),
    upgrades,
    enemies: [],
    effects: [],
    particles: [],
    kills: 0,
    score: 0,
    elapsed: 0,
    banner: { text: "웨이브 1", subtext: "방어를 시작합니다", life: 2.2 }
  };
}

function setScreen(target) {
  elements.lobbyScreen.classList.toggle("visible", target === "lobby");
  elements.gameScreen.classList.toggle("visible", target === "game");
}

function startGame() {
  state = createInitialState();
  selectedIndex = null;
  pointerStartIndex = null;
  previousFrameTime = performance.now();
  elements.pauseOverlay.classList.remove("visible");
  elements.resultOverlay.classList.remove("visible");
  elements.pauseButton.textContent = "일시정지";
  setScreen("game");
  updateUi(true);
  showToast("빈 칸이 있는 동안 주사위를 소환할 수 있습니다.");
}

function returnToLobby() {
  state = null;
  selectedIndex = null;
  pointerStartIndex = null;
  elements.pauseOverlay.classList.remove("visible");
  elements.resultOverlay.classList.remove("visible");
  setScreen("lobby");
  updateLobbyRecord();
}

function togglePause(force) {
  if (!state || state.phase !== "playing") return;
  state.paused = typeof force === "boolean" ? force : !state.paused;
  elements.pauseOverlay.classList.toggle("visible", state.paused);
  elements.pauseButton.textContent = state.paused ? "계속하기" : "일시정지";
  previousFrameTime = performance.now();
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 1800);
}

function summonDice() {
  if (!state || state.phase !== "playing" || state.paused) return;
  const emptyIndexes = [];
  for (let index = 0; index < state.board.length; index += 1) {
    if (!state.board[index]) emptyIndexes.push(index);
  }

  if (emptyIndexes.length === 0) {
    showToast("전장에 빈 칸이 없습니다.");
    return;
  }
  if (state.sp < state.summonCost) {
    showToast("SP가 부족합니다.");
    return;
  }

  const index = randomChoice(emptyIndexes);
  state.sp -= state.summonCost;
  state.board[index] = createDie(1);
  state.summonCost = Math.min(250, state.summonCost + CONFIG.summonCostStep);
  addBurstAtCell(index, DICE[state.board[index].type].color, 16);
  updateUi(true);
}

function createDie(pip) {
  return {
    id: randomId("die"),
    type: randomChoice(DICE_TYPES),
    pip,
    cooldown: 0.12 + Math.random() * 0.18,
    flash: 0
  };
}

function canMerge(first, second) {
  return Boolean(
    first &&
    second &&
    first.type === second.type &&
    first.pip === second.pip &&
    first.pip < CONFIG.maxPip
  );
}

function mergeDice(fromIndex, toIndex) {
  if (!state || state.phase !== "playing" || state.paused) return false;
  const source = state.board[fromIndex];
  const target = state.board[toIndex];

  if (!canMerge(source, target)) {
    showToast("같은 종류와 같은 눈금의 주사위만 합성할 수 있습니다.");
    return false;
  }

  const nextPip = source.pip + 1;
  state.board[fromIndex] = null;
  state.board[toIndex] = createDie(nextPip);
  state.board[toIndex].flash = 0.55;
  addBurstAtCell(toIndex, DICE[state.board[toIndex].type].color, 28);
  showToast(`${nextPip}눈금 ${DICE[state.board[toIndex].type].name} 주사위가 생성되었습니다.`);
  return true;
}

function upgradeDice(type) {
  if (!state || state.phase !== "playing" || state.paused || !DICE[type]) return;
  const level = state.upgrades[type];
  if (level >= CONFIG.maxLevel) {
    showToast("이미 최고 강화 단계입니다.");
    return;
  }

  const cost = upgradeCost(level);
  if (state.sp < cost) {
    showToast("SP가 부족합니다.");
    return;
  }

  state.sp -= cost;
  state.upgrades[type] += 1;
  state.banner = {
    text: `${DICE[type].name} Lv.${state.upgrades[type]}`,
    subtext: "주사위 공격력이 강화되었습니다",
    life: 1.35
  };
  updateUi(true);
}

function upgradeCost(level) {
  return 50 * level;
}

function enemyBaseHp(wave) {
  return 20 * Math.pow(1.23, wave - 1);
}

function spawnInterval(wave) {
  return clamp(1.28 - wave * 0.027, 0.48, 1.28);
}

function spawnEnemy(isBoss = false) {
  if (!state || state.enemies.length >= CONFIG.maxEnemies) return;
  const variance = 0.86 + Math.random() * 0.28;
  const maxHp = enemyBaseHp(state.wave) * variance * (isBoss ? 13.5 : 1);
  state.enemies.push({
    id: randomId("enemy"),
    progress: 0,
    hp: maxHp,
    maxHp,
    speed: isBoss ? 0.018 : 0.036 + Math.min(state.wave, 30) * 0.00065,
    isBoss,
    slowTimer: 0,
    slowFactor: 1,
    poisonTimer: 0,
    poisonDps: 0,
    hitFlash: 0,
    leakDamage: isBoss ? 2 : 1
  });

  if (isBoss) {
    state.banner = {
      text: `웨이브 ${state.wave} 보스`,
      subtext: "강력한 적이 출현했습니다",
      life: 2.2
    };
  }
}

function beginNextWave() {
  state.wave += 1;
  state.waveRemaining += CONFIG.waveSeconds;
  state.spawnRemaining = Math.min(state.spawnRemaining, 0.45);
  state.sp = Math.min(9999, state.sp + 10 + state.wave * 2);
  state.banner = {
    text: `웨이브 ${state.wave}`,
    subtext: state.wave % 5 === 0 ? "보스 웨이브" : `보너스 SP ${10 + state.wave * 2}`,
    life: 2
  };

  if (state.wave % 5 === 0) {
    spawnEnemy(true);
    state.bossSpawnedWave = state.wave;
  }
}

function attackWithDice(dt) {
  if (state.enemies.length === 0) return;

  for (let index = 0; index < state.board.length; index += 1) {
    const die = state.board[index];
    if (!die) continue;

    die.cooldown -= dt;
    die.flash = Math.max(0, die.flash - dt);
    if (die.cooldown > 0) continue;

    const target = findLeadingEnemy();
    if (!target) continue;

    const definition = DICE[die.type];
    const level = state.upgrades[die.type];
    const pipFactor = 1 + (die.pip - 1) * 0.92;
    const levelFactor = 1 + (level - 1) * 0.43;
    const damage = definition.damage * pipFactor * levelFactor;
    const attackSpeedFactor = 1 + (die.pip - 1) * 0.13 + (level - 1) * 0.08;

    dealDamage(target, damage, die, index);

    if (definition.slowFactor) {
      target.slowFactor = Math.min(target.slowFactor, definition.slowFactor);
      target.slowTimer = Math.max(target.slowTimer, definition.slowDuration + die.pip * 0.05);
    }

    if (definition.poisonDps) {
      target.poisonDps = Math.max(
        target.poisonDps,
        definition.poisonDps * pipFactor * levelFactor
      );
      target.poisonTimer = Math.max(target.poisonTimer, definition.poisonDuration);
    }

    if (definition.splashRadius) {
      for (const enemy of state.enemies) {
        if (enemy.id === target.id) continue;
        if (Math.abs(enemy.progress - target.progress) <= definition.splashRadius) {
          enemy.hp -= damage * definition.splashRatio;
          enemy.hitFlash = 0.12;
        }
      }
    }

    die.cooldown = definition.interval / attackSpeedFactor;
    die.flash = 0.13;
  }
}

function findLeadingEnemy() {
  let target = null;
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    if (!target || enemy.progress > target.progress) target = enemy;
  }
  return target;
}

function dealDamage(target, damage, die, boardIndex) {
  target.hp -= damage;
  target.hitFlash = 0.1;
  const source = cellCenter(boardIndex);
  const destination = pathPosition(target.progress);
  state.effects.push({
    type: die.type,
    x1: source.x,
    y1: source.y,
    x2: destination.x,
    y2: destination.y,
    life: 0.12,
    maxLife: 0.12
  });
}

function updateEnemies(dt) {
  for (const enemy of state.enemies) {
    enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);

    if (enemy.poisonTimer > 0) {
      enemy.poisonTimer -= dt;
      enemy.hp -= enemy.poisonDps * dt;
    } else {
      enemy.poisonDps = 0;
    }

    if (enemy.slowTimer > 0) {
      enemy.slowTimer -= dt;
    } else {
      enemy.slowFactor = 1;
    }

    enemy.progress += enemy.speed * enemy.slowFactor * dt;
  }

  const survivors = [];
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) {
      rewardEnemy(enemy);
      continue;
    }

    if (enemy.progress >= 1) {
      state.hearts -= enemy.leakDamage;
      const point = pathPosition(1);
      addBurst(point.x, point.y, "#ff7291", enemy.isBoss ? 35 : 18);
      continue;
    }

    survivors.push(enemy);
  }
  state.enemies = survivors;

  if (state.hearts <= 0) finishGame();
}

function rewardEnemy(enemy) {
  const reward = enemy.isBoss ? 80 + state.wave * 4 : 3 + Math.floor(state.wave / 3);
  state.sp = Math.min(9999, state.sp + reward);
  state.kills += 1;
  state.score += Math.round(enemy.maxHp * (enemy.isBoss ? 1.4 : 1));
  const point = pathPosition(enemy.progress);
  addBurst(point.x, point.y, enemy.isBoss ? "#ff7897" : "#66f2bd", enemy.isBoss ? 46 : 16);
}

function updateEffects(dt) {
  for (const effect of state.effects) effect.life -= dt;
  state.effects = state.effects.filter((effect) => effect.life > 0);

  for (const particle of state.particles) {
    particle.life -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += 70 * dt;
  }
  state.particles = state.particles.filter((particle) => particle.life > 0);

  if (state.banner) {
    state.banner.life -= dt;
    if (state.banner.life <= 0) state.banner = null;
  }
}

function addBurst(x, y, color, count) {
  if (!state) return;
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 35 + Math.random() * 110;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.35 + Math.random() * 0.45,
      maxLife: 0.8,
      size: 1.5 + Math.random() * 3.5,
      color
    });
  }
}

function addBurstAtCell(index, color, count) {
  const point = cellCenter(index);
  addBurst(point.x, point.y, color, count);
}

function updateGame(dt) {
  if (!state || state.phase !== "playing" || state.paused) return;

  state.elapsed += dt;
  state.waveRemaining -= dt;
  state.spawnRemaining -= dt;

  while (state.waveRemaining <= 0) beginNextWave();

  if (state.spawnRemaining <= 0) {
    spawnEnemy(false);
    state.spawnRemaining += spawnInterval(state.wave);
  }

  attackWithDice(dt);
  updateEnemies(dt);
  updateEffects(dt);
}

function finishGame() {
  if (!state || state.phase === "over") return;
  state.phase = "over";
  state.paused = false;
  saveRecord(state);
  updateLobbyRecord();

  elements.resultSummary.textContent = `웨이브 ${state.wave}에서 전장이 돌파되었습니다.`;
  elements.resultWave.textContent = state.wave.toLocaleString("ko-KR");
  elements.resultKills.textContent = state.kills.toLocaleString("ko-KR");
  elements.resultScore.textContent = state.score.toLocaleString("ko-KR");
  elements.resultOverlay.classList.add("visible");
}

function formatTimer(seconds) {
  const total = Math.max(0, Math.ceil(seconds));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const rest = String(total % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function buildUpgradeButtons() {
  elements.upgradeList.innerHTML = DICE_TYPES.map((type) => {
    const die = DICE[type];
    return `
      <button class="upgrade-button" data-type="${type}" type="button">
        <span class="dice-swatch" style="background:linear-gradient(135deg,${die.accent},${die.color})">${die.short}</span>
        <span class="upgrade-copy">
          <strong>${die.name} <span data-role="level"></span></strong>
          <span>${die.description}</span>
        </span>
        <span class="upgrade-price" data-role="price"></span>
      </button>
    `;
  }).join("");
}

function updateUi(force = false) {
  if (!state) return;
  elements.waveText.textContent = state.wave.toLocaleString("ko-KR");
  elements.waveTimer.textContent = formatTimer(state.waveRemaining);
  elements.heartText.textContent = Math.max(0, state.hearts).toLocaleString("ko-KR");
  elements.spText.textContent = Math.floor(state.sp).toLocaleString("ko-KR");
  elements.killText.textContent = state.kills.toLocaleString("ko-KR");
  elements.scoreText.textContent = state.score.toLocaleString("ko-KR");
  elements.summonCostText.textContent = `${state.summonCost} SP`;
  elements.summonButton.disabled =
    state.phase !== "playing" ||
    state.paused ||
    state.sp < state.summonCost ||
    state.board.every(Boolean);

  const buttons = elements.upgradeList.querySelectorAll(".upgrade-button");
  for (const button of buttons) {
    const type = button.dataset.type;
    const level = state.upgrades[type];
    const cost = level >= CONFIG.maxLevel ? null : upgradeCost(level);
    button.querySelector('[data-role="level"]').textContent = `Lv.${level}`;
    button.querySelector('[data-role="price"]').textContent = cost === null ? "MAX" : `${cost} SP`;
    button.disabled =
      state.phase !== "playing" ||
      state.paused ||
      level >= CONFIG.maxLevel ||
      state.sp < cost;
  }

  if (force) drawGame();
}

function roundRect(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function fillRoundRect(x, y, width, height, radius, fill, stroke = null, lineWidth = 1) {
  roundRect(x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function drawText(text, x, y, size, color, align = "left", weight = 700) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px "Segoe UI", "Noto Sans KR", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, elements.canvas.width, elements.canvas.height);
  gradient.addColorStop(0, "#151d3a");
  gradient.addColorStop(0.56, "#0b1020");
  gradient.addColorStop(1, "#17112c");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, elements.canvas.width, elements.canvas.height);

  ctx.fillStyle = "rgba(255,255,255,0.028)";
  for (let index = 0; index < 42; index += 1) {
    const x = (index * 137) % elements.canvas.width;
    const y = (index * 83) % elements.canvas.height;
    ctx.beginPath();
    ctx.arc(x, y, index % 3 === 0 ? 2 : 1, 0, Math.PI * 2);
    ctx.fill();
  }

  const topGlow = ctx.createRadialGradient(500, 160, 30, 500, 160, 520);
  topGlow.addColorStop(0, "rgba(89,125,255,0.13)");
  topGlow.addColorStop(1, "rgba(89,125,255,0)");
  ctx.fillStyle = topGlow;
  ctx.fillRect(0, 0, 1000, 450);
}

function drawArenaHeader() {
  fillRoundRect(42, 28, 916, 58, 17, "rgba(8,12,27,0.72)", "rgba(255,255,255,0.09)");
  drawText("SOLO SURVIVAL", 66, 49, 11, "#66f2bd", "left", 900);
  drawText(state.playerName, 66, 69, 18, "#ffffff", "left", 900);
  drawText(`웨이브 ${state.wave}`, 934, 49, 13, "#cbd3ef", "right", 800);
  drawText(`${state.enemies.length} enemies`, 934, 69, 11, "#818ba9", "right", 700);
}

function drawTrack() {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.strokeStyle = "rgba(0,0,0,0.38)";
  ctx.lineWidth = 76;
  ctx.beginPath();
  ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
  for (let index = 1; index < pathPoints.length; index += 1) {
    ctx.lineTo(pathPoints[index].x, pathPoints[index].y);
  }
  ctx.stroke();

  const trackGradient = ctx.createLinearGradient(75, 150, 925, 315);
  trackGradient.addColorStop(0, "rgba(74,107,139,0.78)");
  trackGradient.addColorStop(0.5, "rgba(62,70,105,0.82)");
  trackGradient.addColorStop(1, "rgba(95,55,81,0.82)");
  ctx.strokeStyle = trackGradient;
  ctx.lineWidth = 64;
  ctx.beginPath();
  ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
  for (let index = 1; index < pathPoints.length; index += 1) {
    ctx.lineTo(pathPoints[index].x, pathPoints[index].y);
  }
  ctx.stroke();

  ctx.setLineDash([10, 18]);
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
  for (let index = 1; index < pathPoints.length; index += 1) {
    ctx.lineTo(pathPoints[index].x, pathPoints[index].y);
  }
  ctx.stroke();
  ctx.restore();

  const start = pathPosition(0);
  const end = pathPosition(1);
  fillRoundRect(start.x - 30, start.y - 21, 60, 42, 13, "rgba(102,242,189,0.17)", "rgba(102,242,189,0.42)");
  drawText("START", start.x, start.y, 10, "#aaffdf", "center", 900);

  fillRoundRect(end.x - 30, end.y - 21, 60, 42, 13, "rgba(255,114,145,0.16)", "rgba(255,114,145,0.42)");
  drawText("GOAL", end.x, end.y, 10, "#ffc1cf", "center", 900);
}

function boardLayout() {
  return {
    x: 175,
    y: 420,
    width: 650,
    height: 330,
    cols: 5,
    rows: 3,
    gap: 12,
    padding: 20
  };
}

function calculateCellRect(index) {
  const layout = boardLayout();
  const usableWidth = layout.width - layout.padding * 2;
  const usableHeight = layout.height - layout.padding * 2;
  const cellWidth = (usableWidth - layout.gap * (layout.cols - 1)) / layout.cols;
  const cellHeight = (usableHeight - layout.gap * (layout.rows - 1)) / layout.rows;
  const size = Math.min(cellWidth, cellHeight);
  const totalWidth = size * layout.cols + layout.gap * (layout.cols - 1);
  const totalHeight = size * layout.rows + layout.gap * (layout.rows - 1);
  const startX = layout.x + (layout.width - totalWidth) / 2;
  const startY = layout.y + (layout.height - totalHeight) / 2;
  const col = index % layout.cols;
  const row = Math.floor(index / layout.cols);
  return {
    x: startX + col * (size + layout.gap),
    y: startY + row * (size + layout.gap),
    width: size,
    height: size
  };
}

function cellCenter(index) {
  const rect = calculateCellRect(index);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function drawBoard() {
  const layout = boardLayout();
  const panelGradient = ctx.createLinearGradient(layout.x, layout.y, layout.x + layout.width, layout.y + layout.height);
  panelGradient.addColorStop(0, "rgba(32,48,77,0.95)");
  panelGradient.addColorStop(1, "rgba(15,22,43,0.98)");
  fillRoundRect(layout.x, layout.y, layout.width, layout.height, 25, panelGradient, "rgba(255,255,255,0.11)");

  drawText("DICE GRID", layout.x + 22, layout.y + 18, 10, "#7783a8", "left", 900);
  drawText("같은 주사위를 합성해 전력을 높이세요", layout.x + layout.width - 22, layout.y + 18, 10, "#7783a8", "right", 700);

  selfCellRects = [];
  const selectedDie = selectedIndex === null ? null : state.board[selectedIndex];

  for (let index = 0; index < CONFIG.boardSize; index += 1) {
    const rect = calculateCellRect(index);
    const die = state.board[index];
    const selected = selectedIndex === index;
    const compatible = selectedDie && index !== selectedIndex && canMerge(selectedDie, die);

    let stroke = "rgba(255,255,255,0.09)";
    let lineWidth = 1;
    if (compatible) {
      stroke = "rgba(102,242,189,0.68)";
      lineWidth = 2;
    }
    if (selected) {
      stroke = "#ffffff";
      lineWidth = 3;
    }

    fillRoundRect(rect.x, rect.y, rect.width, rect.height, 16, "rgba(255,255,255,0.04)", stroke, lineWidth);
    selfCellRects.push({ index, ...rect });

    if (die) drawDie(die, rect.x + 6, rect.y + 6, rect.width - 12, selected);
    else drawText("+", rect.x + rect.width / 2, rect.y + rect.height / 2, 23, "rgba(255,255,255,0.09)", "center", 500);
  }
}

function drawDie(die, x, y, size, selected) {
  const definition = DICE[die.type];
  ctx.save();
  ctx.shadowColor = definition.color;
  ctx.shadowBlur = die.flash > 0 ? 20 : selected ? 16 : 7;
  const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, definition.accent);
  gradient.addColorStop(1, definition.color);
  fillRoundRect(x, y, size, size, size * 0.2, gradient, selected ? "#ffffff" : "rgba(255,255,255,0.38)", selected ? 3 : 1);
  ctx.restore();

  fillRoundRect(x + 7, y + 7, Math.max(27, size * 0.28), Math.max(22, size * 0.21), 7, "rgba(9,13,28,0.7)");
  drawText(definition.short, x + 7 + Math.max(27, size * 0.28) / 2, y + 7 + Math.max(22, size * 0.21) / 2, Math.max(10, size * 0.105), "#ffffff", "center", 950);

  drawPips(x + size / 2, y + size / 2 + 2, size, die.pip, "rgba(14,18,31,0.84)");
  drawText(`Lv.${state.upgrades[die.type]}`, x + size - 8, y + size - 10, Math.max(9, size * 0.085), "rgba(15,18,31,0.72)", "right", 900);
}

function drawPips(cx, cy, size, pip, color) {
  if (pip >= 7) {
    drawText(String(pip), cx, cy, size * 0.31, color, "center", 950);
    return;
  }

  const offset = size * 0.19;
  const radius = Math.max(2.8, size * 0.043);
  const positions = {
    1: [[0, 0]],
    2: [[-1, -1], [1, 1]],
    3: [[-1, -1], [0, 0], [1, 1]],
    4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
    6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]
  };

  ctx.fillStyle = color;
  for (const [px, py] of positions[pip] || positions[1]) {
    ctx.beginPath();
    ctx.arc(cx + px * offset, cy + py * offset, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEnemies() {
  const ordered = [...state.enemies].sort((a, b) => a.progress - b.progress);
  for (const enemy of ordered) drawEnemy(enemy);
}

function drawEnemy(enemy) {
  const point = pathPosition(enemy.progress);
  const radius = enemy.isBoss ? 27 : 15;
  const hpRatio = clamp(enemy.hp / enemy.maxHp, 0, 1);

  ctx.save();
  ctx.shadowBlur = enemy.isBoss ? 24 : 9;
  ctx.shadowColor = enemy.isBoss ? "#ff6f91" : enemy.poisonTimer > 0 ? "#70dc79" : enemy.slowTimer > 0 ? "#62baff" : "#d5d9e8";
  const gradient = ctx.createRadialGradient(point.x - radius * 0.32, point.y - radius * 0.32, 2, point.x, point.y, radius);
  gradient.addColorStop(0, enemy.hitFlash > 0 ? "#ffffff" : enemy.isBoss ? "#ffd3dd" : "#f6f8ff");
  gradient.addColorStop(1, enemy.isBoss ? "#cc365f" : enemy.slowTimer > 0 ? "#3989be" : "#505a79");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const barWidth = enemy.isBoss ? 70 : 40;
  fillRoundRect(point.x - barWidth / 2, point.y - radius - 14, barWidth, 6, 3, "rgba(0,0,0,0.58)");
  fillRoundRect(point.x - barWidth / 2, point.y - radius - 14, barWidth * hpRatio, 6, 3, enemy.isBoss ? "#ff7897" : "#66f2bd");

  if (enemy.isBoss) drawText("BOSS", point.x, point.y, 9, "#2b1018", "center", 950);

  if (enemy.poisonTimer > 0) {
    ctx.fillStyle = "#77eb80";
    ctx.beginPath();
    ctx.arc(point.x + radius * 0.62, point.y - radius * 0.5, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEffects() {
  ctx.save();
  ctx.lineCap = "round";
  for (const effect of state.effects) {
    const alpha = clamp(effect.life / effect.maxLife, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = DICE[effect.type].color;
    ctx.lineWidth = effect.type === "rapid" ? 2 : 4;
    ctx.shadowColor = DICE[effect.type].color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(effect.x1, effect.y1);
    ctx.lineTo(effect.x2, effect.y2);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  for (const particle of state.particles) {
    ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBanner() {
  if (!state.banner) return;
  const alpha = clamp(state.banner.life / 0.55, 0, 1);
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  fillRoundRect(330, 188, 340, 88, 20, "rgba(7,11,25,0.88)", "rgba(102,242,189,0.25)");
  drawText(state.banner.text, 500, 221, 25, "#ffffff", "center", 950);
  drawText(state.banner.subtext, 500, 251, 12, "#aab4d1", "center", 700);
  ctx.restore();
}

function drawGame() {
  drawBackground();
  if (!state) {
    drawText("솔로 모드를 시작해 주세요.", 500, 410, 24, "#a5aecb", "center", 800);
    return;
  }
  drawArenaHeader();
  drawTrack();
  drawBoard();
  drawEnemies();
  drawEffects();
  drawBanner();
}

function canvasPoint(event) {
  const rect = elements.canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (elements.canvas.width / rect.width),
    y: (event.clientY - rect.top) * (elements.canvas.height / rect.height)
  };
}

function cellAtPoint(point) {
  return selfCellRects.find((cell) =>
    point.x >= cell.x &&
    point.x <= cell.x + cell.width &&
    point.y >= cell.y &&
    point.y <= cell.y + cell.height
  ) || null;
}

function handleCellInteraction(startIndex, endIndex) {
  if (!state || state.phase !== "playing" || state.paused) return;
  const startDie = startIndex === null ? null : state.board[startIndex];
  const endDie = endIndex === null ? null : state.board[endIndex];

  if (startIndex !== null && endIndex !== null && startIndex !== endIndex && startDie) {
    if (canMerge(startDie, endDie)) {
      mergeDice(startIndex, endIndex);
      selectedIndex = null;
      return;
    }
  }

  if (endIndex === null) {
    selectedIndex = null;
    return;
  }

  if (selectedIndex === null) {
    selectedIndex = endDie ? endIndex : null;
    return;
  }

  if (selectedIndex === endIndex) {
    selectedIndex = null;
    return;
  }

  if (canMerge(state.board[selectedIndex], endDie)) {
    mergeDice(selectedIndex, endIndex);
    selectedIndex = null;
    return;
  }

  selectedIndex = endDie ? endIndex : null;
}

function animationLoop(timestamp) {
  const rawDt = (timestamp - previousFrameTime) / 1000;
  previousFrameTime = timestamp;
  const dt = clamp(rawDt, 0, 0.08);

  if (state) {
    updateGame(dt);
    uiAccumulator += dt;
    if (uiAccumulator >= 0.08) {
      updateUi();
      uiAccumulator = 0;
    }
  }

  drawGame();
  requestAnimationFrame(animationLoop);
}

elements.startSoloButton.addEventListener("click", startGame);
elements.nicknameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") startGame();
});
elements.summonButton.addEventListener("click", summonDice);
elements.pauseButton.addEventListener("click", () => togglePause());
elements.resumeButton.addEventListener("click", () => togglePause(false));
elements.exitButton.addEventListener("click", returnToLobby);
elements.retryButton.addEventListener("click", startGame);
elements.resultLobbyButton.addEventListener("click", returnToLobby);

elements.upgradeList.addEventListener("click", (event) => {
  const button = event.target.closest(".upgrade-button");
  if (!button) return;
  upgradeDice(button.dataset.type);
});

elements.canvas.addEventListener("pointerdown", (event) => {
  if (!state || state.phase !== "playing" || state.paused) return;
  const cell = cellAtPoint(canvasPoint(event));
  pointerStartIndex = cell ? cell.index : null;
  elements.canvas.setPointerCapture?.(event.pointerId);
});

elements.canvas.addEventListener("pointerup", (event) => {
  if (!state || state.phase !== "playing" || state.paused) return;
  const cell = cellAtPoint(canvasPoint(event));
  handleCellInteraction(pointerStartIndex, cell ? cell.index : null);
  pointerStartIndex = null;
});

elements.canvas.addEventListener("pointercancel", () => {
  pointerStartIndex = null;
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && state && state.phase === "playing" && !state.paused) {
    togglePause(true);
  }
});

window.addEventListener("keydown", (event) => {
  if (!state || state.phase !== "playing") return;
  if (event.code === "Space") {
    event.preventDefault();
    summonDice();
  } else if (event.key.toLowerCase() === "p" || event.key === "Escape") {
    togglePause();
  }
});

buildUpgradeButtons();
updateLobbyRecord();
setScreen("lobby");
requestAnimationFrame(animationLoop);
