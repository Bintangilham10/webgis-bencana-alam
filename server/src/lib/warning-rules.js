// Aturan indikasi (rules.json v0.2 dan fungsinya) tinggal di recorder/src/lib/,
// supaya cek risiko, indikasi kab/kota di server, dan arsip indikasi yang dihitung
// perekam di GitHub Actions selalu memakai aturan yang sama persis.
export * from '../../../recorder/src/lib/warning-rules.js';
