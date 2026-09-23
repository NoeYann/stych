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
récent par défaut. Un sélecteur en haut de page (`#exam-picker`) permet de
choisir **un ou plusieurs** examens passés, chacun libellé "Examen N —
score — date" (N = le numéro que Stych affiche lui-même comme "Examen
Blanc N" sur l'accueil, extrait de `testUrl` — confirmé identique au
`data-num_serie` de cette page pour les 29 examens listés, donc dérivé sans
capture supplémentaire, y compris pour les examens déjà enregistrés avant
ce changement). Une case "Tous les examens" épinglée en haut du menu coche
ou décoche tout d'un coup. Quand plusieurs examens sont sélectionnés, le
tableau les affiche tous ensemble, groupés par examen (le plus récent en
premier, comme dans le menu) et non triés par numéro de question à travers
les examens — un même N° de question dans deux examens différents n'est
pas forcément la même question. Une colonne "Examen" apparaît alors dans le
tableau (masquée quand un seul examen est affiché, pour ne pas répéter la
même valeur sur chaque ligne) ; le score affiché devient la somme des
scores des examens sélectionnés, avec un suffixe "(N examens)". Le CSV
inclut toujours cette colonne "Examen", que le tableau la montre ou non.
Deux filtres, combinables en **OU** (cocher les deux affiche une question
qui correspond à au moins l'un des deux critères) : "Questions loupées"
(réponse effectivement fausse, exclut les questions non recoupées avec une
correction) et "Confiance faible (1-2)". Le bouton "Télécharger en CSV"
exporte exactement les lignes actuellement
affichées (examens + filtres sélectionnés), pas l'examen entier.

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

## Explications et cache de photos

Sur la page de résultats, une ligne dont la correction a une explication
(`sq.explanation`, déjà capturé depuis `<p class="text-left"><b>...</b></p>`
sur la page de correction) est cliquable : ça déplie une ligne juste en
dessous avec le texte complet. Exportée aussi dans le CSV (colonne
`Explication`).

Pour chaque question loupée ou avec une confiance faible (1-2), la photo de
la question (`.questionnaire_test_img`) est automatiquement récupérée et
mise en cache à la correction, consultable dans la section "Photos à
revoir" en bas de la page de résultats (vignette, question, examen,
raison, taille, boutons télécharger/supprimer, "Tout vider"). Aucune
limite automatique — c'est un cache géré à la main par toi.

**Architecture** (nouvelle pièce : `background.js`, absent avant cette
fonctionnalité) : `content.js` tourne sur l'origine `stych.fr` et peut donc
faire un `fetch()` de l'image sans souci de CORS (même origine), mais ne
peut pas ouvrir directement l'IndexedDB de l'extension — celle-ci vit sous
l'origine `chrome-extension://<id>`, complètement différente. L'image
récupérée (convertie en `ArrayBuffer`, sérialisable de façon fiable via
`chrome.runtime.sendMessage`, contrairement à un `Blob` envoyé tel quel)
est donc relayée au service worker d'arrière-plan (`background.js`), qui
partage l'origine de l'extension et écrit dans IndexedDB. `results.html`
partage cette même origine et peut donc lire/gérer directement cette même
base — aucun message supplémentaire nécessaire pour la page de gestion.
Déduplication naturelle par URL d'image (`keyPath: 'url'`) : la même
question de banque revue dans un examen ultérieur écrase l'entrée existante
plutôt que de la dupliquer.

Vérifié avant de pousser : chaîne complète `content.js` (simulé) →
`background.js` → `results.js` avec une vraie IndexedDB simulée
(`fake-indexeddb`), y compris la déduplication, la suppression individuelle
et le "tout vider" ; rendu réel via jsdom sur `results.html`/`results.js`
(grille de cartes, tri par date décroissante, formatage de taille) ; et
chargement réel de l'extension avec le nouveau service worker déclaré
(confirmé actif via "Inspect views service worker" sur `chrome://extensions`
en mode développeur, aucune erreur).

### Accès rapide et photo directement dans le tableau

Un lien "Photos à revoir" dans le header de la page de résultats
(`#photos-quicklink`, avec un badge indiquant le nombre de photos en cache)
fait défiler jusqu'à la section du même nom (`href="#image-cache-section"`,
défilement fluide via `scroll-behavior: smooth`).

