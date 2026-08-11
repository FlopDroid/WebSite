/* =========================================================
   FlopDroid Store — Firebase config
   ---------------------------------------------------------
   1. Go to https://console.firebase.google.com → create a project
   2. Build → Authentication → Get started → enable "Email/Password"
   3. Build → Firestore Database → Create database → start in
      "production mode" (we provide real security rules below)
   4. Project settings (gear icon) → General → "Your apps" →
      add a Web app → copy the firebaseConfig object it gives you
      and paste the values below.
   ========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "PASTE_YOUR_API_KEY",
    authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
    projectId: "PASTE_YOUR_PROJECT_ID",
    storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
    messagingSenderId: "PASTE_YOUR_SENDER_ID",
    appId: "PASTE_YOUR_APP_ID"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const dbFirestore = getFirestore(app);
