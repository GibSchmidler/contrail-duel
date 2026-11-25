// Nose art: a small painted design plus an optional name, drawn onto a canvas that becomes a
// decal on both sides of the jet's nose. The nose points left on the canvas (flip for the right side).
export const ART = {
  none: 'None', shark: 'Shark mouth', flames: 'Flames', bolt: 'Lightning bolt', checker: 'Checkerboard',
  star: 'Star', skull: 'Skull', ace: 'Ace of spades', stripes: 'Tiger stripes', kills: 'Kill marks',
};
export const ART_COLORS = ['#ffffff', '#ffd23f', '#ff4b3a', '#3fa0ff', '#59e07a', '#c77dff', '#111111'];

export function sanitizeArt(a) {
  if (!a || typeof a !== 'object') return null;
  const d = ART[a.d] ? a.d : 'none';
  const c = ART_COLORS.includes(a.c) ? a.c : ART_COLORS[0];
  const text = typeof a.text === 'string' ? a.text.replace(/[^\w \-!'.&]/g, '').slice(0, 14) : '';
  return d === 'none' && !text ? null : { d, c, text };
}

export function drawArt(ctx, w, h, art, flip = false) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  if (flip) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  const c = art.c || '#ffffff';
  const S = h / 100;                      // design units: 160 x 100
  ctx.scale(S, S);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  switch (art.d) {
    case 'shark': {
      // open mouth along the bottom of the nose, teeth, and an eye above
      ctx.fillStyle = '#c0121a';
      ctx.beginPath(); ctx.moveTo(4, 62); ctx.quadraticCurveTo(60, 40, 128, 50); ctx.quadraticCurveTo(70, 98, 4, 62); ctx.fill();
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 9; i++) {
        const x = 12 + i * 12;
        ctx.beginPath(); ctx.moveTo(x, 54 - i * 0.3); ctx.lineTo(x + 6, 63); ctx.lineTo(x + 12, 53 - i * 0.3); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x, 79 - i * 1.6); ctx.lineTo(x + 6, 69 - i * 1.1); ctx.lineTo(x + 12, 78 - i * 1.6); ctx.fill();
      }
      ctx.strokeStyle = '#111'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(4, 62); ctx.quadraticCurveTo(60, 40, 128, 50); ctx.quadraticCurveTo(70, 98, 4, 62); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(60, 32, 9, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(57, 32, 4, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'flames': {
      const tongue = (y, len, col) => {
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(6, y - 9);
        ctx.quadraticCurveTo(len * 0.5, y - 14, len, y - 2); ctx.quadraticCurveTo(len * 0.55, y - 2, len * 0.75, y + 7);
        ctx.quadraticCurveTo(len * 0.4, y + 6, 6, y + 9); ctx.closePath(); ctx.fill();
      };
      tongue(30, 120, '#ff4b1a'); tongue(52, 150, '#ff7a1a'); tongue(74, 110, '#ff4b1a');
      tongue(32, 80, '#ffd23f'); tongue(53, 104, '#ffd23f'); tongue(73, 70, '#ffd23f');
      break;
    }
    case 'bolt': {
      ctx.fillStyle = c; ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(8, 44); ctx.lineTo(70, 34); ctx.lineTo(62, 48); ctx.lineTo(150, 38); ctx.lineTo(86, 62); ctx.lineTo(92, 50); ctx.lineTo(8, 60); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'checker': {
      for (let i = 0; i < 12; i++) for (let j = 0; j < 4; j++) {
        ctx.fillStyle = (i + j) % 2 ? c : '#111';
        ctx.fillRect(10 + i * 11, 28 + j * 11, 11, 11);
      }
      break;
    }
    case 'star': {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(46, 48, 30, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c === '#ffffff' ? '#3fa0ff' : c; ctx.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 11 : 27, a = -Math.PI / 2 + (i * Math.PI) / 5; ctx.lineTo(46 + Math.cos(a) * r, 48 + Math.sin(a) * r); }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = c === '#ffffff' ? '#3fa0ff' : c; ctx.fillRect(80, 40, 70, 7); ctx.fillStyle = '#ff4b3a'; ctx.fillRect(80, 50, 70, 7);
      break;
    }
    case 'skull': {
      ctx.fillStyle = c; ctx.strokeStyle = '#111'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(48, 40, 26, Math.PI * 0.9, Math.PI * 2.1); ctx.lineTo(66, 64); ctx.lineTo(30, 64); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillRect(34, 62, 28, 12); ctx.strokeRect(34, 62, 28, 12);
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.ellipse(38, 44, 7, 8, 0, 0, Math.PI * 2); ctx.ellipse(58, 44, 7, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(48, 52); ctx.lineTo(44, 60); ctx.lineTo(52, 60); ctx.fill();
      for (let i = 0; i < 3; i++) ctx.fillRect(40 + i * 7, 63, 2, 11);
      ctx.strokeStyle = c; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(12, 78); ctx.lineTo(84, 92); ctx.moveTo(84, 78); ctx.lineTo(12, 92); ctx.stroke();
      break;
    }
    case 'ace': {
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(18, 14, 52, 74, 6) : ctx.rect(18, 14, 52, 74); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#111'; ctx.beginPath();
      ctx.moveTo(44, 30); ctx.bezierCurveTo(30, 44, 26, 52, 34, 58); ctx.bezierCurveTo(40, 62, 43, 58, 44, 55);
      ctx.bezierCurveTo(45, 58, 48, 62, 54, 58); ctx.bezierCurveTo(62, 52, 58, 44, 44, 30); ctx.fill();
      ctx.beginPath(); ctx.moveTo(44, 54); ctx.lineTo(39, 70); ctx.lineTo(49, 70); ctx.fill();
      ctx.font = 'bold 13px Georgia, serif'; ctx.fillText('A', 22, 28);
      break;
    }
    case 'stripes': {
      ctx.fillStyle = c === '#ffffff' ? '#ff9a1a' : c;
      ctx.beginPath(); ctx.moveTo(4, 26); ctx.lineTo(156, 26); ctx.lineTo(156, 72); ctx.lineTo(4, 72); ctx.fill();
      ctx.fillStyle = '#111';
      for (let i = 0; i < 7; i++) { const x = 14 + i * 21; ctx.beginPath(); ctx.moveTo(x, 26); ctx.lineTo(x + 12, 26); ctx.lineTo(x + 4, 50); ctx.lineTo(x + 10, 72); ctx.lineTo(x - 2, 72); ctx.lineTo(x - 6, 48); ctx.fill(); }
      break;
    }
    case 'kills': {
      // rows of little star kill marks
      ctx.fillStyle = c;
      for (let r = 0; r < 2; r++) for (let i = 0; i < 6; i++) {
        const cx = 16 + i * 22, cy = 34 + r * 22;
        ctx.beginPath();
        for (let k = 0; k < 10; k++) { const rr = k % 2 ? 3.6 : 9, a = -Math.PI / 2 + (k * Math.PI) / 5; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
        ctx.closePath(); ctx.fill();
      }
      break;
    }
  }
  if (art.text) {
    ctx.font = 'italic bold 22px "Trebuchet MS", "Segoe UI", sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 4; ctx.strokeStyle = c === '#111111' ? '#ffffff' : '#111';
    const tx = art.d === 'none' ? 8 : art.d === 'skull' || art.d === 'ace' || art.d === 'star' ? 84 : 10;
    const ty = art.d === 'none' ? 60 : art.d === 'skull' || art.d === 'ace' || art.d === 'star' ? 34 : 97;
    if (flip) { ctx.save(); ctx.translate(160, 0); ctx.scale(-1, 1); }
    const x = flip ? 160 - tx - Math.min(150, ctx.measureText(art.text).width) : tx;
    ctx.strokeText(art.text, x, ty, 150 - (tx > 50 ? 76 : 0)); ctx.fillStyle = c; ctx.fillText(art.text, x, ty, 150 - (tx > 50 ? 76 : 0));
    if (flip) ctx.restore();
  }
  ctx.restore();
}
