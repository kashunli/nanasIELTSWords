import assert from "node:assert/strict";
import test from "node:test";

import {buildWaveformBars} from "./waveform.mjs";

test("waveform bars are derived from the requested PCM interval", () => {
  const channel = Float32Array.from([
    0.02, 0.02, 0.02, 0.02,
    0.8, 0.8, 0.8, 0.8,
    0.1, 0.1, 0.1, 0.1,
  ]);
  const bars = buildWaveformBars([channel], 4, 0, 3000, 4);

  assert.equal(bars.length, 4);
  assert.ok(bars.every((height) => height >= 0.07 && height <= 1));
  assert.equal(Math.max(...bars), 1);
  assert.ok(bars[0] < bars[1]);
});
