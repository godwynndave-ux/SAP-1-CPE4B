# SAP-1 Simulator: Tactical HUD edition

Same SAP-1 core as the classic build (16 × 8 RAM, PC, MAR, IR, A, B, adder/subtractor, output register, T1–T6 controller; `LDA ADD SUB OUT HLT`), restyled as a red/cyan tactical console.

**Run:** open `index.html` in a browser (no install, no build). Optional tests: `node test.js` (Node 18+). Fonts (Oswald, Roboto Mono) load from Google Fonts; offline it falls back to system fonts.

**Use:** type X, Y, Z in *Quick Loadout* and press **BUILD** (or press **EDIT SEQUENCE**, change the 16 slots, then **LOAD INSTRUCTIONS**). **STEP** = one instruction, **T-CYCLE** = one timing pulse, **EXECUTE** = auto-run at the chosen **CLOCK FREQUENCY / MS**, **REBOOT** = reset registers. **TACTICAL SFX** is off by default.

**Files:** `cpu.js` (model + assemblers, no DOM), `ui.js` (rendering, token animation, controls), `style.css` (theme), `index.html` (layout), `test.js` (model tests).
