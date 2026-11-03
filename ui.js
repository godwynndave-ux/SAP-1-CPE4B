/* SAP-1 tactical HUD: renders the cpu.js model as a Valorant-style console. */
"use strict";
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];

// Register cards [id, codename]. The first four sit above the conduit (W-bus), the last four below it.
const CARDS = [["PC", "POINT COORDINATOR"], ["MAR", "MEMORY ADDRESS RELAYER"], ["RAM", "STORAGE VAULT"], ["IR", "INSTRUCTION RECEIVER"],
  ["A", "ACCUMULATOR CORE"], ["ALU", "Σ ADDER / SUBTRACTOR"], ["B", "BUFFER ARRAY"], ["OUT", "OUTPUT TERMINAL"]];
const IDX = Object.fromEntries(CARDS.map(([id], i) => [id, i]));
let image = Array(16).fill(0), kinds = [], cpu = newCpu(image), last = null, cur = null, done = new Set(), feed = [];
let timer = null, expect = null, eq = "", gen = "", sfx = false, ac = null;

/* ---- One-time DOM setup ---- */
const card = ([id, name]) => `<div class="reg" id="c-${id}"><h4>${id === "ALU" ? "Σ" : id}<small>${name}</small></h4><b class="hx" id="v-${id}"></b><span class="bn" id="n-${id}"></span><em></em></div>`;
$("#r1").innerHTML = CARDS.slice(0, 4).map(card).join(""); $("#r2").innerHTML = CARDS.slice(4).map(card).join("");
$("#core").innerHTML = Array.from({ length: 16 }, (_, i) => `<div class="cell" id="m-${i}"><i>${H(i, 1)}H</i><b></b></div>`).join("");
$("#led tbody").innerHTML = Array.from({ length: 16 }, (_, i) => `<tr><td>${H(i, 1)}H</td><td></td><td></td><td></td></tr>`).join("");
$("#orbs").innerHTML = [7, 6, 5, 4, 3, 2, 1, 0].map(b => `<span><i class="orb"></i>${1 << b}</span>`).join("");

/* ---- Plain-language briefing for each micro-operation ---- */
function intel(r, c) {
  const w = r.w, a = H(c.MAR, 1);
  const q = {
    "Ep,Lm": `PC dumps address ${H(w, 1)}H onto the Radianite Bus. MAR locks it in. Fetching instruction from slot ${H(w, 1)}H...`,
    "Cp": `PC advances to ${H(c.PC, 1)}H, so the next fetch targets slot ${H(c.PC, 1)}H.`,
    "CE,Li": `Slot ${a}H replies with ${H(w)}H. IR splits it: opcode ${B(w >> 4, 4)} (${NAME[w >> 4] || "unknown"}) and operand ${H(w & 15, 1)}H.`,
    "Ei,Lm": `IR hands operand ${H(w, 1)}H to MAR over the bus. The data lives in slot ${H(w, 1)}H.`,
    "CE,La": `Slot ${a}H sends ${H(w)}H down the conduit. Accumulator Core A loads it.`,
    "CE,Lb": `Slot ${a}H sends ${H(w)}H down the conduit. Buffer Array B loads it.`,
    "Eu,La": `Σ adds A and B. Result ${H(w)}H rides the bus into Accumulator Core A.`,
    "Su,Eu,La": `Σ flips B and adds 1 (2’s complement), so A − B = ${H(w)}H. The result rides the bus into A.`,
    "Ea,Lo": `A broadcasts ${H(w)}H. The Output Terminal latches it and the orbs light up: ${B(w, 8)}.`,
    "HLT": c.err || "HLT received. Clock disabled. Mission complete."
  };
  return q[r.ctl.join()] || "No work for this instruction in this timing slot. Standing by.";
}

