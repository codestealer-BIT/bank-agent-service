const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");

const ui = {
  score: document.querySelector("#score"),
  goal: document.querySelector("#goal"),
  time: document.querySelector("#time"),
  level: document.querySelector("#level"),
  overlay: document.querySelector("#overlay"),
  startButton: document.querySelector("#startButton"),
  dropButton: document.querySelector("#dropButton"),
  restartButton: document.querySelector("#restartButton"),
};

const W = canvas.width;
const H = canvas.height;
const miner = { x: W / 2, y: 86 };
const claw = {
  angle: 0,
  dir: 1,
  len: 72,
  state: "swing",
  maxLen: 570,
  grabbed: null,
};

let level = 1;
let score = 0;
let goal = 650;
let timeLeft = 60;
let items = [];
let lastTime = performance.now();
let running = false;
let message = "";
let nextLevelPause = 0;

const itemTypes = {
  smallGold: { value: 75, radius: 18, weight: 0.8, fill: "#f7c33a", stroke: "#b66f0f" },
  mediumGold: { value: 180, radius: 28, weight: 1.25, fill: "#f0ab22", stroke: "#995a0d" },
  bigGold: { value: 420, radius: 42, weight: 2.1, fill: "#e49a16", stroke: "#7b480b" },
  diamond: { value: 600, radius: 17, weight: 0.65, fill: "#baf4ff", stroke: "#1e8cb0" },
  rock: { value: 25, radius: 34, weight: 2.5, fill: "#747476", stroke: "#4b4d52" },
};

function resetGame() {
  level = 1;
  score = 0;
  goal = 650;
  startLevel();
  running = true;
  ui.overlay.hidden = true;
}

function startLevel() {
  timeLeft = 60;
  message = "";
  nextLevelPause = 0;
  claw.state = "swing";
  claw.len = 72;
  claw.grabbed = null;
  claw.angle = 0;
  goal = 650 + (level - 1) * 360;
  items = buildItems();
  syncUi();
}

function buildItems() {
  const specs = [
    ["bigGold", 2],
    ["mediumGold", 4 + level],
    ["smallGold", 5],
    ["diamond", Math.min(1 + Math.floor(level / 2), 3)],
    ["rock", 4 + level],
  ];
  const placed = [];
  for (const [type, count] of specs) {
    for (let i = 0; i < count; i += 1) {
      const base = itemTypes[type];
      let item;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        item = {
          type,
          x: random(base.radius + 30, W - base.radius - 30),
          y: random(230, H - base.radius - 34),
          radius: base.radius,
          value: base.value,
          weight: base.weight,
          fill: base.fill,
          stroke: base.stroke,
          caught: false,
        };
        if (!placed.some((other) => distance(item, other) < item.radius + other.radius + 14)) {
          placed.push(item);
          break;
        }
      }
    }
  }
  return placed;
}

