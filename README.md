# Stych Confidence Tracker

Extension Chrome (Manifest V3). Injecte un widget de confiance (1-3) sur les
écrans d'examen blanc Stych, capture l'état de chaque question au moment du
clic sur "VALIDER", puis croise ces entrées avec la correction affichée en
fin d'examen. Un tableau de résultats téléchargeable en CSV est accessible
via l'icône de l'extension.

## Gestion multi-examens

`stychConfidenceEntries` conserve l'historique de tous les examens jamais
passés (pas de purge automatique à chaque nouvelle tentative, pour ne pas
fermer la porte à une future vue d'agrégation multi-examens). En revanche :

- Le tableau de résultats (`results.js`) et le matching de correction
  (`content.js`) se limitent tous les deux à l'examen **le plus récent**,
  déterminé par le `testUrl` de l'entrée au `timestamp` le plus élevé en
  storage (la page de correction n'expose `test_url` nulle part dans son
  DOM — vérifié — donc c'est la seule façon fiable de scoper sans lui).
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
nouvel onglet, lit `chrome.storage.local` et propose un bouton "Télécharger
en CSV" (séparateur `;`, BOM UTF-8 pour Excel).

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