Une ligne du tableau est désormais dépliable (classe `has-detail`, qui
remplace `has-explanation`) dès qu'elle a une explication **ou** une photo
en cache, pas uniquement une explication comme avant. La correspondance
photo ↔ ligne se fait par `(testUrl, questionOrderNumber)` — la même clé
que celle utilisée pour l'enregistrement dans `background.js`, construite
une fois par `buildImageIndex()` dans `results.js` puis passée à
`buildRows()`. La photo n'est chargée (`URL.createObjectURL`) qu'au premier
dépliage de la ligne, pas au chargement de la page, dans la continuité de
la gestion frugale de la mémoire déjà appliquée à la section "Photos à
revoir".

Vérifié via jsdom + `fake-indexeddb` avant de pousser : le badge du lien
d'accès rapide reflète bien le nombre de photos en cache, une ligne avec
photo ET explication affiche les deux au dépliage, une ligne sans l'une ni
l'autre reste non cliquable, et l'`<img>` ne reçoit son `src` qu'au premier
clic.

### Bug corrigé : photos jamais affichées (icône cassée partout)

En usage réel, aucune photo ne s'affichait — ni dans la grille "Photos à
revoir", ni dans une ligne dépliée — uniquement l'icône de photo cassée du
navigateur. Root cause confirmée : `chrome.runtime.sendMessage`, utilisé
pour relayer les octets de l'image de `content.js` (origine stych.fr) vers
`background.js` (origine de l'extension), **sérialise son message en JSON**
et ne fait pas un structured clone complet — un `ArrayBuffer` envoyé tel
quel arrive donc de l'autre côté comme un objet vide (`{}`). `background.js`
construisait alors un `Blob` de 0 octet (`new Blob([new Uint8Array({})],
...)` ne lève pas d'erreur mais produit un tableau de longueur 0), d'où une
image invalide à chaque fois, y compris dans la grille qui charge ses
vignettes immédiatement (pas seulement au clic sur une ligne).

Confirmé par un test Node : `JSON.parse(JSON.stringify({ buffer:
someArrayBuffer }))` donne bien `{ buffer: {} }`.

**Correctif** : `content.js` encode désormais l'image en base64
(`FileReader.readAsDataURL`, préfixe `data:...;base64,` retiré) avant
`sendMessage` — une chaîne de caractères survit intacte à la sérialisation
JSON — et `background.js` la décode en octets (`atob` + boucle
`charCodeAt`, disponible dans le service worker) avant de construire le
`Blob`. Vérifié par un test Node round-trip (2000 octets aléatoires,
y compris toutes les valeurs 0-255) : les octets décodés correspondent
exactement aux octets d'origine. Chargement réel de l'extension re-confirmé
(service worker actif, `atob`/`btoa` disponibles dans ce contexte).

## Refonte visuelle du tableau de résultats

Suite à une revue UI/UX, quatre correctifs "gains rapides" ont été
appliqués au tableau de la page résultats :

- **En-têtes de colonnes collants** (`thead th { position: sticky; top: 0;
  }`) : restent visibles en scrollant un examen à 40 questions.
- **Colonne "Ta réponse" : bordure gauche + icône plutôt que fond plein.**
  Un fond entièrement coloré dupliquait visuellement le rôle de la colonne
  Confiance (qui utilise déjà rouge/orange/vert) — un utilisateur pouvait
  scanner la mauvaise colonne et mal lire "vert = confiance haute" comme
  "vert = juste". Remplacé par `border-left: 4px solid` + fond très
  légèrement teinté (6-8% d'opacité), plus une icône `✓`/`✗` et un texte
  accessible caché (`.sr-only`, "Correct : "/"Incorrect : ") pour ne pas
  dépendre uniquement de la couleur (accessibilité daltonisme). Une réponse
  fausse passe aussi en gras pour attirer l'œil sur les erreurs — c'est
  l'usage principal de l'outil.
- **Colonne "Bonne réponse" en italique**, pour la marquer visuellement
  comme une info de référence/correction plutôt que la réponse de
  l'utilisateur. Elle ne passe en gras + vert que lorsqu'elle diffère
  réellement de la réponse choisie (`row.isCorrect === false`), pour ne
  pas décorer inutilement les ~30 lignes déjà correctes d'un examen.
  Soulignement délibérément évité : sur le web il connote un lien
  cliquable, ce qui aurait été trompeur sur du texte statique.
- **Alternance de fond des lignes** (zebra striping), appliquée via une
  classe JS (`row-stripe`, sur un compteur de lignes réellement affichées)
  plutôt que `:nth-child` en CSS pur — les lignes d'explication/photo
  masquées insérées après certaines lignes auraient décalé le calcul de
  parité CSS et cassé le motif.
- Palette centralisée dans des variables CSS (`:root { --color-success,
  --color-danger, --color-warning, --color-primary }`) dans `results.css`,
  pour sécuriser toute future retouche de couleurs.

Vérifié via jsdom (fake-indexeddb) avant de pousser : icône ✓ + pas de
classe `is-correction` sur une ligne juste, icône ✗ + classe `is-correction`
sur une ligne fausse, alternance `row-stripe` correcte sur l'index des
lignes réellement affichées (pas des lignes DOM brutes), texte accessible
`.sr-only` présent.

## Sélection multi-examens dans le tableau

Historique du code vérifié avant d'implémenter : le sélecteur d'examen n'a
jamais permis d'afficher plusieurs examens à la fois depuis sa toute
première version (`badb842`, v0.3.0) — c'était un choix unique dès le
départ, jamais une régression. Remis en place comme une vraie fonctionnalité
multi-sélection, à la demande explicite de l'utilisateur.

`#exam-picker` gère désormais un `Set` d'indices sélectionnés
(`selectedIndices`) au lieu d'un seul index. Chaque ligne du menu est un
`<label>` enveloppant une checkbox (dans un `<li>`, pour garder un `<ul>`
valide) — cliquer n'importe où sur la ligne, pas juste sur la case, la
coche/décoche nativement, sans JS supplémentaire pour ça. Une ligne "Tous
les examens" épinglée en haut du menu (checkbox avec état `indeterminate`
quand une sélection partielle est en cours) coche/décoche tout d'un coup.
Le menu ne se ferme plus à chaque clic (comportement single-select
précédent) — seul un clic à l'extérieur ou Echap le referme, pour permettre
de cocher plusieurs examens à la suite.

`render()` combine les lignes de tous les groupes sélectionnés
(`examGroups.filter(...).flatMap(buildRows)`) sans re-trier par numéro de
question à travers les examens — chaque groupe reste trié en interne par
numéro (comme avant), et les groupes eux-mêmes gardent l'ordre du menu
(plus récent en premier). Trier par numéro de question à travers plusieurs
examens aurait mélangé des questions sans rapport qui partagent juste la
même position dans des examens différents.

`buildRows()` attache désormais `examNumber` (déjà dérivé via
`getExamNumber(entry.testUrl)`) à chaque ligne, systématiquement — que la
colonne "Examen" soit affichée ou non à l'écran. `renderTable()` reconstruit
entièrement la ligne d'en-tête (`#results-head-row`, vidée et repeuplée à
chaque rendu) plutôt que de basculer la visibilité d'une colonne fixe en
CSS : le `colSpan` de la ligne d'explication dépliée doit toujours
correspondre au nombre de colonnes réellement présentes, ce qui aurait été
fragile à synchroniser avec un `display:none` CSS sur une colonne qui
resterait dans le DOM.

Le score agrège les examens sélectionnés (somme des scores/totaux,
suffixe "(N examens)" si plus d'un) ; la moyenne de confiance continue de
fonctionner sans changement, car `computeAverageConfidence()` opère déjà
sur la liste de lignes affichées, pas sur les entrées brutes par examen
(prévu forward-compatible dès son écriture initiale).

Vérifié via jsdom + `fake-indexeddb`, avec trois examens synthétiques
(2 questions chacun) : sélection par défaut = seulement le plus récent
(comportement identique à avant) ; case "Tous les examens" cochée →
6 lignes groupées par examen dans le bon ordre (`7,7,5,5,3,3`, pas
interleaved par numéro de question), colonne "Examen" apparaît, score
agrégé correct avec suffixe ; décocher un examen → repasse à "N examens
sélectionnés" et la case "Tous" devient `indeterminate` ; tout décocher →
tableau vide avec message dédié et score "Pas encore de résultat".
