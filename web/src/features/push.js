import { getJson, postJson } from '../lib/api.js';

// Web Push: notifikasi tetap sampai walau tab SIGAP ditutup. Browser berlangganan ke
// layanan push miliknya sendiri (Google, Mozilla, Microsoft), lalu alamat langganan
// itu didaftarkan ke server SIGAP. Service worker (public/sw.js) yang menampilkannya.
//
// Yang dikirim ke server saat mendaftar: alamat langganan dan kuncinya, pilihan
// "hanya sekitar lokasi saya", dan wilayah pengguna bila ada. Server membulatkan
// wilayah itu ke 0,1° (±11 km) sebelum menyimpannya.

const SW_URL = '/sw.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;

const keyBytes = (base64url) => Uint8Array.from(atob(base64url.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));

function sameKey(buffer, bytes) {
  const current = new Uint8Array(buffer ?? []);
  return current.length === bytes.length && current.every((value, i) => value === bytes[i]);
}

// Kunci publik server; null bila server belum mengaktifkan push.
export async function pushServerKey() {
  try {
    return (await getJson('/api/push/key')).publicKey;
  } catch {
    return null;
  }
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration('/');
  return registration ? registration.pushManager.getSubscription() : null;
}

const register = (subscription, prefs) => postJson('/api/push/subscriptions', { subscription: subscription.toJSON(), ...prefs });

// Meminta izin, berlangganan ke layanan push browser, lalu mendaftar ke server.
// Harus dipanggil dari tindakan pengguna (klik sakelar). Mengembalikan
// { ok: true } atau { ok: false, reason } dengan alasan yang bisa ditampilkan.
export async function enablePush(publicKey, prefs) {
  if ((await Notification.requestPermission()) !== 'granted') return { ok: false, reason: 'Izin notifikasi tidak diberikan.' };
  try {
    const registration = await navigator.serviceWorker.register(SW_URL);
    await navigator.serviceWorker.ready;
    const key = keyBytes(publicKey);
    let subscription = await registration.pushManager.getSubscription();
    // Langganan lama dari kunci server yang berbeda tidak bisa dipakai lagi.
    if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await register(subscription, prefs);
    return { ok: true };
  } catch (err) {
    console.warn('Push gagal diaktifkan', err);
    return { ok: false, reason: err.status ? err.message : 'Browser tidak bisa berlangganan ke layanan push. Coba lagi nanti.' };
  }
}

// Memperbarui pilihan di server (wilayah berubah, sakelar "hanya sekitar lokasi saya").
// false = perangkat ini tidak lagi berlangganan (izin dicabut atau langganan hilang).
export async function syncPush(prefs) {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const subscription = await currentSubscription();
  if (!subscription) return false;
  await register(subscription, prefs);
  return true;
}

export async function disablePush() {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await fetch('/api/push/subscriptions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => {});
  await subscription.unsubscribe();
}

// Meminta server mengirim satu pesan uji ke perangkat ini.
export async function testPush() {
  const subscription = await currentSubscription();
  if (!subscription) throw new Error('Push belum aktif di perangkat ini. Matikan lalu nyalakan lagi.');
  return postJson('/api/push/test', { endpoint: subscription.endpoint });
}
