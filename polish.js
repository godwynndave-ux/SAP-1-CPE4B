/* polish.js: load AFTER ui.js. Refines intel copy, bus-token FX, feed scrolling and run-control timing. cpu.js is untouched. */
(() => {
"use strict";
const calm = matchMedia("(prefers-reduced-motion: reduce)");
const syncClk = () => document.documentElement.style.setProperty("--clk", $("#hz").value + "ms"); // T-node and glow pulses follow the clock

/* Intel copy. r.w is null on T2 (PC count-up), so default it: the original built every message eagerly and H(null) threw there. */
intel = (r, c) => {
  const w = r.w ?? 0, a = H(c.MAR, 1), q = {
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
};

/* Bus token with a neon tail. The tail trails the travel direction; same-column hops (RAM → B) pulse in place. */
fly = r => {
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
};

/* Intel feed: append only new lines (no innerHTML rebuild), cap at 80, follow the newest line only while the reader is at the bottom. */
let feedSrc = null, shown = 0;
window.pushFeed = force => {
  const ol = $("#feed");
  if (force || feedSrc !== feed || feed.length < shown) { ol.replaceChildren(); shown = 0; feedSrc = feed; ol.setAttribute("aria-relevant", "additions"); }
  if (feed.length === shown) return;
  const pinned = force || ol.scrollHeight - ol.scrollTop - ol.clientHeight < 32;
  ol.insertAdjacentHTML("beforeend", feed.slice(shown).join("")); shown = feed.length;
  while (ol.childElementCount > 80) ol.firstElementChild.remove();
  if (pinned) requestAnimationFrame(() => ol.scrollTo({ top: ol.scrollHeight, behavior: calm.matches || force ? "auto" : "smooth" }));
};

/* Run control: one self-rescheduling timer (slider changes apply on the next pulse); every manual control pauses auto-run first. */
const loop = () => { timer = setTimeout(() => { try { clock(); } catch (e) { stop(); throw e; } cpu.halted ? stop() : loop(); }, +$("#hz").value); };
run = () => { if (timer) return stop(); if (cpu.halted) return; loop(); syncRun(); };
$("#run").onclick = $("#pz").onclick = () => run();
$("#st").onclick = () => { stop(); step(); };
$("#sc").onclick = () => { stop(); clock(); };
$("#hz").oninput = e => { $("#hzv").textContent = e.target.value + " MS"; syncClk(); };
$$("[data-dlg]").forEach(b => { b.onclick = () => { stop(); $("#" + b.dataset.dlg).showModal(); }; });
syncClk(); pushFeed(true);
})();
