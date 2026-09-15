// Firebase Web SDK singleton — eBilikAgamaTV.
//
// The browser never performs privileged data operations (all data flows
// through the Next.js server via the Firebase Admin SDK — see lib/prisma.ts
// and firestore.rules, which deny direct client access). This module exists
// for any present/future client-side Firebase needs (analytics, messaging)
// and as the single, canonical Firebase app initialization.
//
// Values are env-first with the project's public web-config fallbacks.
// apiKey / projectId / appId are public identifiers by design; no private
// credentials may ever be placed here or in NEXT_PUBLIC_* variables.
import { FirebaseApp, getApp, getApps, initializeApp } from "firebase/app";

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyC9oJMXnAtOR8qQHsEWkiuVpvIdvLGMdME",
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??
    "ebilikagama-broadcast.firebaseapp.com",
  databaseURL:
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ??
    "https://ebilikagama-broadcast-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "ebilikagama-broadcast",
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    "ebilikagama-broadcast.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "863483582283",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:863483e055d0b437489aface",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? "G-NHP28CH6SB",
};

/** Singleton Firebase app for the browser. */
export function getFirebaseApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}
