# Stych Suivi

Extension Chrome (Manifest V3). Injecte un widget de confiance (1-3) sur les
écrans d'examen blanc Stych, capture l'état de chaque question au moment du
clic sur "VALIDER", puis croise ces entrées avec la correction affichée en
fin d'examen. Un tableau de résultats téléchargeable en CSV est accessible
via l'icône de l'extension.

## Gestion multi-examens

`stychConfidenceEntries` conserve l'historique de tous les examens jamais
passés (pas de purge automatique à chaque nouvelle tentative). Chaque
examen a son propre score, stocké dans `stychExamScores` (map indexée par
`testUrl`, remplace l'ancienne clé unique `stychLastScore` qui n'aurait pu
garder que le score du tout dernier examen) — lu directement depuis le DOM
de Stych au moment de la correction, donc exact même pour un examen ancien.

- Le **matching de correction** (`content.js`) reste scopé à l'examen **le
  plus récent** au moment où la page de correction s'affiche, déterminé par
  le `testUrl` de l'entrée au `timestamp` le plus élevé en storage (la page
  de correction n'expose `test_url` nulle part dans son DOM — vérifié).
- La **page de résultats** (`results.js`) propose désormais un sélecteur
  d'examen (`#exam-select`, triés du plus récent au plus ancien, chacun
  affiché avec sa date et son score) plutôt que de se limiter au dernier —
  voir section suivante.
- Au chargement de `content.js`, une passe de nettoyage
  (`cleanupStorage()`) supprime les groupes d'entrées orphelines : celles
  qui ne sont liées à aucun examen corrigé (`matched: false` sur tout le
  groupe) et dont le nombre d'entrées est strictement inférieur au
  `totalQuestions` qu'elles rapportent elles-mêmes — signature typique des
  entrées perdues par l'ancien bug de race condition sur le storage
  (corrigé, mais qui a laissé des reliquats). L'examen le plus récent n'est
  jamais ciblé par ce nettoyage, même s'il est encore incomplet (examen en
  cours).

## Installation (dev)

1. `chrome://extensions`
2. Activer "Mode développeur"
3. "Charger l'extension non empaquetée" → sélectionner ce dossier

## Vérifier la capture (mode question)

Sur une page d'examen, ouvrir la console DevTools :

```js
chrome.storage.local.get('stychConfidenceEntries', console.log);
```

## Consulter les résultats (mode correction)

