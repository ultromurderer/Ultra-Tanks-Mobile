'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');

const PORT = Number(process.env.PORT || 8765);
const ROOT = __dirname;
const SNAPSHOT_BACKPRESSURE_BYTES = 512 * 1024;
const MAX_PLAYER_LIVES = 15;
const PLAYER_TANK_TYPES = new Set(['standard','scout','assault','heavy','lemanRuss','lemanRussLongCannon','lemanRussSniper','lemanRussTitan','lemanRussHyperion','lemanRussMinigun','lemanRussMars','lemanRussPlasma','baneblade','duplet','triplet','rocketBattery','guidedLauncher','sputnik','sonicPlayer','harkonnen','atreides','ordos','imperial','missile','artillery','arrakisArtillery','nuclearArtillery','playerHellboy','playerResonator','playerWarhead','playerLeviathan','playerSandWorm','playerBastion']);
const clients = new Map();
let nextId = 1;
let matchStarted = false;
let matchMode = 'campaign';
let matchDifficulty = 'easy';
const MATCH_DIFFICULTIES = new Set(['easy','medium','hard']);
function normalizeDifficulty(value) { return MATCH_DIFFICULTIES.has(String(value||'')) ? String(value) : 'easy'; }

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg'
};

function safePath(urlPath) {
  let pathname;
  try { pathname = decodeURIComponent((urlPath || '/').split('?')[0]); }
  catch (_) { return null; }
  if (pathname === '/') pathname = '/Ultra Tanks.html';
  const resolved = path.resolve(ROOT, '.' + pathname);
  const relative = path.relative(ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  const filePath = safePath(req.url);
  if (!filePath) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); res.end('Not found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    const range = req.headers.range;
    if (range && ext === '.mp3') {
      const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
      if (match) {
        let start = match[1] ? Number(match[1]) : 0;
        let end = match[2] ? Number(match[2]) : stat.size - 1;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= stat.size || end < start) {
          res.writeHead(416, {'Content-Range': `bytes */${stat.size}`}); res.end(); return;
        }
        end = Math.min(end, stat.size - 1);
        res.writeHead(206, {
          'Content-Type': contentType,
          'Content-Length': end - start + 1,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store'
        });
        fs.createReadStream(filePath, {start, end}).pipe(res);
        return;
      }
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Accept-Ranges': ext === '.mp3' ? 'bytes' : 'none',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function writeFrame(client, frame, dropIfBusy = false) {
  if (!client || !client.socket || client.socket.destroyed) return false;
  if (dropIfBusy && client.socket.writableLength > SNAPSHOT_BACKPRESSURE_BYTES) return false;
  try { return client.socket.write(frame); } catch (_) { return false; }
}

function send(client, data, dropIfBusy = false) {
  let frame;
  try { frame = encodeFrame(JSON.stringify(data)); } catch (_) { return false; }
  return writeFrame(client, frame, dropIfBusy);
}

function broadcast(data, exceptId = null) {
  let frame;
  try { frame = encodeFrame(JSON.stringify(data)); } catch (_) { return; }
  for (const [id, client] of clients) {
    if (id !== exceptId) writeFrame(client, frame);
  }
}

function lobbyState() {
  const players = [...clients.values()]
    .sort((a,b) => a.slot - b.slot)
    .map(c => ({slot:c.slot, name:c.name || `Игрок ${c.slot}`, ready:!!c.ready, tank:c.tank || 'standard', maxLives:c.maxLives || 2, baseUpgrades:c.baseUpgrades || 0, rocketeerKills:c.rocketeerKills || 0, firstBossCleared:!!c.firstBossCleared, secondBossCleared:!!c.secondBossCleared, thirdBossCleared:!!c.thirdBossCleared, fourthBossCleared:!!c.fourthBossCleared, level33Cleared:!!c.level33Cleared, financeLevel:Math.max(0,Math.min(3,Math.floor(Number(c.financeLevel)||0))), logisticsLevel:Math.max(0,Math.min(3,Math.floor(Number(c.logisticsLevel)||0))), techLevel:Math.max(0,Math.min(3,Math.floor(Number(c.techLevel)||0))), airportBuilt:!!c.airportBuilt, supplyCenterBuilt:!!c.supplyCenterBuilt, missileComplexBuilt:!!c.missileComplexBuilt, portalBuilt:!!c.portalBuilt, basePowered:!!c.basePowered}));
  return {type:'lobby', players, count:players.length, started:matchStarted, matchMode, difficulty:matchDifficulty};
}

function publishLobby() {
  broadcast(lobbyState());
}

function returnMatchToLobby(reason = 'mode_switch') {
  if (!matchStarted) return;
  matchStarted = false;
  for (const client of clients.values()) client.ready = false;
  broadcast({type:'return_lobby', reason, matchMode, difficulty:matchDifficulty});
  publishLobby();
}

function tryStart() {
  const list = [...clients.values()].sort((a,b)=>a.slot-b.slot);
  const host = list.find(c => c.slot === 1);
  if (matchStarted || !host || list.length < 2 || list.length > 3) return;
  if (!list.every(c => c.ready && c.name)) return;
  matchStarted = true;
  const players = list.map(c => ({slot:c.slot, name:c.name, tank:c.tank || 'standard', maxLives:c.maxLives || 2, baseUpgrades:c.baseUpgrades || 0, rocketeerKills:c.rocketeerKills || 0, firstBossCleared:!!c.firstBossCleared, secondBossCleared:!!c.secondBossCleared, thirdBossCleared:!!c.thirdBossCleared, fourthBossCleared:!!c.fourthBossCleared, level33Cleared:!!c.level33Cleared, financeLevel:Math.max(0,Math.min(3,Math.floor(Number(c.financeLevel)||0))), logisticsLevel:Math.max(0,Math.min(3,Math.floor(Number(c.logisticsLevel)||0))), techLevel:Math.max(0,Math.min(3,Math.floor(Number(c.techLevel)||0))), airportBuilt:!!c.airportBuilt, supplyCenterBuilt:!!c.supplyCenterBuilt, missileComplexBuilt:!!c.missileComplexBuilt, portalBuilt:!!c.portalBuilt, basePowered:!!c.basePowered}));
  broadcast({type:'start', players, hostSlot:host.slot, matchMode, difficulty:matchMode==='campaign'?matchDifficulty:'easy'});
  publishLobby();
}

function compactClientSlotsAndRoles() {
  const list = [...clients.values()].sort((a,b) => a.slot - b.slot);
  list.forEach((client,index) => { client.slot = index + 1; });
  for (const client of list) {
    send(client, {type:'welcome', slot:client.slot, host:client.slot===1, matchMode, difficulty:matchDifficulty});
  }
}

function parseFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  while (client.buffer.length >= 2) {
    const b0 = client.buffer[0], b1 = client.buffer[1];
    const opcode = b0 & 0x0f;
    let offset = 2;
    let len = b1 & 0x7f;
    const masked = !!(b1 & 0x80);
    if (len === 126) {
      if (client.buffer.length < 4) return;
      len = client.buffer.readUInt16BE(2); offset = 4;
    } else if (len === 127) {
      if (client.buffer.length < 10) return;
      const big = client.buffer.readBigUInt64BE(2);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) return client.socket.destroy();
      len = Number(big); offset = 10;
    }
    const maskBytes = masked ? 4 : 0;
    if (client.buffer.length < offset + maskBytes + len) return;
    let payload;
    if (masked) {
      const mask = client.buffer.subarray(offset, offset+4);
      offset += 4;
      payload = Buffer.from(client.buffer.subarray(offset, offset+len));
      for (let i=0;i<payload.length;i++) payload[i] ^= mask[i%4];
    } else {
      payload = client.buffer.subarray(offset, offset+len);
    }
    client.buffer = client.buffer.subarray(offset+len);

    if (opcode === 0x8) return client.socket.end();
    if (opcode === 0x9) {
      const pong = Buffer.concat([Buffer.from([0x8A, payload.length]), payload]);
      client.socket.write(pong); continue;
    }
    if (opcode !== 0x1) continue;
    let msg;
    try { msg = JSON.parse(payload.toString('utf8')); } catch (_) { continue; }
    handleMessage(client, msg);
  }
}

