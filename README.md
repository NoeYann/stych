# Stych Confidence Tracker

Extension Chrome (Manifest V3) — mode question uniquement. Injecte un widget de
confiance (1-3) sur les écrans d'examen blanc Stych et capture l'état de la
question au moment du clic sur "VALIDER" dans `chrome.storage.local`.

## Installation (dev)

1. `chrome://extensions`
2. Activer "Mode développeur"
3. "Charger l'extension non empaquetée" → sélectionner ce dossier

## Vérifier la capture

Sur une page d'examen, ouvrir la console DevTools :

```js
chrome.storage.local.get('stychConfidenceEntries', console.log);
```

## Points à vérifier en test réel (voir brief, section 7)

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

Le scope de cette itération est volontairement limité au mode question : pas
de logique de correction, pas de croisement confiance/résultat (`matched`
reste `false`).