/* ---- Rendering: copies model state to the screen ---- */
function render() {
  const c = cpu, t = last ? last.t : 0, fetched = c.clk > 2, on = !!(last && last.src);
  const put = (id, hex, bin) => { $("#v-" + id).textContent = hex; $("#n-" + id).textContent = bin; };
  put("PC", H(c.PC, 1) + "H", B(c.PC, 4)); put("MAR", H(c.MAR, 1) + "H", B(c.MAR, 4)); put("RAM", H(c.ram[c.MAR]) + "H", B(c.ram[c.MAR], 8));
  put("IR", fetched ? mnemonic(c.IR) : "—", `${B(c.IR >> 4, 4)}|${B(c.IR & 15, 4)}`);
  put("A", H(c.A) + "H", B(c.A, 8)); put("B", H(c.B) + "H", B(c.B, 8)); put("OUT", H(c.OUT) + "H", B(c.OUT, 8));
  const su = fetched && c.IR >> 4 === 2;
  put("ALU", H(alu(c.A, c.B, su)) + "H", `${H(c.A)} ${su ? "−" : "+"} ${H(c.B)}`);
  $$(".orb").forEach((e, i) => e.classList.toggle("on", ((c.OUT >> (7 - i)) & 1) === 1));

  // Core storage cells and ledger rows (cyan = MAR address, red = RAM being read, red bar = executing)
  const reading = !!last && last.src === "RAM";
  c.ram.forEach((v, i) => {
    const e = $("#m-" + i); e.classList.toggle("pc", i === c.PC); e.classList.toggle("mar", i === c.MAR); e.classList.toggle("rd", reading && i === c.MAR); e.lastChild.textContent = H(v);
  });
  [...$("#led tbody").rows].forEach((tr, i) => {
    const k = kinds[i], v = c.ram[i], run = i === cur && !done.has(i) && !c.err;
    tr.cells[1].textContent = k === "i" ? mnemonic(v) : k === "d" ? `${H(v)}H DATA` : "--";
    tr.cells[2].textContent = `${B(v >> 4, 4)} ${B(v & 15, 4)}`;
    tr.cells[3].textContent = k === "i" ? (run ? `EXECUTING // T${t}` : done.has(i) ? "COMPLETED" : "QUEUED") : k === "d" ? (reading && i === c.MAR ? `READ // T${t}` : "DATA") : "";
    tr.className = run ? "exec" : done.has(i) ? "done" : i === c.MAR ? "mar" : "";
  });

  // Bus transfer: cyan TX/RX cards and taps; PC count-up is a red clock pulse
  $$(".reg").forEach(e => { e.classList.remove("src", "dst", "clk"); e.lastChild.textContent = ""; });
  $$(".tapc b").forEach(e => e.classList.remove("hot"));
  const mark = (id, cls, txt, tap) => {
    const e = $("#c-" + id); e.classList.add(cls); e.lastChild.textContent = txt;
    if (tap) $("#tap" + (IDX[id] & 3)).children[IDX[id] >> 2].classList.add("hot");
  };
  if (on) { mark(last.src, "src", "▶ TX", 1); mark(last.dst, "dst", "◀ RX", 1); }
  else if (last && last.dst) mark(last.dst, "clk", "▲ CLOCK +1", 0);
  $("#conduit").classList.toggle("on", on);
  if (on) fly(last); else { $("#tok").getAnimations().forEach(a => a.cancel()); $("#tok").style.opacity = 0; }

  // Timing generator, header phase, control word
  $$(".node").forEach((e, i) => { e.classList.toggle("on", t === i + 1); e.classList.toggle("chg", i + 1 < t); });
  const ph = !t ? "" : t < 3 ? "f" : t === 3 ? "d" : "x";
  ["f", "d", "x"].forEach(k => $("#ph-" + k).classList.toggle("on", ph === k));
  $("#cw").textContent = last ? `CONTROL WORD: ${last.ctl.join(" ") || "NONE"} // ${last.txt}` : "CONTROL WORD: NONE";
  $("#feed").innerHTML = feed.slice(-80).join(""); $("#feed").scrollTop = $("#feed").scrollHeight;

  // Status bar
  const total = kinds.filter(k => k === "i").length, n = done.size + (cur !== null && !done.has(cur) ? 1 : 0);
  const op = c.err ? "FAULT" : c.halted ? "MISSION COMPLETE" : t < 3 ? "FETCHING..." : t === 3 ? "DECODING..." : "EXECUTING...";
  $("#op").textContent = `🔥 CURRENT OPERATION: ${last ? `STEP ${n}/${total} — ${op}` : "STANDBY — AWAITING COMMAND..."}`;
  $("#f1").textContent = `PC=${H(c.PC, 1)}H`; $("#f2").textContent = t ? `T${t} - ${t < 3 ? "FETCH" : t === 3 ? "DECODE" : "EXECUTE"}` : "T0 - IDLE"; $("#f3").textContent = `BUS=${on ? H(last.w) + "H" : "IDLE"}`;

  const res = $("#res");
  if (c.halted && c.err) { res.textContent = c.err; res.className = "cap bad"; }
  else if (c.halted) {
    const hit = expect === null || expect === c.OUT;
    res.textContent = `MISSION COMPLETE // OUT = ${H(c.OUT)}H (${c.OUT})` + (expect === null ? "" : hit ? ` // ${eq} = ${H(expect)}H ✓` : ` // EXPECTED ${H(expect)}H ✗`);
    res.className = "cap " + (hit ? "ok" : "bad");
  } else { res.textContent = eq ? `MISSION: ${eq}` : ""; res.className = "cap"; }
  ["#st", "#sc", "#run", "#pz"].forEach(s => { $(s).disabled = c.halted; });
}

