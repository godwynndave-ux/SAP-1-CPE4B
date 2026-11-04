/* SAP-1 tactical HUD: renders the cpu.js model as a Valorant-style console. Pairs with style.css + polish.css. */
"use strict";
// Elements are created once at startup, so lookups are cached (render() runs on every clock pulse).
const memo = new Map(), memoAll = new Map();
const $ = s => memo.get(s) || (memo.set(s, document.querySelector(s)), memo.get(s));
const $$ = s => memoAll.get(s) || (memoAll.set(s, [...document.querySelectorAll(s)]), memoAll.get(s));
const calm = matchMedia("(prefers-reduced-motion: reduce)");

// Register cards [id, codename]. The first four sit above the conduit (W-bus), the last four below it.
const CARDS = [["PC", "POINT COORDINATOR"], ["MAR", "MEMORY ADDRESS RELAYER"], ["RAM", "STORAGE VAULT"], ["IR", "INSTRUCTION RECEIVER"],
  ["A", "ACCUMULATOR CORE"], ["ALU", "Σ ADDER / SUBTRACTOR"], ["B", "BUFFER ARRAY"], ["OUT", "OUTPUT TERMINAL"]];
const IDX = Object.fromEntries(CARDS.map(([id], i) => [id, i]));
let image = Array(16).fill(0), kinds = [], cpu = newCpu(image), last = null, cur = null, done = new Set(), feed = []; // feed = queue of <li> not yet on screen
let timer = null, expect = null, eq = "", gen = "", sfx = false, ac = null;

/* ---- One-time DOM setup ---- */
const card = ([id, name]) => `<div class="reg" id="c-${id}"><h4>${id === "ALU" ? "Σ" : id}<small>${name}</small></h4><b class="hx" id="v-${id}"></b><span class="bn" id="n-${id}"></span><em></em></div>`;
$("#r1").innerHTML = CARDS.slice(0, 4).map(card).join(""); $("#r2").innerHTML = CARDS.slice(4).map(card).join("");
$("#core").innerHTML = Array.from({ length: 16 }, (_, i) => `<div class="cell" id="m-${i}"><i>${H(i, 1)}H</i><b></b></div>`).join("");
$("#led tbody").innerHTML = Array.from({ length: 16 }, (_, i) => `<tr><td>${H(i, 1)}H</td><td></td><td></td><td></td></tr>`).join("");
$("#orbs").innerHTML = [7, 6, 5, 4, 3, 2, 1, 0].map(b => `<span><i class="orb"></i>${1 << b}</span>`).join("");
$("#feed").setAttribute("aria-relevant", "additions"); // screen readers hear new lines only

/* ---- Intel briefing: what moved, from where, to where. r.w is null on T2 (PC count-up), so it defaults to 0 before the messages are built. ---- */
function intel(r, c) {
  const w = r.w ?? 0, a = H(c.MAR, 1);
  const q = {
    "Ep,Lm": `PC drops address ${H(w, 1)}H on the W-bus. MAR locks it in, so RAM slot ${H(w, 1)}H is the target.`,
    "Cp": `PC counts up to ${H(c.PC, 1)}H. The next fetch will target RAM slot ${H(c.PC, 1)}H.`,
    "CE,Li": `Instruction fetched from RAM slot ${a}H to IR (Instruction Receiver): opcode ${B(w >> 4, 4)} = ${NAME[w >> 4] || "unknown"}, operand ${H(w & 15, 1)}H.`,
    "Ei,Lm": `IR hands operand ${H(w, 1)}H to MAR. The data you need is in RAM slot ${H(w, 1)}H.`,
    "CE,La": `RAM slot ${a}H sends ${H(w)}H down the W-bus. Accumulator A loads it.`,
    "CE,Lb": `RAM slot ${a}H sends ${H(w)}H down the W-bus. Buffer B loads it.`,
    "Eu,La": `Σ computes A + B = ${H(w)}H. The sum rides the W-bus into Accumulator A.`,
    "Su,Eu,La": `Σ inverts B and adds 1 (2’s complement), so A − B = ${H(w)}H. The difference rides the W-bus into A.`,
    "Ea,Lo": `A broadcasts ${H(w)}H. The Output Terminal latches it and the orbs show ${B(w, 8)}.`,
    "HLT": c.err || "HLT received. Clock disabled. Mission complete."
  };
  return q[r.ctl.join()] || "No data moves in this T-state. Standing by.";
}

