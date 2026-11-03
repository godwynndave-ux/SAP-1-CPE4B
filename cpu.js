/* SAP-1 core model: pure logic, no DOM. Loaded by ui.js (browser) and test.js (Node). */
"use strict";

// Instruction set: opcode (upper nibble) and whether the operand nibble is an address.
const OPS = { LDA: { c: 0, arg: 1 }, ADD: { c: 1, arg: 1 }, SUB: { c: 2, arg: 1 }, OUT: { c: 14, arg: 0 }, HLT: { c: 15, arg: 0 } };
const NAME = Object.fromEntries(Object.entries(OPS).map(([k, v]) => [v.c, k]));
const H = (v, d = 2) => v.toString(16).toUpperCase().padStart(d, "0");                   // hex text
const B = (v, n) => v.toString(2).padStart(n, "0").replace(/(?=(?:....)+$)/g, " ").trim(); // binary, grouped by nibble
const mnemonic = v => { const n = NAME[v >> 4]; return n ? n + (OPS[n].arg ? " " + H(v & 15, 1) + "H" : "") : "?"; };

// Adder/subtractor: A + B, or A + (two's complement of B) when Su = 1. Result is 8-bit.
const alu = (a, b, su) => (a + (su ? (~b + 1) & 255 : b)) & 255;

// Assembler: "LDA 9", "ADD A", "OUT", "HLT" fill addresses from 0H; "9: 25" stores data at 9H.
function assemble(src) {
  const m = new Array(16).fill(0), kind = [], err = [];
  let next = 0; // next free instruction address
  src.split("\n").forEach((raw, i) => {
    const line = raw.split(";")[0].trim(), at = `Line ${i + 1}: `;
    if (!line) return;
    let r, a, v, k;
    if ((r = line.match(/^([0-9a-f])h?\s*:\s*([0-9a-f]{1,2})h?$/i))) { a = parseInt(r[1], 16); v = parseInt(r[2], 16); k = "d"; }
    else if ((r = line.match(/^(lda|add|sub|out|hlt)(?:\s+([0-9a-f])h?)?$/i))) {
      const name = r[1].toUpperCase(), takes = OPS[name].arg;
      if (takes && r[2] == null) return err.push(`${at}${name} needs an address from 0 to F.`);
      if (!takes && r[2] != null) return err.push(`${at}${name} takes no operand.`);
      a = next++; v = (OPS[name].c << 4) | (takes ? parseInt(r[2], 16) : 15); k = "i"; // OUT/HLT use operand F
    } else return err.push(`${at}can’t read “${line}”. Try LDA 9, ADD A, OUT, HLT or 9: 25.`);
    if (a > 15) return err.push(`${at}the program doesn’t fit in 16 bytes.`);
    if (kind[a]) return err.push(`${at}address ${H(a, 1)}H is already used.`);
    m[a] = v; kind[a] = k;
  });
  return { m, kind, err };
}

// Builds the standard "X op Y op Z" program (LDA 9 / ADD|SUB A / ADD|SUB B / OUT / HLT) with data at 9H, AH, BH.
const prog = (x, a, y, b, z) => [
  "LDA 9   ; A ← X", `${a === "+" ? "ADD" : "SUB"} A   ; A ← A ${a} Y`, `${b === "+" ? "ADD" : "SUB"} B   ; A ← A ${b} Z`,
  "OUT     ; show A on the LEDs", "HLT", `9: ${H(x)}   ; X`, `A: ${H(y)}   ; Y`, `B: ${H(z)}   ; Z`].join("\n");

const newCpu = ram => ({ PC: 0, MAR: 0, IR: 0, A: 0, B: 0, OUT: 0, T: 0, clk: 0, halted: false, err: "", ram: ram.slice() });

