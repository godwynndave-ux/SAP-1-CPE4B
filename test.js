// Run with: node test.js
const assert = require("assert");
const { assemble, assembleSlots, slotsText, prog, runToHalt, newCpu, tick, TESTS } = require("./cpu.js");

// 1. Memory image of the primary test case (25H + 05H - 23H)
const { m } = assemble(prog(0x25, "+", 0x05, "-", 0x23));
assert.deepStrictEqual(m, [0x09, 0x1a, 0x2b, 0xef, 0xff, 0, 0, 0, 0, 0x25, 0x05, 0x23, 0, 0, 0, 0]);

// 2. Fetch cycle T1-T3: MAR=0, PC incremented to 1, IR=LDA 9
const c = newCpu(m); tick(c); tick(c); tick(c);
assert.deepStrictEqual([c.MAR, c.PC, c.IR, c.T], [0, 1, 0x09, 3]);

// 3. Every formula vector gives the expected output
for (const [x, a, y, b, z, want] of TESTS) assert.strictEqual(runToHalt(assemble(prog(x, a, y, b, z)).m).OUT, want);

// 4. The assembler rejects bad input
assert.ok(assemble("LDA").err.length && assemble("FOO 1").err.length && assemble("LDA 9\n0: 25").err.length);
// 5. HUD slot editor: hand-typed primary program, round trip, errors
const s = assembleSlots("0: LDA 9H\n1: ADD AH\n2: SUB BH\n3: OUT\n4: HLT\n9: 25H\nA: 05H\nB: 23H");
assert.deepStrictEqual(s.m, m);
const r0 = assemble(prog(0x3c, "-", 0x12, "+", 0x0a));
assert.deepStrictEqual(assembleSlots(slotsText(r0.m, r0.kind)).m, r0.m);
assert.ok(assembleSlots("LDA 9H").err.length && assembleSlots("0: LDA").err.length && assembleSlots("0: LDA 9H\n0: OUT").err.length);
console.log("All SAP-1 tests passed");