function handleMessage(client, msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case 'hello':
      client.name = String(msg.name || '').trim().slice(0,16) || `Игрок ${client.slot}`;
      client.tank = PLAYER_TANK_TYPES.has(msg.tank) ? msg.tank : 'standard';
      client.maxLives = Math.max(Number(client.maxLives) || 2, Math.max(2, Math.min(MAX_PLAYER_LIVES, Math.floor(Number(msg.maxLives) || 2))));
      client.baseUpgrades = Math.max(Number(client.baseUpgrades) || 0, Math.max(0, Math.min(5, Math.floor(Number(msg.baseUpgrades) || 0))));
      client.rocketeerKills = Math.max(
        Number(client.rocketeerKills) || 0,
        Math.max(0, Math.min(50, Math.floor(Number(msg.rocketeerKills) || 0)))
      );
      client.firstBossCleared = !!client.firstBossCleared || !!msg.firstBossCleared || !!msg.secondBossCleared || !!msg.thirdBossCleared || !!msg.fourthBossCleared;
      client.secondBossCleared = !!client.secondBossCleared || !!msg.secondBossCleared || !!msg.thirdBossCleared || !!msg.fourthBossCleared;
      client.thirdBossCleared = !!client.thirdBossCleared || !!msg.thirdBossCleared || !!msg.fourthBossCleared;
      client.fourthBossCleared = !!client.fourthBossCleared || !!msg.fourthBossCleared;
      client.level33Cleared = !!client.level33Cleared || !!msg.level33Cleared;
      client.financeLevel = Math.max(0, Math.min(3, Math.floor(Number(msg.financeLevel) || 0)));
      client.logisticsLevel = Math.max(0, Math.min(3, Math.floor(Number(msg.logisticsLevel) || 0)));
      client.techLevel = Math.max(0, Math.min(3, Math.floor(Number(msg.techLevel) || 0)));
      client.airportBuilt = !!msg.airportBuilt;
      client.supplyCenterBuilt = !!msg.supplyCenterBuilt;
      client.missileComplexBuilt = !!msg.missileComplexBuilt;
      client.portalBuilt = !!msg.portalBuilt;
      client.basePowered = !!msg.basePowered;
      if (client.slot === 1 && ['campaign','pvp'].includes(msg.matchMode)) matchMode = msg.matchMode;
      if (client.slot === 1 && MATCH_DIFFICULTIES.has(String(msg.difficulty||''))) matchDifficulty = normalizeDifficulty(msg.difficulty);
      client.ready = false;
      publishLobby();
      break;
    case 'set_mode':
      if (!matchStarted && client.slot === 1 && ['campaign','pvp'].includes(msg.matchMode)) {
        matchMode = msg.matchMode;
        for (const c of clients.values()) c.ready = false;
        publishLobby();
      }
      break;
    case 'set_difficulty':
      if (!matchStarted && client.slot === 1 && matchMode === 'campaign' && MATCH_DIFFICULTIES.has(String(msg.difficulty||''))) {
        matchDifficulty = normalizeDifficulty(msg.difficulty);
        for (const c of clients.values()) c.ready = false;
        publishLobby();
      }
      break;
    case 'ready':
      client.ready = !!msg.ready;
      publishLobby();
      tryStart();
      break;
    case 'input':
      if (matchStarted && (client.slot === 2 || client.slot === 3)) {
        const host = [...clients.values()].find(c => c.slot === 1);
        const input = msg.input || {};
        send(host, {
          type:'input',
          slot:client.slot,
          input:{up:!!input.up, down:!!input.down, left:!!input.left, right:!!input.right, shoot:!!input.shoot,q:!!input.q,e:!!input.e,g:!!input.g}
        });
      }
      break;
    case 'snapshot':
      if (matchStarted && client.slot === 1 && msg.state && typeof msg.state === 'object') {
        let frame;
        try { frame = encodeFrame(JSON.stringify({type:'snapshot', state:msg.state})); } catch (_) { break; }
        for (const guest of clients.values()) {
          if (guest.slot === 2 || guest.slot === 3) writeFrame(guest, frame, true);
        }
      }
      break;
    case 'career_stat_batch':
      if (matchStarted && client.slot === 1 && msg.deltas && typeof msg.deltas === 'object') {
        const targetSlot = Math.max(2, Math.min(3, Math.floor(Number(msg.targetSlot) || 0)));
        const allowed = new Set(['pointsEarned','casesEarned','kills','pvpKills','bossKills','campaignBossKills','bonusBossKills','deaths','shotsFired','damageDealt','damageTaken','levelsCleared','bonusLevelsCleared','portalsEntered','regularPortalsEntered','ultroPortalsEntered','pvpRoundsWon','campaignVictories','campaignDefeats','pvpVictories','pvpDefeats']);
        const deltas = {};
        for (const [key,value] of Object.entries(msg.deltas)) if (allowed.has(key) && Number(value)) deltas[key] = Number(value);
        const guest = [...clients.values()].find(c => c.slot === targetSlot);
        if (guest && Object.keys(deltas).length) send(guest, {type:'career_stat_batch',targetSlot,deltas});
      }
      break;
    case 'career_map_stat_batch':
      if (matchStarted && client.slot === 1 && msg.maps && typeof msg.maps === 'object') {
        const targetSlot = Math.max(2, Math.min(3, Math.floor(Number(msg.targetSlot) || 0)));
        const cleanMaps = {};
        for (const [mapKey,row] of Object.entries(msg.maps).slice(0,80)) {
          if (!/^(campaign:\d{1,3}|bonus:[a-zA-Z0-9_-]{1,40}|pvp:\d{1,3})$/.test(String(mapKey)) || !row || typeof row !== 'object' || Array.isArray(row)) continue;
          const kills = Math.max(0, Math.floor(Number(row.kills) || 0)); const points = Math.max(0, Math.floor(Number(row.points) || 0));
          if (kills || points) cleanMaps[String(mapKey)] = {kills,points};
        }
        const guest = [...clients.values()].find(c => c.slot === targetSlot);
        if (guest && Object.keys(cleanMaps).length) send(guest, {type:'career_map_stat_batch',targetSlot,maps:cleanMaps});
      }
      break;
    case 'career_stat_event':
      if (matchStarted && client.slot === 1) {
        const targetSlot = Math.max(2, Math.min(3, Math.floor(Number(msg.targetSlot) || 0)));
        const allowed = new Set(['pointsEarned','casesEarned','kills','pvpKills','bossKills','campaignBossKills','bonusBossKills','deaths','shotsFired','damageDealt','damageTaken','levelsCleared','bonusLevelsCleared','portalsEntered','regularPortalsEntered','ultroPortalsEntered','pvpRoundsWon','campaignVictories','campaignDefeats','pvpVictories','pvpDefeats','bestMatchScore']);
        const key = String(msg.key || '');
        const guest = [...clients.values()].find(c => c.slot === targetSlot);
        if (guest && allowed.has(key)) send(guest, {type:'career_stat_event',targetSlot,key,amount:Number(msg.amount)||0,value:Number(msg.value)||0,mode:msg.mode==='max'?'max':'add'});
      }
      break;
    case 'dev_toggle':
      if (matchStarted && (client.slot === 2 || client.slot === 3)) {
        const host = [...clients.values()].find(c => c.slot === 1);
        send(host, {type:'dev_toggle', slot:client.slot, enabled:!!msg.enabled});
      }
      break;
    case 'statistics_pause':
      if (matchStarted && (client.slot === 2 || client.slot === 3)) {
        const host = [...clients.values()].find(c => c.slot === 1);
        send(host, {type:'statistics_pause', slot:client.slot, active:!!msg.active});
      }
      break;
    case 'supply_center_request':
      if (matchStarted && (client.slot === 2 || client.slot === 3)) {
        const host = [...clients.values()].find(c => c.slot === 1);
        const x = Number(msg.x), y = Number(msg.y);
        if (host && Number.isFinite(x) && Number.isFinite(y)) send(host, {type:'supply_center_request',slot:client.slot,x,y});
      }
      break;
    case 'nuclear_strike_request':
      if (matchStarted && (client.slot === 2 || client.slot === 3)) {
        const host = [...clients.values()].find(c => c.slot === 1);
        const x = Number(msg.x), y = Number(msg.y);
        if (host && Number.isFinite(x) && Number.isFinite(y)) send(host, {type:'nuclear_strike_request',slot:client.slot,x,y});
      }
      break;
    case 'profile_update': {
      client.tank = PLAYER_TANK_TYPES.has(msg.tank) ? msg.tank : client.tank;
      client.maxLives = Math.max(Number(client.maxLives) || 2, Math.max(2, Math.min(MAX_PLAYER_LIVES, Math.floor(Number(msg.maxLives) || 2))));
      client.baseUpgrades = Math.max(Number(client.baseUpgrades) || 0, Math.max(0, Math.min(5, Math.floor(Number(msg.baseUpgrades) || 0))));
      client.rocketeerKills = Math.max(
        Number(client.rocketeerKills) || 0,
        Math.max(0, Math.min(50, Math.floor(Number(msg.rocketeerKills) || 0)))
      );
      client.firstBossCleared = !!client.firstBossCleared || !!msg.firstBossCleared || !!msg.secondBossCleared || !!msg.thirdBossCleared || !!msg.fourthBossCleared;
      client.secondBossCleared = !!client.secondBossCleared || !!msg.secondBossCleared || !!msg.thirdBossCleared || !!msg.fourthBossCleared;
      client.thirdBossCleared = !!client.thirdBossCleared || !!msg.thirdBossCleared || !!msg.fourthBossCleared;
      client.fourthBossCleared = !!client.fourthBossCleared || !!msg.fourthBossCleared;
      client.level33Cleared = !!client.level33Cleared || !!msg.level33Cleared;
      client.financeLevel = Math.max(0, Math.min(3, Math.floor(Number(msg.financeLevel) || 0)));
      client.logisticsLevel = Math.max(0, Math.min(3, Math.floor(Number(msg.logisticsLevel) || 0)));
      client.techLevel = Math.max(0, Math.min(3, Math.floor(Number(msg.techLevel) || 0)));
      client.airportBuilt = !!msg.airportBuilt;
      client.supplyCenterBuilt = !!msg.supplyCenterBuilt;
      client.missileComplexBuilt = !!msg.missileComplexBuilt;
      client.portalBuilt = !!msg.portalBuilt;
      client.basePowered = !!msg.basePowered;
      const update = {
        type:'profile_update',
        slot:client.slot,
        name:client.name || `Игрок ${client.slot}`,
        tank:client.tank || 'standard',
        maxLives:client.maxLives || 2,
        baseUpgrades:client.baseUpgrades || 0,
        rocketeerKills:client.rocketeerKills || 0,
        firstBossCleared:!!client.firstBossCleared,
        secondBossCleared:!!client.secondBossCleared,
        thirdBossCleared:!!client.thirdBossCleared,
        fourthBossCleared:!!client.fourthBossCleared,
        level33Cleared:!!client.level33Cleared,
        financeLevel:Math.max(0,Math.min(3,Math.floor(Number(client.financeLevel)||0))),
        logisticsLevel:Math.max(0,Math.min(3,Math.floor(Number(client.logisticsLevel)||0))),
        techLevel:Math.max(0,Math.min(3,Math.floor(Number(client.techLevel)||0))),
        airportBuilt:!!client.airportBuilt,
        supplyCenterBuilt:!!client.supplyCenterBuilt,
        missileComplexBuilt:!!client.missileComplexBuilt,
        portalBuilt:!!client.portalBuilt,
        basePowered:!!client.basePowered,
        reason:String(msg.reason || 'profile_update').slice(0,32)
      };
      if (matchStarted) broadcast(update, client.id);
      else {
        client.ready = false;
        publishLobby();
      }
      break;
    }
    case 'return_to_lobby':
      if (matchStarted && client.slot === 1) returnMatchToLobby(String(msg.reason || 'mode_switch').slice(0,32));
      break;
    case 'return_lobby_request':
      if (matchStarted && (client.slot === 2 || client.slot === 3)) {
        const host = [...clients.values()].find(c => c.slot === 1);
        send(host, {type:'return_lobby_request', slot:client.slot, name:client.name || `Игрок ${client.slot}`});
      }
      break;
    case 'restart_request':
      if (matchStarted && (client.slot === 2 || client.slot === 3)) {
        const host = [...clients.values()].find(c => c.slot === 1);
        send(host, {type:'restart_request', slot:client.slot});
      }
      break;
    case 'restart_notice':
      if (client.slot === 1) broadcast({type:'restart_notice'}, client.id);
      break;
    case 'ping':
      send(client, {type:'pong', time:Date.now()});
      break;
  }
}

