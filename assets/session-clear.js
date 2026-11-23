/*
  Ends a Supabase sign-in on THIS device without needing the network.

  sb.auth.signOut() asks the server first. If the server can't be reached (a weak or switching mobile connection,
  data saver), the library returns an error and KEEPS the session, so the Sign out button seems to do nothing.
  In that case the page calls this to forget the saved login on the device, then shows the sign-in screen.
  (The server-side session is not revoked in that case; it simply expires on its own.)
*/
(function (root) {
  'use strict';
  /* the keys supabase-js writes: sb-<project>-auth-token, plus -code-verifier and -user variants */
  var MINE = /^sb-.+-auth-token(-code-verifier|-user)?$/;

  function clearFrom(store) {
    var gone = 0;
    if (!store) return gone;
    try {
      var keys = [];
      for (var i = 0; i < store.length; i++) keys.push(store.key(i));
      keys.forEach(function (k) {
        if (k && MINE.test(k)) { store.removeItem(k); gone++; }
      });
    } catch (e) { /* storage blocked: nothing to forget */ }
    return gone;
  }
  function forgetSession(local, session) { return clearFrom(local) + clearFrom(session); }

  var api = { forgetSession: forgetSession, MINE: MINE };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.SngSessionClear = api;
})(typeof window !== 'undefined' ? window : this);
