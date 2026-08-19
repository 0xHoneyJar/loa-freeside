/* Freeside — SHARED FIXTURES
   The single source of cases. Both the executable tests and the Conformance card
   consume this file; neither builds its own matrix. A pack may extend it with an
   extra axis by declaring its own `cases` (see templates/roster/copy.js).

   Loads as a classic script; assigns window.FreesideFixtures. */
(function () {
  'use strict';

  var ROLES = ['guest', 'member', 'operator', 'principal'];
  var DESTINATIONS = ['arrival', 'account', 'console', 'settlement'];
  var STATES = ['nominal', 'degraded', 'alert'];

  /* The base matrix: every role × destination × state. 48 cases. */
  var MATRIX = (function () {
    var out = [];
    ROLES.forEach(function (role) {
      DESTINATIONS.forEach(function (destination) {
        STATES.forEach(function (systemState) {
          out.push({ role: role, destination: destination, systemState: systemState });
        });
      });
    });
    return out;
  })();

  /* Axis helpers, so a pack extends the matrix rather than rewriting it. */
  function withCapability(cases, cap, filter) {
    var out = [];
    cases.forEach(function (c) {
      out.push(c);
      if (!filter || filter(c)) {
        var g = { role: c.role, destination: c.destination, systemState: c.systemState, grants: [cap] };
        out.push(g);
      }
    });
    return out;
  }

  /* An explicit ACCESS grant — the one thing that may legitimately widen
     disclosure. Kept distinct from capability grants on purpose. */
  function withCeilingGrant(cases, ceiling, filter) {
    var out = [];
    cases.forEach(function (c) {
      out.push(c);
      if (!filter || filter(c)) {
        out.push({
          role: c.role, destination: c.destination, systemState: c.systemState,
          grants: c.grants, ceilingGrant: ceiling
        });
      }
    });
    return out;
  }

  function label(c) {
    return c.role + '/' + c.destination + '/' + c.systemState +
      (c.grants && c.grants.length ? ' +' + c.grants.join('+') : '') +
      (c.ceilingGrant != null ? ' ceiling→' + c.ceilingGrant : '');
  }

  window.FreesideFixtures = {
    ROLES: ROLES, DESTINATIONS: DESTINATIONS, STATES: STATES,
    MATRIX: MATRIX, withCapability: withCapability, withCeilingGrant: withCeilingGrant, label: label
  };
})();
