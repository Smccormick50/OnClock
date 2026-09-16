// Shared auth helpers. Depends on firebase-config.js having run first
// (defines `auth` and `db`).

function userDocRef(uid) {
  return db.collection("users").doc(uid);
}

// Signing up fires Firebase's onAuthStateChanged almost immediately —
// often before signUp()'s own code below gets a chance to write the
// profile doc. Both paths call ensureUserDoc for the same new user, so
// without this, whichever one loses that race could create the profile
// with a fallback name (from the email) instead of the name the person
// actually typed. Setting this synchronously, before any async call,
// means every ensureUserDoc call — whichever fires first — sees the
// right name.
let pendingSignupName = null;

// Atomic check-and-create so two near-simultaneous calls (the race
// described above) can't both see "doesn't exist" and both try to
// create the doc.
async function ensureUserDoc(user) {
  const ref = userDocRef(user.uid);
  await db.runTransaction(async function (tx) {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.set(ref, {
        name: pendingSignupName || (user.email ? user.email.split("@")[0] : "Employee"),
        email: user.email,
        role: "employee",
        createdAt: new Date().toISOString()
      });
    }
  });
  return (await ref.get()).data();
}

async function signUp(email, password, name) {
  pendingSignupName = name;
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await ensureUserDoc(cred.user);
    return cred.user;
  } finally {
    pendingSignupName = null;
  }
}

function signIn(email, password) {
  return auth.signInWithEmailAndPassword(email, password);
}

function signOutUser() {
  return auth.signOut();
}

// Calls `callback(user, profile)` whenever auth state changes.
// `profile` is the Firestore users/{uid} doc data, or null if signed out.
function onAuthReady(callback) {
  auth.onAuthStateChanged(async function (user) {
    if (!user) {
      callback(null, null);
      return;
    }
    const profile = await ensureUserDoc(user);
    callback(user, profile);
  });
}