server.on('upgrade', (req, socket) => {
  if ((req.url || '').split('?')[0] !== '/ws') return socket.destroy();
  if (matchStarted || clients.size >= 3) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    return socket.destroy();
  }
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '\r\n'
  ].join('\r\n'));

  const usedSlots = new Set([...clients.values()].map(c=>c.slot));
  const slot = [1,2,3].find(candidate => !usedSlots.has(candidate));
  if (!slot) return socket.destroy();
  const client = {id: nextId++, slot, socket, buffer:Buffer.alloc(0), ready:false, name:'', tank:'standard', maxLives:2, baseUpgrades:0, rocketeerKills:0, firstBossCleared:false, secondBossCleared:false, thirdBossCleared:false, fourthBossCleared:false, level33Cleared:false, financeLevel:0, logisticsLevel:0, techLevel:0, airportBuilt:false, supplyCenterBuilt:false, missileComplexBuilt:false, portalBuilt:false, basePowered:false};
  clients.set(client.id, client);
  send(client, {type:'welcome', slot, host:slot===1, matchMode, difficulty:matchDifficulty});
  publishLobby();

  socket.on('data', chunk => parseFrames(client, chunk));
  socket.on('error', () => {});
  socket.on('close', () => {
    const departedSlot = client.slot;
    clients.delete(client.id);
    matchStarted = false;
    if (clients.size === 0) { matchMode = 'campaign'; matchDifficulty = 'easy'; }
    for (const c of clients.values()) c.ready = false;
    broadcast({type:'peer_left', slot:departedSlot});
    compactClientSlotsAndRoles();
    publishLobby();
  });
});

