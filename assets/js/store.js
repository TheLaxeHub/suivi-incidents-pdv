/*
 * Accès aux données : API Google Apps Script (apps-script/Code.gs).
 * La feuille Google Sheets sert de base partagée entre les points de vente et le Back Office.
 * Interface : login, list, create, addAction.
 */
(function () {
  'use strict';
  const C = window.APP_CONFIG;

  // Efface les données fictives laissées dans le navigateur par l'ancienne version de démonstration.
  try { localStorage.removeItem('sip_demo_v1'); } catch (e) { /* stockage indisponible */ }

  function erreur(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  async function appel(payload) {
    if (!C.API_URL) {
      throw erreur('NON_CONFIGURE', "L'application n'est pas encore reliée à sa base de données (API_URL vide dans assets/js/config.js).");
    }
    let res;
    try {
      // text/plain évite la requête préalable CORS que Apps Script ne gère pas.
      res = await fetch(C.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      throw erreur('RESEAU', 'Impossible de joindre le serveur. Vérifiez votre connexion internet.');
    }
    if (!res.ok) throw erreur('RESEAU', 'Le serveur a répondu ' + res.status + '.');
    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw erreur('REPONSE', 'Réponse inattendue du serveur (vérifiez le déploiement Apps Script).');
    }
    if (!data.ok) throw erreur(data.code || 'ERREUR', data.message || 'Erreur inconnue.');
    return data;
  }

  window.Store = {
    configure: !!C.API_URL,
    login: function (s) { return appel({ action: 'login', profil: s.profil, code: s.code }); },
    list: function (s) { return appel({ action: 'list', profil: s.profil, code: s.code }); },
    create: function (s, data) {
      return appel({ action: 'create', profil: s.profil, code: s.code, data: data }).then(function (r) { return r.incident; });
    },
    addAction: function (s, data) { return appel({ action: 'addAction', profil: s.profil, code: s.code, data: data }); },
  };
})();