Une fois l'examen terminé (page de récapitulatif affichée), cliquer sur
l'icône de l'extension → "Voir mes résultats". La page s'ouvre dans un
nouvel onglet, lit `chrome.storage.local` et affiche l'examen le plus
récent par défaut. Un sélecteur en haut de page (`#exam-select`) permet de
choisir n'importe quel examen passé, libellé "Examen N — score — date" (N
= le numéro que Stych affiche lui-même comme "Examen Blanc N" sur l'accueil,
extrait de `testUrl` — confirmé identique au `data-num_serie` de cette page
pour les 29 examens listés, donc dérivé sans capture supplémentaire, y
compris pour les examens déjà enregistrés avant ce changement). Deux
filtres, combinables en **OU** (cocher les deux affiche une question qui
correspond à au moins l'un des deux critères) : "Questions loupées"
(réponse effectivement fausse, exclut les questions non recoupées avec une
correction) et "Confiance faible (1-2)". Le bouton "Télécharger en CSV"
exporte exactement les lignes actuellement
affichées (examen + filtres sélectionnés), pas l'examen entier.

Un bouton "Voir mes résultats" (même libellé que dans le popup, tooltip
"Stych Suivi" au survol) est aussi injecté directement sur Stych, sans
passer par l'icône de l'extension : sur la page des évaluations
(`/elearning/formation/<id>/evaluation`), inséré comme élément à part
entière de la barre `<nav class="topbar">` de Stych (premier item, avant
la cloche/le panier/le compte, aligné sur leur hauteur) ; sur la page de
correction, qui n'a pas cette même barre, en position fixe haut-droite.
Ouvert via `window.open()` (un content script n'a pas accès à
`chrome.tabs.create()`, réservé aux contextes privilégiés comme
`popup.js`), ce qui nécessite de déclarer `results.html` (+ `.js`/`.css`)
dans `web_accessible_resources`.

**Piège rencontré sur `web_accessible_resources[].matches`** : contrairement
à `content_scripts.matches`, ce champ **refuse** un schéma ou un hôte
générique (`*://*/...`) — Chrome le rejette avec "Invalid match pattern"
sans préciser lequel des deux patterns est en cause. Il exige un schéma
concret et soit un hôte concret, soit la forme `*.domaine` (sous-domaines).
Confirmé empiriquement (chargement réel de l'extension, pas juste une
validation JSON) : `https://example.com/*` et `https://*.stych.fr/*`
fonctionnent, `*://*/...`, `https://*/...` et `*://www.stych.fr/...`
échouent tous. D'où `"matches": ["https://*.stych.fr/*"]` dans ce champ
spécifiquement, alors que `content_scripts.matches` garde son pattern
générique `*://*/...` habituel (jamais concerné par cette restriction).

## Points à vérifier en test réel (voir brief, section 7)

Mode question :
- [ ] Clic sur "VALIDER" → écran suivant direct, ou passage par un écran de
      correction intermédiaire ?
- [ ] Les checkboxes `.check_response` (marquées `readonly` dans le HTML)
      sont-elles bien cochables au clic utilisateur normal, et leur état
      `.checked` reflète-t-il la sélection réelle ?
- [ ] `#QST` est-il modifié en place entre deux questions, ou détruit et
      recréé ? (impacte la robustesse du `MutationObserver`, déjà couvert
      par une ré-injection défensive du widget dans `content.js`)
- [ ] Valeur exacte de `.questionnaire_test_multiple` pour un QCM à choix
      unique (actuellement seul "Plusieurs réponses" est documenté)
- [x] `id_qst` (champ caché `#id_qst`) identifie la **tentative d'examen**
      côté serveur, pas la question — confirmé : la même valeur d'`id_qst`
      a été capturée à la question 6/40 et à la question 40/40 d'un même
      examen. Ne jamais l'utiliser comme clé d'unicité par question ; la clé
      d'identité d'une question au sein d'un examen est `(testUrl,
      questionNumber)`, utilisée à la fois pour la dédup dans `saveEntry()`
      et pour le matching dans `processCorrectionPage()`.

Mode correction (confirmé sur DOM réel) :
- [x] Classe pour une réponse juste sélectionnée : `selected goodAnswer`
      (confirmé). L'implémentation ne s'appuie toujours pas sur ce nom —
      elle déduit la correction par élimination via `badAnswer`/
      `forgetAnswer` — mais c'est désormais documenté par preuve, pas par
      hypothèse.
- [x] Les 40 blocs `.panel-qst-N` sont tous présents au chargement de la
      page de récap, masqués via la règle CSS `.panel-qst { display:none; }`
      — pas de chargement AJAX au clic. Aucune interaction requise avant de
      lire les résultats.
- [x] `id="panel-qst-N"` est sur la pastille `.box-resume-result` (résumé
      cliquable), pas sur le bloc détail — le bloc détail porte `panel-qst-N`
      comme **classe** (`class="panel-qst container panel-qst-N"`). Le code
      cible bien la classe, pas l'id.
- [ ] Comportement de clic sur la pastille `.box-resume-result` (affiche
      probablement le bloc `.panel-qst-N` correspondant) non observé
      directement. Le badge de confiance déplace la pastille dans un
      wrapper (`.stych-confidence-wrap`) via `insertBefore`/`appendChild`
      sur le nœud existant — jamais de clonage — donc tout gestionnaire
      d'événement déjà attaché à la pastille doit survivre intact. À
      confirmer que le clic fonctionne toujours après injection du badge.

Le stockage garde `matched: false` pour toute entrée qui n'a pas pu être
recoupée avec la page de correction (examen interrompu, désynchronisation) —
la page de résultats l'affiche alors avec "Non disponible" plutôt que de
planter.