// Floating data token travels along the conduit from the source card's column to the destination's
function fly(r) {
  const tok = $("#tok"), box = $("#conduit").getBoundingClientRect();
  const x = id => { const b = $("#c-" + id).getBoundingClientRect(); return b.left + b.width / 2 - box.left; };
  const dur = matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : Math.min(+$("#hz").value * 0.8, 900);
  tok.getAnimations().forEach(a => a.cancel());
  tok.textContent = H(r.w) + "H"; tok.style.opacity = 1;
  tok.animate([{ transform: `translate(calc(${x(r.src)}px - 50%), -50%)` }, { transform: `translate(calc(${x(r.dst)}px - 50%), -50%)` }], { duration: dur, easing: "ease-in-out", fill: "forwards" });
}

/* ---- Tactical SFX (optional, off by default): metallic hover click, high-tech ping ---- */
function beep(f, d, type = "square", v = .03) {
  if (!sfx) return;
  ac = ac || new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === "suspended") ac.resume();
  const o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime;
  o.type = type; o.frequency.value = f; g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(.0001, t0 + d);
  o.connect(g).connect(ac.destination); o.start(); o.stop(t0 + d);
}

/* ---- Controls ---- */
function clock() { // one T-state pulse
  if (cpu.halted) return;
  last = tick(cpu);
  if (last.t === 1) cur = cpu.MAR;                                  // address of the instruction being fetched
  if (cpu.T === 0 || (cpu.halted && !cpu.err)) done.add(cur);       // instruction finished
  feed.push(`<li><b>T${last.t}</b>🎯 INTEL: ${intel(last, cpu)}</li>`);
  if (cpu.clk >= 2000 && !cpu.halted) { cpu.halted = true; cpu.err = "FAULT: 2000 pulses without HLT. Clock disabled."; }
  beep(cpu.halted ? 520 : 1320, .1, "sine", .05);
  render();
}
function step() { do { clock(); } while (!cpu.halted && cpu.T !== 0); } // one whole instruction
function syncRun() { $("#run b").textContent = timer ? "PAUSE" : "EXECUTE"; $("#pz").textContent = timer ? "▶ LIVE" : "|| PAUSED"; $("#pz").setAttribute("aria-pressed", String(!timer)); }
function stop() { clearInterval(timer); timer = null; syncRun(); }
function run() {
  if (timer) return stop();
  if (cpu.halted) return;
  timer = setInterval(() => { clock(); if (cpu.halted) stop(); }, +$("#hz").value); syncRun();
}
function reset() {
  stop(); cpu = newCpu(image); last = null; cur = null; done = new Set();
  feed = ["<li>🎯 INTEL: Systems online. Press STEP or T-CYCLE to begin the first fetch from slot 0H.</li>"]; render();
}

