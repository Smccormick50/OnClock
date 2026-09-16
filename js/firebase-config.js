// Replace these values with your own Firebase project's config.
// Find them in the Firebase console: Project settings (gear icon) >
// General tab > "Your apps" > the web app > SDK setup and configuration.
//
// These values are meant to be public — they identify your project,
// they are not secret keys. Access is controlled by firestore.rules,
// not by hiding this file.

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Lets the app keep working (reading cached data, queuing writes) when
// wifi drops, and syncs automatically once the connection's back.
// Fails harmlessly if another tab already has persistence open, or the
// browser doesn't support it — the app just falls back to online-only.
db.enablePersistence({ synchronizeTabs: true }).catch(function (err) {
  console.warn("Offline persistence not enabled:", err.code);
});
