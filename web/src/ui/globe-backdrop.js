// Latar halaman depan: cakrawala bumi "Atlas alam" (ui/globe-scene.js, three.js).
// Modul ini hanya pembungkus ringan: three.js dan data permukaannya dimuat terpisah
// setelah halaman tampil, jadi tidak memperlambat muatan awal. Panggilan yang datang
// sebelum adegan siap disimpan lalu diteruskan. Tanpa WebGL atau Web Worker latar
// tetap polos.
export function createGlobeBackdrop({ box, canvas, marks, root }) {
  let scene = null;
  let stopped = false;
  const pending = { play: false, quakes: null, volcanoes: null };
  const supported = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && !!document.createElement('canvas').getContext('webgl2');
  if (supported) {
    import('./globe-scene.js')
      .then(({ createGlobeScene }) => {
        if (stopped) return;
        scene = createGlobeScene({ box, canvas, marks, root });
        if (pending.quakes) scene.setQuakes(pending.quakes);
        if (pending.volcanoes) scene.setVolcanoes(pending.volcanoes);
        if (pending.play) scene.play();
      })
      .catch((err) => console.warn('Latar bumi dimatikan:', err));
  }
  return {
    play() {
      pending.play = true;
      scene?.play();
    },
    stop() {
      stopped = true;
      scene?.stop();
    },
    setQuakes(features) {
      pending.quakes = features;
      scene?.setQuakes(features);
    },
    setVolcanoes(features) {
      pending.volcanoes = features;
      scene?.setVolcanoes(features);
    },
  };
}
