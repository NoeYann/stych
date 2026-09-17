# Stych Confidence Tracker

Extension Chrome (Manifest V3). Injecte un widget de confiance (1-3) sur les
écrans d'examen blanc Stych, capture l'état de chaque question au moment du
clic sur "VALIDER", puis croise ces entrées avec la correction affichée en
fin d'examen. Un tableau de résultats téléchargeable en CSV est accessible
via l'icône de l'extension.

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

Mode correction :
- [ ] Nom exact de la classe pour une réponse juste sélectionnée. Non requis
      par l'implémentation actuelle (la correction se déduit par élimination
      des classes confirmées `badAnswer`/`forgetAnswer`), mais à confirmer
      si un jour un cas ne correspond pas au résultat attendu.
- [ ] Les blocs `.panel-qst-N` sont-ils tous présents au chargement de la
      page de récap (juste masqués en CSS), ou chargés au clic sur chaque
      pastille ? Dans les deux cas `processCorrectionPage()` est rappelée à
      chaque mutation DOM et traite les panneaux au fur et à mesure de leur
      apparition — mais si tout est chargé en AJAX au clic, penser à cliquer
      chaque pastille avant d'ouvrir la page de résultats pour une capture
      complète.
- [ ] Confirmer que `id="panel-qst-N"` correspond bien au même numéro
      d'ordre que `.questionnaire_test_numquestion` en mode question
      (utilisé comme clé de correspondance principale, avec un repli sur le
      chevauchement de `selectedAnswerIds` si aucune entrée ne correspond).

Le stockage garde `matched: false` pour toute entrée qui n'a pas pu être
recoupée avec la page de correction (examen interrompu, désynchronisation) —
la page de résultats l'affiche alors avec "Non disponible" plutôt que de
planter.
