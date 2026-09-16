(function () {
  "use strict";
  var mode = "login"; // or "signup"

  function setMode(newMode) {
    mode = newMode;
    document.getElementById("nameField").style.display = mode === "signup" ? "block" : "none";
    document.getElementById("authTitle").textContent = mode === "signup" ? "Create account" : "Sign in";
    document.getElementById("authSubmitBtn").textContent = mode === "signup" ? "Create account" : "Sign in";
    document.getElementById("toggleModeBtn").textContent = mode === "signup" ? "Already have an account? Sign in" : "Need an account? Sign up";
    document.getElementById("authError").textContent = "";
    document.getElementById("authInfo").textContent = "";
  }

  window.addEventListener("DOMContentLoaded", function () {
    setMode("login");
    document.getElementById("toggleModeBtn").onclick = function () {
      setMode(mode === "signup" ? "login" : "signup");
    };
    document.getElementById("authForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var email = document.getElementById("emailInput").value.trim();
      var password = document.getElementById("passwordInput").value;
      var name = document.getElementById("nameInput").value.trim();
      var errEl = document.getElementById("authError");
      var infoEl = document.getElementById("authInfo");
      errEl.textContent = "";
      infoEl.textContent = "";
      document.getElementById("authSubmitBtn").disabled = true;

      var task = mode === "signup" ? signUp(email, password, name) : signIn(email, password);
      task.catch(function (err) {
        errEl.textContent = friendlyAuthError(err);
      }).finally(function () {
        document.getElementById("authSubmitBtn").disabled = false;
      });
    });

    document.getElementById("forgotPasswordBtn").onclick = function () {
      var email = document.getElementById("emailInput").value.trim();
      var errEl = document.getElementById("authError");
      var infoEl = document.getElementById("authInfo");
      errEl.textContent = "";
      infoEl.textContent = "";

      if (!email) {
        errEl.textContent = "Enter your email above first, then tap this again.";
        return;
      }

      auth.sendPasswordResetEmail(email).catch(function (err) {
        // Swallow "no account with that email" so this can't be used
        // to check which emails have accounts — show the same message
        // either way.
        if (err.code !== "auth/user-not-found") {
          console.error("password reset error", err);
        }
      }).finally(function () {
        infoEl.textContent = "If that email has an account, a reset link is on its way.";
      });
    };
  });

  function friendlyAuthError(err) {
    var code = err && err.code;
    if (code === "auth/email-already-in-use") return "That email already has an account — try signing in instead.";
    if (code === "auth/invalid-email") return "That email address doesn't look right.";
    if (code === "auth/weak-password") return "Password should be at least 6 characters.";
    if (code === "auth/wrong-password" || code === "auth/user-not-found" || code === "auth/invalid-credential") return "Email or password is incorrect.";
    return (err && err.message) || "Something went wrong. Try again.";
  }
})();