// Intel feed: append only the queued lines (no innerHTML rebuild), keep the last 80, and follow the newest line only while the reader is at the bottom.
function flushFeed(clear) {
  const ol = $("#feed");
  if (clear) ol.replaceChildren();
  if (!feed.length) return;
  const pinned = clear || ol.scrollHeight - ol.scrollTop - ol.clientHeight < 32;
  ol.insertAdjacentHTML("beforeend", feed.splice(0).join(""));
  while (ol.childElementCount > 80) ol.firstElementChild.remove();
  if (pinned) requestAnimationFrame(() => ol.scrollTo({ top: ol.scrollHeight, behavior: clear || calm.matches ? "auto" : "smooth" }));
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
  if (on) fly(last); else { $("#tok").getAnimations({ subtree: true }).forEach(a => a.cancel()); $("#tok").style.opacity = 0; }

  // Timing generator, header phase, control word, intel feed
  $$(".node").forEach((e, i) => { e.classList.toggle("on", t === i + 1); e.classList.toggle("chg", i + 1 < t); });
  const ph = !t ? "" : t < 3 ? "f" : t === 3 ? "d" : "x";
  ["f", "d", "x"].forEach(k => $("#ph-" + k).classList.toggle("on", ph === k));
  $("#cw").textContent = last ? `CONTROL WORD: ${last.ctl.join(" ") || "NONE"} // ${last.txt}` : "CONTROL WORD: NONE";
  flushFeed();

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

// Data token glides along the conduit from the source card's column to the destination's, trailing a neon tail (polish.css draws it).
// Same-column hops (RAM → B) pulse in place instead.
function fly(r) {
  const tok = $("#tok"), box = $("#conduit").getBoundingClientRect();
  const cx = id => { const b = $("#c-" + id).getBoundingClientRect(); return b.left + b.width / 2 - box.left; };
  const x0 = cx(r.src), x1 = cx(r.dst), still = Math.abs(x1 - x0) < 2, at = x => `translate(calc(${x}px - 50%), -50%)`;
  tok.getAnimations({ subtree: true }).forEach(a => a.cancel());
  tok.textContent = H(r.w) + "H"; tok.dataset.dir = x1 < x0 ? "l" : "r"; tok.style.opacity = 1;
  if (calm.matches) return void (tok.style.transform = at(x1));
  const dur = Math.max(80, Math.min(+$("#hz").value * 0.8, 900));
  tok.animate(still ? [{ transform: at(x0) + " scale(.6)" }, { transform: at(x0) + " scale(1.2)", offset: .5 }, { transform: at(x0) + " scale(1)" }]
    : [{ transform: at(x0) }, { transform: at(x1) }], { duration: dur, easing: "cubic-bezier(.65,0,.35,1)", fill: "forwards" });
  if (!still) tok.animate([{ transform: "scaleX(.2)", opacity: .9 }, { transform: "scaleX(1)", opacity: .9, offset: .2 },
    { transform: "scaleX(1)", opacity: .9, offset: .75 }, { transform: "scaleX(0)", opacity: 0 }], { duration: dur, easing: "linear", fill: "forwards", pseudoElement: "::before" });
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

/* ---- Controls: the model advances first, then the screen redraws, all in one synchronous call ---- */
function clock() { // one T-state pulse
  if (cpu.halted) return;
  last = tick(cpu);
  if (last.t === 1) cur = cpu.MAR;                                  // address of the instruction being fetched
  if (cpu.T === 0 || (cpu.halted && !cpu.err)) done.add(cur);       // instruction finished
  feed.push(`<li><b>T${last.t}</b>🎯 INTEL: ${intel(last, cpu)}</li>`);
  beep(cpu.halted ? 520 : 1320, .1, "sine", .05);
  render();
}
function step() { do { clock(); } while (!cpu.halted && cpu.T !== 0); } // one whole instruction
const syncClk = () => document.documentElement.style.setProperty("--clk", $("#hz").value + "ms"); // glow and T-node pulses follow the clock
function syncRun() { $("#run b").textContent = timer ? "PAUSE" : "EXECUTE"; $("#pz").textContent = timer ? "▶ LIVE" : "|| PAUSED"; $("#pz").setAttribute("aria-pressed", String(!timer)); }
function stop() { clearTimeout(timer); timer = null; syncRun(); }
function run() { // one self-rescheduling timer: slider changes apply on the next pulse and pulses can never overlap
  if (timer) return stop();
  if (cpu.halted) return;
  const beat = () => { timer = setTimeout(() => { try { clock(); } catch (e) { stop(); throw e; } cpu.halted ? stop() : beat(); }, +$("#hz").value); };
  beat(); syncRun();
}
const manual = fn => () => { stop(); fn(); }; // any hands-on control pauses auto-run first
function reset() {
  stop(); cpu = newCpu(image); last = null; cur = null; done = new Set();
  feed = ["<li>🎯 INTEL: Systems online. Press STEP or T-CYCLE to begin the first fetch from RAM slot 0H.</li>"]; flushFeed(true); render();
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
$("#st").onclick = manual(step); $("#sc").onclick = manual(clock); $("#run").onclick = $("#pz").onclick = run; $("#rs").onclick = reset;
$("#lf").onclick = loadFormula; $("#tb").onclick = diagnostics;
$("#ld").onclick = () => { if ($("#ed").value !== gen) { expect = null; eq = ""; } load(); };
$("#edit").onclick = () => { $("#ed").readOnly = false; $("#ed").focus(); say("EDIT MODE: change any slot, then press LOAD INSTRUCTIONS."); };
$("#hz").oninput = e => { $("#hzv").textContent = e.target.value + " MS"; syncClk(); };
$("#sfx").onclick = e => { sfx = !sfx; e.currentTarget.setAttribute("aria-pressed", String(sfx)); e.currentTarget.textContent = `🔊 TACTICAL SFX: ${sfx ? "ON" : "OFF"}`; beep(880, .12, "sine", .05); };
$$("[data-dlg]").forEach(b => { b.onclick = () => { stop(); $("#" + b.dataset.dlg).showModal(); }; }); // the clock waits while a dialog is open
document.addEventListener("pointerover", e => { const b = e.target.closest && e.target.closest("button"); if (b && !b.disabled && !b.contains(e.relatedTarget)) beep(2600, .025); });
syncClk(); loadFormula(); // open with the primary test case (25H + 05H − 23H) loaded