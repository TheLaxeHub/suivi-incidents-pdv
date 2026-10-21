/*
 * Accès aux données.
 *  - Mode « sheets » : API Google Apps Script (apps-script/Code.gs), base partagée.
 *  - Mode « demo »   : localStorage du navigateur, avec un jeu de données fictif.
 * Les deux modes exposent la même interface : login, list, create, addAction.
 */
(function () {
  'use strict';
  const C = window.APP_CONFIG;
  const DEMO_KEY = 'sip_demo_v1';

  const ACTIONS = {};
  C.ACTIONS_BO.forEach(function (a) { ACTIONS[a.code] = Object.assign({ bo: true }, a); });
  ACTIONS.COMPLEMENT = { code: 'COMPLEMENT', libelle: "Complément d'information du PDV", statut: null, bo: false };
  const COMMENTAIRE_OBLIGATOIRE = ['COMMENTAIRE', 'COMPLEMENT', 'INFO_PDV', 'REJETE'];

  function erreur(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  /* ---------------- Mode Google Sheets ---------------- */

  async function appel(payload) {
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

  const Sheets = {
    login: function (s) { return appel({ action: 'login', profil: s.profil, code: s.code }); },
    list: function (s) { return appel({ action: 'list', profil: s.profil, code: s.code }); },
    create: function (s, data) {
      return appel({ action: 'create', profil: s.profil, code: s.code, data: data }).then(function (r) { return r.incident; });
    },
    addAction: function (s, data) { return appel({ action: 'addAction', profil: s.profil, code: s.code, data: data }); },
  };

  /* ---------------- Mode démo ---------------- */

  function charger() {
    try {
      const raw = localStorage.getItem(DEMO_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* stockage indisponible : on repart du jeu de démo */ }
    const db = jeuDemo();
    sauver(db);
    return db;
  }

  function sauver(db) {
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); } catch (e) { /* mode privé */ }
  }

  function texte(v, max) {
    return String(v === null || v === undefined ? '' : v).trim().slice(0, max);
  }

  function profilValide(profil) {
    return profil === C.BACK_OFFICE || C.POINTS_DE_VENTE.indexOf(profil) >= 0;
  }

  function valider(d) {
    const categorie = d.categorie === 'FORMALITE' ? 'FORMALITE' : (d.categorie === 'MOBILE_MONEY' ? 'MOBILE_MONEY' : '');
    if (!categorie) throw erreur('VALIDATION', 'Catégorie invalide.');
    const inc = {
      declarant: texte(d.declarant, 80),
      categorie: categorie,
      type_operation: '',
      operateur: texte(d.operateur, 20).toUpperCase(),
      date_operation: texte(d.date_operation, 20),
      montant: Math.round(Number(d.montant)),
      telephone: '',
      reference: '',
      incident: '',
      num_liquidation: '',
      formalite: '',
      description: texte(d.description, 2000),
      solution: texte(d.solution, 120),
    };
    if (categorie === 'MOBILE_MONEY') {
      inc.type_operation = d.type_operation === 'RETRAIT' ? 'RETRAIT' : (d.type_operation === 'DEPOT' ? 'DEPOT' : '');
      inc.telephone = texte(d.telephone, 30);
      inc.reference = texte(d.reference, 80);
      if (!inc.type_operation) throw erreur('VALIDATION', "Précisez s'il s'agit d'un dépôt ou d'un retrait.");
      if (!inc.operateur) throw erreur('VALIDATION', "Choisissez l'opérateur.");
    } else {
      inc.incident = texte(d.incident, 120);
      inc.num_liquidation = texte(d.num_liquidation, 60);
      inc.formalite = texte(d.formalite, 120);
      if (!inc.incident) throw erreur('VALIDATION', "Indiquez l'incident survenu.");
      if (!inc.num_liquidation) throw erreur('VALIDATION', 'Indiquez le numéro de liquidation.');
      if (!inc.formalite) throw erreur('VALIDATION', 'Indiquez la formalité voulue.');
    }
    if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(inc.date_operation)) throw erreur('VALIDATION', "Date de l'opération invalide.");
    if (!(inc.montant > 0)) throw erreur('VALIDATION', 'Le montant doit être supérieur à 0.');
    if (!inc.description) throw erreur('VALIDATION', "Expliquez ce qui s'est passé.");
    if (!inc.solution) throw erreur('VALIDATION', 'Choisissez la solution demandée.');
    if (!inc.declarant) throw erreur('VALIDATION', "Indiquez le nom de l'agent déclarant.");
    return inc;
  }

  function prochainId(db) {
    db.seq = (db.seq || 0) + 1;
    return 'INC-' + new Date().getFullYear() + '-' + String(db.seq).padStart(5, '0');
  }

  function appliquerAction(db, inc, def, data, auteur, quand) {
    const action = {
      id: 'A' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      incident_id: inc.id,
      cree_le: quand,
      auteur: auteur,
      agent: texte(data.agent, 80),
      code: def.code,
      libelle: def.libelle,
      reference: texte(data.reference, 80),
      commentaire: texte(data.commentaire, 2000),
      statut_apres: def.statut || inc.statut,
    };
    db.actions.push(action);
    if (def.statut) {
      inc.statut = def.statut;
      inc.cloture_le = (def.statut === 'TERMINE' || def.statut === 'REJETE') ? quand : '';
    }
    inc.derniere_action = def.libelle;
    inc.maj_le = quand;
    return action;
  }

  const Demo = {
    login: async function (s) {
      if (!profilValide(s.profil)) throw erreur('PROFIL_INCONNU', 'Profil inconnu.');
      return { ok: true, profil: s.profil, isBO: s.profil === C.BACK_OFFICE };
    },
    list: async function (s) {
      const db = charger();
      const isBO = s.profil === C.BACK_OFFICE;
      const incidents = isBO ? db.incidents : db.incidents.filter(function (i) { return i.pdv === s.profil; });
      const ids = {};
      incidents.forEach(function (i) { ids[i.id] = true; });
      return {
        ok: true,
        incidents: JSON.parse(JSON.stringify(incidents)),
        actions: db.actions.filter(function (a) { return ids[a.incident_id]; }),
      };
    },
    create: async function (s, data) {
      if (s.profil === C.BACK_OFFICE) throw erreur('INTERDIT', 'Seul un point de vente peut déclarer un incident.');
      const inc = valider(data);
      const db = charger();
      const now = new Date().toISOString();
      Object.assign(inc, {
        id: prochainId(db), cree_le: now, pdv: s.profil, statut: 'NOUVEAU',
        derniere_action: 'Déclaration', maj_le: now, cloture_le: '',
      });
      db.incidents.push(inc);
      sauver(db);
      return inc;
    },
    addAction: async function (s, data) {
      const def = ACTIONS[data.code];
      const isBO = s.profil === C.BACK_OFFICE;
      if (!def) throw erreur('ACTION_INCONNUE', 'Action de suivi inconnue.');
      if (def.bo !== isBO) throw erreur('INTERDIT', "Cette action n'est pas autorisée pour votre profil.");
      if (COMMENTAIRE_OBLIGATOIRE.indexOf(def.code) >= 0 && !texte(data.commentaire, 2000)) {
        throw erreur('VALIDATION', 'Un commentaire est obligatoire pour cette action.');
      }
      if (!texte(data.agent, 80)) throw erreur('VALIDATION', "Indiquez le nom de l'agent.");
      const db = charger();
      const inc = db.incidents.find(function (i) { return i.id === data.incident_id; });
      if (!inc) throw erreur('INTROUVABLE', 'Incident introuvable.');
      if (!isBO && inc.pdv !== s.profil) throw erreur('INTERDIT', "Incident d'un autre point de vente.");
      const action = appliquerAction(db, inc, def, data, s.profil, new Date().toISOString());
      sauver(db);
      return { ok: true, incident: inc, action: action };
    },
  };

  /* ---------------- Jeu de données de démonstration ---------------- */

  function jeuDemo() {
    let graine = 20261021;
    const rnd = function () {
      graine = (graine + 0x6D2B79F5) | 0;
      let t = Math.imul(graine ^ (graine >>> 15), 1 | graine);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = function (arr) { return arr[Math.floor(rnd() * arr.length)]; };
    const pondere = function (pairs) {
      let r = rnd() * pairs.reduce(function (s, p) { return s + p[1]; }, 0);
      for (let k = 0; k < pairs.length; k++) { r -= pairs[k][1]; if (r <= 0) return pairs[k][0]; }
      return pairs[0][0];
    };
    const agents = ['Koné A.', 'Yao K.', 'Traoré M.', 'Kouassi E.', 'Bamba S.', 'Coulibaly F.', "N'Guessan P.", 'Ouattara I.'];
    const agentsBO = ['Diallo R. (BO)', 'Aka J. (BO)', 'Soro L. (BO)'];
    const descDepot = [
      "Le client a fait un dépôt, notre compte a été débité mais le client n'a pas reçu l'argent.",
      'Transaction en échec côté opérateur mais le montant a quand même été débité du compte PDV.',
      "Dépôt envoyé sur un mauvais numéro suite à une erreur de saisie, le client demande l'annulation.",
      'Le dépôt reste « en attente » depuis plusieurs heures, aucun SMS de confirmation reçu.',
    ];
    const descRetrait = [
      'Le client a validé le retrait, les espèces ont été remises mais le compte PDV n\'a pas été crédité.',
      'Double débit constaté sur le même retrait (deux références pour une seule opération).',
      'Retrait refusé par le réseau alors que le client a été débité.',
    ];
    const descFormalite = [
      "Paiement effectué, le compte a été débité mais la formalité n'a pas été générée.",
      'Le client a été débité deux fois pour la même liquidation.',
      'Le montant prélevé ne correspond pas au montant de la liquidation.',
      "Le paiement reste en attente de confirmation, l'usager ne peut pas retirer son document.",
    ];
    const formalites = ['Mutation', 'Duplicata', 'Immatriculation', 'Levée de fourrière', 'Renouvellement'];
    const pdvPoids = C.POINTS_DE_VENTE.map(function (p, k) { return [p, 1 + ((k * 7) % 5)]; });
    const opPoids = [['ORANGE', 30], ['WAVE', 30], ['MTN', 20], ['MOOV', 12], ['DJAMO', 5], ['DOO', 3]];

    const db = { seq: 0, incidents: [], actions: [] };
    const maintenant = Date.now();
    const iso = function (t) { return new Date(t).toISOString(); };
    const local = function (t) {
      const d = new Date(t);
      const p = function (n) { return String(n).padStart(2, '0'); };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
    };
    const def = function (code) { return ACTIONS[code]; };

    const brut = [];
    for (let k = 0; k < 85; k++) brut.push(maintenant - Math.pow(rnd(), 1.3) * 40 * 864e5);
    brut.sort(function (a, b) { return a - b; });

    brut.forEach(function (tDecl) {
      const formalite = rnd() < 0.25;
      const tOp = tDecl - rnd() * 6 * 36e5;
      const pdv = pondere(pdvPoids);
      const inc = {
        id: prochainId(db),
        cree_le: iso(tDecl),
        pdv: pdv,
        declarant: pick(agents),
        categorie: formalite ? 'FORMALITE' : 'MOBILE_MONEY',
        type_operation: '',
        operateur: '',
        date_operation: local(tOp),
        montant: Math.round((rnd() < 0.12 ? 400000 + rnd() * 900000 : 2000 + Math.pow(rnd(), 2) * 250000) / 500) * 500,
        telephone: '',
        reference: '',
        incident: '',
        num_liquidation: '',
        formalite: '',
        description: '',
        solution: '',
        statut: 'NOUVEAU',
        derniere_action: 'Déclaration',
        maj_le: iso(tDecl),
        cloture_le: '',
      };
      if (formalite) {
        inc.incident = pick(C.INCIDENTS_FORMALITE.slice(0, -1));
        inc.num_liquidation = 'LIQ' + (2600000 + Math.floor(rnd() * 99999));
        inc.formalite = pick(formalites);
        inc.operateur = rnd() < 0.7 ? pondere(opPoids) : '';
        inc.description = pick(descFormalite);
        inc.solution = pick(C.SOLUTIONS_FORMALITE.slice(0, -1));
      } else {
        inc.type_operation = rnd() < 0.55 ? 'DEPOT' : 'RETRAIT';
        inc.operateur = pondere(opPoids);
        inc.telephone = '07' + String(Math.floor(rnd() * 1e8)).padStart(8, '0');
        inc.reference = inc.operateur.slice(0, 2) + Math.floor(rnd() * 1e10).toString(36).toUpperCase();
        inc.description = pick(inc.type_operation === 'DEPOT' ? descDepot : descRetrait);
        inc.solution = pick(C.SOLUTIONS_MOBILE_MONEY.slice(0, -1));
      }
      db.incidents.push(inc);

      // Plus l'incident est ancien, plus il a de chances d'avoir été traité.
      const ageJ = (maintenant - tDecl) / 864e5;
      const avance = Math.min(1, ageJ / 6) * rnd() + (ageJ > 12 ? 0.35 : 0);
      const bo = pick(agentsBO);
      let t = tDecl;
      const etape = function (code, commentaire, reference, auteur) {
        t = Math.min(maintenant - 6e5, t + (1 + rnd() * 30) * 36e5);
        appliquerAction(db, inc, def(code), {
          agent: auteur ? inc.declarant : bo, commentaire: commentaire, reference: reference,
        }, auteur || C.BACK_OFFICE, iso(t));
      };
      if (avance > 0.2) etape('PRISE_EN_CHARGE', 'Dossier pris en charge, vérification en cours auprès de l\'opérateur.');
      if (avance > 0.4 && rnd() < 0.25) {
        etape('INFO_PDV', 'Merci de transmettre la capture du reçu de la transaction.');
        etape('COMPLEMENT', 'Capture envoyée par WhatsApp au Back Office.', '', pdv);
      }
      if (avance > 0.5) {
        if (rnd() < 0.55) etape('CREATION_CA', 'CA créé pour le remboursement.', 'CA-' + Math.floor(10000 + rnd() * 89999));
        else etape('DEMANDE_REGULARISATION', "Demande de régularisation transmise à l'opérateur.", 'REG-' + Math.floor(1000 + rnd() * 8999));
      }
      if (avance > 0.75) {
        if (rnd() < 0.9) etape('TERMINE', 'Régularisation confirmée, client satisfait.');
        else etape('REJETE', "Transaction réussie côté opérateur, aucun débit anormal constaté.");
      }
    });
    return db;
  }

  /* ---------------- Interface publique ---------------- */

  const mode = C.API_URL ? 'sheets' : 'demo';
  const impl = mode === 'sheets' ? Sheets : Demo;

  window.Store = {
    mode: mode,
    ACTIONS: ACTIONS,
    login: impl.login,
    list: impl.list,
    create: impl.create,
    addAction: impl.addAction,
    resetDemo: function () {
      try { localStorage.removeItem(DEMO_KEY); } catch (e) { /* rien */ }
    },
  };
})();