// One clock pulse of the controller-sequencer (ring counter T1..T6). Returns what happened, for the UI.
//   T1 Ep,Lm  PC → bus → MAR      T2 Cp  PC+1      T3 CE,Li  RAM → bus → IR      (fetch)
//   T4-T6: execute (LDA: Ei,Lm / CE,La   ADD,SUB: Ei,Lm / CE,Lb / [Su],Eu,La   OUT: Ea,Lo   HLT)
function tick(c) {
  const t = c.T + 1, op = c.IR >> 4, n = c.IR & 15, r = { t, src: null, dst: null, ctl: [], txt: "", w: null };
  const put = (src, w, dst, ctl, txt) => Object.assign(r, { src, w, dst, ctl, txt }).w; // record a W-bus transfer
  if (t === 1) c.MAR = put("PC", c.PC, "MAR", ["Ep", "Lm"], "PC → W-bus → MAR");
  else if (t === 2) { c.PC = (c.PC + 1) & 15; Object.assign(r, { dst: "PC", ctl: ["Cp"], txt: "PC counts up by 1" }); }
  else if (t === 3) c.IR = put("RAM", c.ram[c.MAR], "IR", ["CE", "Li"], `RAM[${H(c.MAR, 1)}H] → W-bus → IR`);
  else if (op === 15) { c.halted = true; Object.assign(r, { ctl: ["HLT"], txt: "HLT: clock stopped" }); }
  else if (op === 14) {
    if (t === 4) c.OUT = put("A", c.A, "OUT", ["Ea", "Lo"], "A → W-bus → Output register");
    else r.txt = "no operation";
  } else if (op <= 2) {
    if (t === 4) c.MAR = put("IR", n, "MAR", ["Ei", "Lm"], `IR operand ${H(n, 1)}H → W-bus → MAR`);
    else if (t === 5) {
      const v = put("RAM", c.ram[c.MAR], op ? "B" : "A", ["CE", op ? "Lb" : "La"], `RAM[${H(c.MAR, 1)}H] → W-bus → ${op ? "B" : "A"}`);
      if (op) c.B = v; else c.A = v;
    } else if (op === 0) r.txt = "no operation";
    else { const su = op === 2; c.A = put("ALU", alu(c.A, c.B, su), "A", su ? ["Su", "Eu", "La"] : ["Eu", "La"], su ? "A − B (2’s complement) → W-bus → A" : "A + B → W-bus → A"); }
  } else { c.halted = true; c.err = `Opcode ${B(op, 4)} is not a SAP-1 instruction; machine halted.`; Object.assign(r, { ctl: ["HLT"], txt: c.err }); }
  c.T = t % 6; c.clk++;
  return r;
}

// Slot assembler for the HUD editor: one "ADDR: CONTENT" line per address, e.g. "0: LDA 9H", "9: 25H", "3: OUT". Blank or "--" = 00H.
function assembleSlots(src) {
  const m = new Array(16).fill(0), kind = [], err = [];
  src.split("\n").forEach((raw, i) => {
    const line = raw.split(";")[0].trim(), at = `Line ${i + 1}: `;
    if (!line) return;
    const s = line.match(/^([0-9a-f])h?\s*:\s*(.*)$/i);
    if (!s) return err.push(`${at}start with a slot address, like 0: LDA 9H or 9: 25H.`);
    const a = parseInt(s[1], 16), body = s[2].trim();
    let r;
    if (kind[a]) return err.push(`${at}slot ${H(a, 1)}H is already used.`);
    if (!body || body === "--") return;
    if ((r = body.match(/^(lda|add|sub|out|hlt)(?:\s+([0-9a-f])h?)?$/i))) {
      const name = r[1].toUpperCase(), takes = OPS[name].arg;
      if (takes && r[2] == null) return err.push(`${at}${name} needs an address from 0 to F.`);
      if (!takes && r[2] != null) return err.push(`${at}${name} takes no operand.`);
      m[a] = (OPS[name].c << 4) | (takes ? parseInt(r[2], 16) : 15); kind[a] = "i";
    } else if ((r = body.match(/^([0-9a-f]{1,2})h?$/i))) { m[a] = parseInt(r[1], 16); kind[a] = "d"; }
    else err.push(`${at}can’t read “${body}”. Use an instruction (LDA 9H, OUT, HLT) or a hex value (25H).`);
  });
  return { m, kind, err };
}
// Inverse of assembleSlots: memory image back to 16 editor lines.
const slotsText = (m, kind) => m.map((v, a) => `${H(a, 1)}: ${kind[a] === "i" ? mnemonic(v) : kind[a] === "d" ? H(v) + "H" : "--"}`).join("\n");

const runToHalt = (m, max = 200) => { const c = newCpu(m); while (!c.halted && c.clk < max) tick(c); return c; };

// Test vectors [X, op1, Y, op2, Z, expected], expected values written by hand (8-bit wrap-around).
const TESTS = [[0x25, "+", 0x05, "-", 0x23, 0x07], [0x3c, "-", 0x12, "+", 0x0a, 0x34], [0x10, "+", 0x20, "+", 0x30, 0x60],
  [0x05, "-", 0x0a, "+", 0x00, 0xfb], [0xff, "+", 0x01, "+", 0x00, 0x00]];

if (typeof module !== "undefined") module.exports = { OPS, NAME, H, B, mnemonic, alu, assemble, assembleSlots, slotsText, prog, newCpu, tick, runToHalt, TESTS };