function random(min, max) {
  return min + Math.random() * (max - min);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function dropClaw() {
  if (!running || claw.state !== "swing" || nextLevelPause > 0) return;
  claw.state = "out";
}

function update(dt) {
  if (!running) return;

  if (nextLevelPause > 0) {
    nextLevelPause -= dt;
    if (nextLevelPause <= 0) {
      level += 1;
      startLevel();
    }
    return;
  }

  timeLeft = Math.max(0, timeLeft - dt);
  if (timeLeft <= 0) {
    endLevel();
    return;
  }

  if (claw.state === "swing") {
    claw.angle += claw.dir * dt * 1.35;
    const limit = Math.PI / 2.85;
    if (claw.angle > limit || claw.angle < -limit) {
      claw.dir *= -1;
      claw.angle = Math.max(-limit, Math.min(limit, claw.angle));
    }
  }

  if (claw.state === "out") {
    claw.len += dt * 395;
    const tip = clawTip();
    const hit = items.find((item) => !item.caught && distance(tip, item) < item.radius + 11);
    if (hit) {
      hit.caught = true;
      claw.grabbed = hit;
      claw.state = "back";
    } else if (claw.len >= claw.maxLen || tip.x < 0 || tip.x > W || tip.y > H) {
      claw.state = "back";
    }
  }

  if (claw.state === "back") {
    const load = claw.grabbed ? claw.grabbed.weight : 0;
    claw.len -= dt * (360 / (1 + load));
    if (claw.grabbed) {
      const tip = clawTip();
      claw.grabbed.x = tip.x;
      claw.grabbed.y = tip.y;
    }
    if (claw.len <= 72) {
      claw.len = 72;
      if (claw.grabbed) {
        score += claw.grabbed.value;
        items = items.filter((item) => item !== claw.grabbed);
        claw.grabbed = null;
      }
      claw.state = "swing";
    }
  }

  syncUi();
}

function endLevel() {
  if (score >= goal) {
    message = `Level ${level} cleared`;
    nextLevelPause = 2.2;
  } else {
    running = false;
    ui.overlay.querySelector("h1").textContent = "Game Over";
    ui.overlay.querySelector("p").textContent = `You scored $${score}. Goal was $${goal}.`;
    ui.startButton.textContent = "Play Again";
    ui.overlay.hidden = false;
  }
}

function clawTip() {
  return {
    x: miner.x + Math.sin(claw.angle) * claw.len,
    y: miner.y + Math.cos(claw.angle) * claw.len,
  };
}

function syncUi() {
  ui.score.textContent = `$${score}`;
  ui.goal.textContent = `$${goal}`;
  ui.time.textContent = Math.ceil(timeLeft);
  ui.level.textContent = level;
}

function draw() {
  drawBackground();
  items.forEach(drawItem);
  drawMiner();
  drawClaw();
  if (message) drawMessage(message);
}

function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#7bd1f4");
  sky.addColorStop(0.34, "#e7c36b");
  sky.addColorStop(0.35, "#8b5a2b");
  sky.addColorStop(1, "#3e2719");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#5f3a21";
  ctx.fillRect(0, 188, W, H - 188);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  for (let y = 238; y < H; y += 72) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= W; x += 80) ctx.lineTo(x, y + Math.sin(x * 0.035 + y) * 10);
    ctx.strokeStyle = "rgba(255, 219, 157, 0.14)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

function drawMiner() {
  ctx.save();
  ctx.translate(miner.x, 57);
  ctx.fillStyle = "#6d3919";
  ctx.fillRect(-58, 42, 116, 22);
  ctx.fillStyle = "#f2bf70";
  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#d89424";
  ctx.beginPath();
  ctx.moveTo(-34, -8);
  ctx.lineTo(0, -42);
  ctx.lineTo(36, -8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#3d2916";
  ctx.fillRect(-28, 20, 56, 30);
  ctx.restore();
}

function drawClaw() {
  const tip = clawTip();
  ctx.strokeStyle = "#33210f";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(miner.x, miner.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();

  ctx.save();
  ctx.translate(tip.x, tip.y);
  ctx.rotate(-claw.angle);
  ctx.strokeStyle = "#1f1710";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(0, 0, 18, Math.PI * 0.2, Math.PI * 0.82);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 18, Math.PI * 1.18, Math.PI * 1.8);
  ctx.stroke();
  ctx.restore();
}

function drawItem(item) {
  ctx.save();
  ctx.translate(item.x, item.y);
  if (item.type === "diamond") {
    ctx.fillStyle = item.fill;
    ctx.strokeStyle = item.stroke;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -item.radius);
    ctx.lineTo(item.radius, 0);
    ctx.lineTo(0, item.radius);
    ctx.lineTo(-item.radius, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillStyle = item.fill;
    ctx.strokeStyle = item.stroke;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(0, 0, item.radius * 1.22, item.radius * 0.86, -0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = item.type === "rock" ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.32)";
    ctx.beginPath();
    ctx.ellipse(-item.radius * 0.25, -item.radius * 0.18, item.radius * 0.32, item.radius * 0.16, -0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawMessage(text) {
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(W / 2 - 180, H / 2 - 42, 360, 84);
  ctx.fillStyle = "#fff3b8";
  ctx.font = "800 34px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(text, W / 2, H / 2 + 12);
}

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.04);
  lastTime = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

ui.startButton.addEventListener("click", resetGame);
ui.restartButton.addEventListener("click", resetGame);
ui.dropButton.addEventListener("click", dropClaw);
canvas.addEventListener("pointerdown", dropClaw);
window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    dropClaw();
  }
});

draw();
requestAnimationFrame(loop);
