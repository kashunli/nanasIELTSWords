export interface WordCandidate {
  text: string;
  sourceLabel: string;
  evidence: string;
}

// Review data is bundled with the frontend so learner requests do not read
// preparation files. Add a candidate only when its evidence is explicit and
// keep the stable item ID as the key instead of mutable displayed spelling.
const WORD_CANDIDATES_BY_STABLE_ID: Record<string, readonly WordCandidate[]> = {
  "bv1at4y1579f-ch01-0083": [
    {
      text: "gulf",
      sourceLabel: "Auto suggestion · exact book sentence",
      evidence: "This candidate appears in the exact example sentence from the reviewed book.",
    },
  ],
  "bv1at4y1579f-ch01-0062": [
    {
      text: "plateau",
      sourceLabel: "Auto suggestion · exact book sentence",
      evidence: "The reviewed book entry for plateau uses this exact example sentence and the meaning 高原.",
    },
  ],
  "bv1at4y1579f-ch01-0122": [
    {
      text: "thaw",
      sourceLabel: "Auto suggestion · exact book sentence",
      evidence: "This candidate appears in the exact example sentence from the reviewed book.",
    },
  ],
  "bv1at4y1579f-ch01-0136": [
    {
      text: "Celsius",
      sourceLabel: "Auto suggestion · exact book sentence",
      evidence: "This candidate appears in the exact example sentence from the reviewed book.",
    },
  ],
  "bv1at4y1579f-ch01-0193": [
    {
      text: "barren",
      sourceLabel: "Auto suggestion · exact book sentence",
      evidence: "This candidate appears in the exact example sentence from the reviewed book.",
    },
  ],
  "bv1at4y1579f-ch01-0217": [
    {
      text: "pour",
      sourceLabel: "Auto suggestion · exact book sentence",
      evidence: "This candidate appears in the exact example sentence from the reviewed book.",
    },
  ],
  "bv1at4y1579f-ch02-0038": [
    {
      text: "vase",
      sourceLabel: "Auto suggestion · exact book sentence",
      evidence: "This candidate appears in the exact example sentence from the reviewed book.",
    },
  ],
  "bv1at4y1579f-ch02-0044": [
    {
      text: "pollen",
      sourceLabel: "Auto suggestion · exact book sentence",
      evidence: "This candidate appears in the exact example sentence from the reviewed book.",
    },
  ],
  "bv1at4y1579f-ch02-0111": [
    {
      text: "perish",
      sourceLabel: "Auto suggestion · exact book sentence",
      evidence: "This candidate appears in the exact example sentence from the reviewed book.",
    },
  ],
  "bv1at4y1579f-ch03-0047": [
    {
      text: "paw",
      sourceLabel: "Auto suggestion · exact book sentence",
      evidence: "This candidate appears in the exact example sentence from the reviewed book.",
    },
  ],
  "bv1at4y1579f-ch03-0081": [
    {
      text: "calf",
      sourceLabel: "Auto suggestion · exact book sentence",
      evidence: "This candidate appears in the exact example sentence from the reviewed book.",
    },
  ],
  "bv1at4y1579f-ch03-0094": [
    {
      text: "hawk",
      sourceLabel: "Auto suggestion · exact book sentence",
      evidence: "This candidate appears in the exact example sentence from the reviewed book.",
    },
  ],
  "bv1at4y1579f-ch03-0113": [
    {
      text: "roar",
      sourceLabel: "Auto suggestion · exact book sentence",
      evidence: "This candidate appears in the exact example sentence from the reviewed book.",
    },
  ],
  "bv1at4y1579f-ch03-0130": [
    {
      text: "germ",
      sourceLabel: "Auto suggestion · exact book sentence",
      evidence: "This candidate appears in the exact example sentence from the reviewed book.",
    },
  ],
  "bv1at4y1579f-ch03-0150": [
    {
      text: "dormant",
      sourceLabel: "Auto suggestion · exact book sentence",
      evidence: "This candidate appears in the exact example sentence from the reviewed book.",
    },
  ],
  "bv1at4y1579f-ch05-0145": [
    {
      text: "reel",
      sourceLabel: "Auto suggestion · exact book sentence",
      evidence: "This candidate appears in the exact example sentence from the reviewed book.",
    },
  ],
  "bv1at4y1579f-ch05-0176": [
    {
      text: "sum",
      sourceLabel: "Auto suggestion · exact book sentence",
      evidence: "This candidate appears in the exact example sentence from the reviewed book.",
    },
  ],
  "bv1at4y1579f-ch05-0333": [
    {
      text: "discern",
      sourceLabel: "Auto suggestion · exact book sentence",
      evidence: "This candidate appears in the exact example sentence from the reviewed book.",
    },
  ],
  "bv1at4y1579f-ch05-0342": [
    {
      text: "persist",
      sourceLabel: "Auto suggestion · exact book sentence",
      evidence: "This candidate appears in the exact example sentence from the reviewed book.",
    },
  ],
};

export function getWordCandidates(stableId: string): WordCandidate[] {
  return [...(WORD_CANDIDATES_BY_STABLE_ID[stableId] || [])];
}
