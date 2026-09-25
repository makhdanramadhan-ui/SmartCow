// CONTOH config Firebase. Cara pakai:
// 1. Salin file ini menjadi js/firebase-config.js (nama itu yang dibaca web).
// 2. Isi dari Firebase Console: Build > Realtime Database (buat DB, catat URL),
//    Project Overview > Add app Web (salin apiKey dkk),
//    Build > Authentication > Sign-in method > Email/Password > tambah user demo.
// 3. Jangan commit file asli ke repo publik (ini projek tugas, tetap jaga secret).
window.FIREBASE_CONFIG = {
  apiKey: 'GANTI_API_KEY',
  authDomain: 'GANTI_PROJECT.firebaseapp.com',
  databaseURL: 'https://GANTI_PROJECT-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'GANTI_PROJECT',
  email: 'demo@smartcow.local',
  password: 'GANTI_PASSWORD_DEMO',
  deviceId: 'cow-sprinkler-01'
};
