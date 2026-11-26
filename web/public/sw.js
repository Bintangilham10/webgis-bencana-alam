// Service worker SIGAP Bencana. Tugasnya satu: menampilkan notifikasi push dari
// server walau tab SIGAP ditutup (gempa BMKG, perubahan level gunung api, peringatan
// dini cuaca BMKG). Ia tidak menyimpan halaman dan tidak mencegat permintaan apa pun,
// jadi aplikasi selalu dimuat dari jaringan seperti biasa.
//
// Isi pesan (dienkripsi server untuk browser ini):
//   { id, kind, level, title, body, created_at, d, s }
// d dan s dipakai untuk melapor ke server bahwa pesan sudah sampai (latensi push).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let n = {};
  try {
    n = event.data?.json() ?? {};
  } catch {
    // Pesan tanpa isi atau bukan JSON tetap ditampilkan dengan judul bawaan.
  }
  const shown = self.registration.showNotification(n.title ?? 'SIGAP Bencana', {
    body: n.body ?? '',
    // Tag yang sama dengan notifikasi dari halaman (features/notifications.js), jadi
    // kejadian yang sama tidak tampil dua kali.
    tag: n.id ? `sigap-${n.id}` : 'sigap-uji',
    icon: '/images/ikon-192.png',
    timestamp: Date.parse(n.created_at) || Date.now(),
    // Level 3 (Awas, berpotensi tsunami) bertahan sampai ditutup pengguna.
    requireInteraction: n.level >= 3,
    data: { id: n.id ?? null },
  });
  const reported = n.d
    ? fetch('/api/push/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ d: n.d, s: n.s }), keepalive: true }).catch(() => {})
    : Promise.resolve();
  event.waitUntil(Promise.all([shown, reported]));
});

// Klik notifikasi: tab SIGAP yang sudah terbuka dibawa ke depan dan diminta membuka
// kejadiannya; bila tidak ada, aplikasi dibuka langsung ke kejadian itu.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const id = event.notification.data?.id ?? null;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        open.postMessage({ type: 'sigap-notifikasi', id });
        return open.focus();
      }
      return self.clients.openWindow(id ? `/?notifikasi=${id}` : '/');
    })(),
  );
});
