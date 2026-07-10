// Shared Energy-Allocation control renderers. Both the battle EA panel (battle.html) and the EAF layout editor
// (verify.html) render controls with these, so the editor is pixel-identical to the game. Each returns an
// absolutely-positioned `.ctl` div (styled by eaf-panel.css) with the game's data-ea hooks; the editor just
// makes them draggable and ignores the hooks. `ctl(x,y,inner,extra)` positions by % of the art.
import { armLabel, canRoll, armTurns, rollCost } from './weapon-arming.js';

export const ctl = (x, y, inner, extra = '') => `<div class="ctl ${extra}" style="left:${x}%;top:${y}%">${inner}</div>`;
export const stepPair = (key, val, max) =>   // a −/+ button pair bound to a column key (clamped via sinkMax in the handler)
  `<button class="stepbtn" data-ea="step" data-key="${key}" data-d="-1"${val <= 0 ? ' disabled' : ''}>−</button><button class="stepbtn" data-ea="step" data-key="${key}" data-d="1"${val >= max ? ' disabled' : ''}>+</button>`;
export const stackCtl = (x, y, label, key, val, max) =>   // left-stack: label line, then [−] value [+] on the second line
  ctl(x, y, `<div class="lab">${label}</div><div class="row"><button class="stepbtn" data-ea="step" data-key="${key}" data-d="-1"${val <= 0 ? ' disabled' : ''}>−</button><span class="val">${val}</span><button class="stepbtn" data-ea="step" data-key="${key}" data-d="1"${val >= max ? ' disabled' : ''}>+</button></div>`);
export const barCtl = (x, y, lit, total) =>   // non-adjustable status bar (SENSORS), enlarged
  ctl(x, y, `<div class="statbar">${Array.from({ length: total }, (_, i) => `<i class="${i < lit ? 'on' : ''}"></i>`).join('')}</div>`, 'bigbar');
export const sysCtl = (x, y, key, val, max) =>   // bottom-strip: centered counter with the +/- buttons side by side on the right
  `<div class="ctl syscell" style="left:${x}%;top:${y}%"><span class="val">${val}</span><span class="vstep">` +
  `<button class="stepbtn" data-ea="step" data-key="${key}" data-d="-1"${val <= 0 ? ' disabled' : ''}>−</button>` +
  `<button class="stepbtn" data-ea="step" data-key="${key}" data-d="1"${val >= max ? ' disabled' : ''}>+</button></span></div>`;
export const batteryCtl = (x, y, charge, recharge, max) => {   // BATTERIES: current+charging / capacity; +/- allocate recharge, capped to empty batteries
  const total = charge + recharge, room = max - charge;
  return `<div class="ctl syscell" style="left:${x}%;top:${y}%"><span class="val">${total}/${max}</span><span class="vstep">` +
    `<button class="stepbtn" data-ea="step" data-key="recharge" data-d="-1"${recharge <= 0 ? ' disabled' : ''}>−</button>` +
    `<button class="stepbtn" data-ea="step" data-key="recharge" data-d="1"${recharge >= room ? ' disabled' : ''}>+</button></span></div>`;
};
export const ewCtl = (x, y, ecm, eccm, max) =>   // EW box: ECM/ECCM label, value/value counter, a −/+ pair on either side
  ctl(x, y, `<div class="lab">ECM/ECCM</div><div class="row">${stepPair('ecm', ecm, max)}<span class="val">${ecm}/${eccm}</span>${stepPair('eccm', eccm, max)}</div>`);
export const toggleCtl = (x, y, label, key, on, num) =>
  ctl(x, y, `<div class="lab">${label}</div><button class="${on ? 'on' : ''}" data-ea="toggle" data-key="${key}"${num ? ' data-num="1"' : ''}>${on ? 'ON' : 'OFF'}</button>`);
export function shieldCtl(n, x, y, strength, reinf, max, gen = 0) {
  const hl = reinf > 0 || gen > 0;   // highlight on specific OR general reinforcement (general lights all 6 — Rick)
  return ctl(x, y, `<div class="lab">SHLD ${n}</div><div class="val">${strength}${reinf ? '+' + reinf : ''}${gen ? `<span style="font-size:9px;opacity:.85"> +${gen}g</span>` : ''}</div>
    <div class="row"><button class="stepbtn" data-ea="specstep" data-shield="${n}" data-d="-1">−</button><button class="stepbtn" data-ea="specstep" data-shield="${n}" data-d="1"${reinf >= max ? ' disabled' : ''}>+</button></div>`, hl ? 'reinf' : '');
}
export function weaponCtl(x, y, w, st) {
  const name = w.cls === 'DISR' ? 'DISRUPTOR' : w.cls;   // full weapon name + SSD box label (A–D)
  return ctl(x, y, `<div class="lab">${name} ${w.label || ''}</div><div class="row"><button class="${st.armed ? 'on' : ''}" data-ea="weap" data-wid="${w.id}" data-what="armed" title="multi-turn arming (E4.21/FP1.21) — fires only when fully armed or held">${st.roll ? 'ROLL' : armLabel(w.cls, st.progress || 0)}</button>${w.plasma ? '' : `<button class="${st.overload ? 'on' : ''}" data-ea="weap" data-wid="${w.id}" data-what="overload">OL</button>`}${w.cls === 'PHOTON' ? `<button class="${st.prox ? 'on' : ''}" data-ea="weap" data-wid="${w.id}" data-what="prox">PX</button>` : ''}${canRoll(w.cls) && (st.progress || 0) === armTurns(w.cls) - 1 ? `<button class="${st.roll ? 'on' : ''}" data-ea="weap" data-wid="${w.id}" data-what="roll" title="rolling delay — stall one turn short of completion for ${rollCost(w.cls)} (FP1.221)">ROLL</button>` : ''}</div>`);
}
// phaser capacitor: spell it out, show existing (carried) charge, and never allow overcharging past capacity
export function capCtl(x, y, carried, charging, cap) {
  const total = carried + charging, room = cap - carried;
  return ctl(x, y, `<div class="lab">PHASERS (Held: ${carried})</div><div class="row"><button class="stepbtn" data-ea="step" data-key="phaserCap" data-d="-1"${charging <= 0 ? ' disabled' : ''}>−</button><span class="val">${total}/${cap}</span><button class="stepbtn" data-ea="step" data-key="phaserCap" data-d="1"${charging >= room ? ' disabled' : ''}>+</button></div>`);
}
export const segCtl = (x, y, label, key, val) =>
  ctl(x, y, `<div class="lab">${label}</div><div class="row">${[['OFF', 0], ['LO', 0.5], ['FUL', 1]].map(([t, v]) => `<button class="${val === v ? 'on' : ''}" data-ea="seg" data-key="${key}" data-val="${v}">${t}</button>`).join('')}</div>`);