/* ---- Loading programs ---- */
const say = (m, bad) => { const e = $("#msg"); e.textContent = m; e.className = bad ? "bad" : "ok"; };
function load() {
  const { m, kind, err } = assembleSlots($("#ed").value);
  if (err.length) return say(err.join(" "), true);
  image = m; kinds = kind; $("#ed").readOnly = true; reset();
  say(`LOADOUT LOCKED: ${kind.filter(k => k === "i").length} instructions, ${kind.filter(k => k === "d").length} data bytes. Press STEP or EXECUTE.`);
}
function loadFormula() { // validate X, Y, Z, then generate the 16 slots from them
  const ids = ["x", "y", "z"], raw = ids.map(i => $("#" + i).value.trim().replace(/h$/i, "")), good = raw.map(s => /^[0-9a-f]{1,2}$/i.test(s));
  ids.forEach((id, k) => $("#" + id).setAttribute("aria-invalid", String(!good[k])));
  if (good.includes(false)) return say(`ENTER ${ids.filter((_, k) => !good[k]).map(s => s.toUpperCase()).join(" AND ")} AS 1–2 HEX DIGITS (00–FF), E.G. 25 OR 3C.`, true);
  const [x, y, z] = raw.map(s => parseInt(s, 16)), a = $("#o1").value, b = $("#o2").value, sym = o => (o === "+" ? "+" : "−");
  const p = assemble(prog(x, a, y, b, z));
  $("#ed").value = gen = slotsText(p.m, p.kind);
  expect = (x + (a === "+" ? y : -y) + (b === "+" ? z : -z)) & 255; // independent check of the simulator's answer
  eq = `${H(x)}H ${sym(a)} ${H(y)}H ${sym(b)} ${H(z)}H`;
  load();
}

/* ---- Diagnostics (inside the System Protocol dialog) ---- */
function diagnostics() {
  const sym = o => (o === "+" ? "+" : "−");
  const rows = TESTS.map(([x, a, y, b, z, want]) => {
    const got = runToHalt(assemble(prog(x, a, y, b, z)).m).OUT, ok = got === want;
    return { ok, li: `<li class="${ok ? "ok" : "bad"}">${ok ? "✓" : "✗"} ${H(x)}H ${sym(a)} ${H(y)}H ${sym(b)} ${H(z)}H = ${H(got)}H (expected ${H(want)}H)</li>` };
  });
  $("#tl").innerHTML = rows.map(r => r.li).join(""); $("#ts").textContent = `${rows.filter(r => r.ok).length}/${rows.length} PASSED`;
}

/* ---- Wiring ---- */
$("#st").onclick = step; $("#sc").onclick = clock; $("#run").onclick = run; $("#pz").onclick = run; $("#rs").onclick = reset;
$("#lf").onclick = loadFormula; $("#tb").onclick = diagnostics;
$("#ld").onclick = () => { if ($("#ed").value !== gen) { expect = null; eq = ""; } load(); };
$("#edit").onclick = () => { $("#ed").readOnly = false; $("#ed").focus(); say("EDIT MODE: change any slot, then press LOAD INSTRUCTIONS."); };
$("#hz").oninput = e => { $("#hzv").textContent = e.target.value + " MS"; if (timer) { stop(); run(); } };
$("#sfx").onclick = e => { sfx = !sfx; e.currentTarget.setAttribute("aria-pressed", String(sfx)); e.currentTarget.textContent = `🔊 TACTICAL SFX: ${sfx ? "ON" : "OFF"}`; beep(880, .12, "sine", .05); };
$$("[data-dlg]").forEach(b => { b.onclick = () => $("#" + b.dataset.dlg).showModal(); });
document.addEventListener("pointerover", e => { const b = e.target.closest && e.target.closest("button"); if (b && !b.disabled && !b.contains(e.relatedTarget)) beep(2600, .025); });
loadFormula(); // open with the primary test case (25H + 05H − 23H) loaded