function localIPs() {
  const result = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if ((item.family === 'IPv4' || item.family === 4) && !item.internal && item.address !== '127.0.0.1' && !item.address.startsWith('169.254.')) result.push(item.address);
    }
  }
  return [...new Set(result)];
}


server.on('error', err => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Порт ${PORT} уже занят. Закрой другой LAN-сервер или перезапусти компьютер.`);
  } else {
    console.error('Ошибка LAN-сервера:', err);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const localUrl = `http://localhost:${PORT}/Ultra%20Tanks.html`;
  console.log('\n============================================');
  console.log(' Ultra Tanks LAN server запущен');
  console.log('============================================');
  console.log(`Хост открывает: ${localUrl}`);
  const ips = localIPs();
  if (ips.length) {
    console.log('\nССЫЛКА ДЛЯ ОСТАЛЬНЫХ ИГРОКОВ:');
    for (const ip of ips) console.log(`>>> http://${ip}:${PORT}/Ultra%20Tanks.html`);
  } else {
    console.log('\nЛокальный IPv4 не найден автоматически. Посмотри его командой ipconfig.');
  }
  console.log('\nМатч можно запустить для двух или трёх готовых игроков.');
  console.log('Для остановки сервера нажми Ctrl+C.\n');
  if (process.platform === 'win32') exec(`start "" "${localUrl}"`);
});
