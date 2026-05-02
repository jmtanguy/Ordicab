# Architecture AI Agent Runtime — Outils et PII

> Fichier de référence pour comprendre l'articulation entre `aiToolDefinitions`, `aiSdkAgentRuntime` et la gestion des données personnelles (PII).

---

## 1. Contrat modèle : `aiToolDefinitions.ts`

Ce fichier définit **tous les outils exposés au LLM**. Il est le seul point de vérité sur ce que le modèle peut appeler.

### Deux familles d'outils

#### Data tools (`ORDICAB_DATA_TOOLS`)

Outils **intermédiaires** : leur résultat est réinjecté au LLM, la boucle continue.

| Outil                | Rôle                                                              |
| -------------------- | ----------------------------------------------------------------- |
| `managed_fields_get` | Charge la configuration des champs gérés (rôles, champs contacts) |
| `contact_lookup`     | Liste les contacts d'un dossier avec leurs UUIDs                  |
| `contact_get`        | Détail complet d'un contact par UUID                              |
| `template_list`      | Liste les modèles disponibles                                     |
| `document_list`      | Liste les documents d'un dossier                                  |
| `document_get`       | Détail d'un document (métadonnées + taille)                       |
| `dossier_get`        | Détail d'un dossier (dates clés, références clés)                 |
| `document_search`    | Recherche sémantique dans le texte extrait des documents          |

#### Action tools (`ORDICAB_ACTION_TOOLS`)

Outils **terminaux** : leur appel arrête la boucle et l'intent est dispatché vers l'application.

Exemples : `contact_upsert`, `contact_delete`, `document_generate`, `text_generate`, `dossier_create`, `clarification_request`, `unknown`, …

### Batchable action tools

Sous-ensemble des action tools pouvant être exécutés **inline** dans la boucle (le résultat est réinjecté). Cela permet au modèle d'enchaîner plusieurs actions en un tour (ex : créer plusieurs contacts à la suite).

```
BATCHABLE_ACTION_TOOL_NAMES = {
  contact_upsert, contact_delete, dossier_select,
  template_select, dossier_upsert_key_date, dossier_delete_key_date,
  dossier_upsert_key_reference, dossier_delete_key_reference,
  document_analyze
}
```

### Cache invalidation : `STALE_TOOL_NAMES_AFTER_ACTION`

Après une action mutante, les résultats de data tools devenus périmés sont **évincés de l'historique** :

```
contact_upsert  → invalide contact_lookup, contact_get
contact_delete  → invalide contact_lookup, contact_get
dossier_select  → invalide contact_lookup, contact_get, document_list
template_create → invalide template_list
…
```

---

## 2. Boucle outil : `aiSdkAgentRuntime.ts`

### Vue d'ensemble

````
sendCommand(payload, mode)
  └─► runToolLoop()                    [max 32 itérations]
        ├─ chatTools(messages, TOOLS)
        │
        ├─► rawContent (pas de tool call natif)
        │     ├── JSON intent direct        → retourné immédiatement
        │     ├── schema-shaped call        → synthétisé comme tool call
        │     ├── narrated tool (```block```)→ synthétisé comme tool call
        │     ├── binary question           → clarification_request synthétisé
        │     └── plain text + 0 tool call  → nudge → retry (max 1)
        │
        └─► toolCalls natifs
              ├── DATA_TOOL_NAMES
              │     → executeDataTool(args)
              │     → résultat réinjecté → continue
              ├── BATCHABLE_ACTION_TOOL_NAMES + executeActionTool
              │     → exécuté inline
              │     → résultat réinjecté → continue
              └── ACTION_TOOL_NAMES (non batchable)
                    → retourné comme InternalAiCommand → fin de boucle
  │
  └─► (runToolLoop retourne null)
        JSON-mode fallback : chatIntent() — 2 essais
        Sinon : AiRuntimeError(INTENT_PARSE_FAILED)
````

### Robustesse face aux modèles faibles

Certains modèles locaux (Mistral-Nemo, Qwen, DeepSeek) ne respectent pas toujours le protocole natif. Quatre stratégies de récupération sont appliquées dans l'ordre :

1. **JSON intent direct** — le modèle ignore les tools et émet un objet JSON `{ type, … }` valide.
2. **Schema-shaped call** — le modèle émet `{ "name": "contact_upsert", "arguments": { … } }`.
3. **Narrated tool** — le modèle décrit l'appel dans un bloc Markdown fencé :
   ````
   ```
   contact_upsert
   { "firstName": "Marie", "lastName": "Dupont" }
   ```
   ````
4. **Nudge** — si aucun outil n'a encore été appelé, un message système pousse le modèle à utiliser un outil. Capé à 1 tentative.

> Les blocs `<think>…</think>` émis par DeepSeek/Qwen sont supprimés avant tout parsing (`stripThinking()`).

### Gestion de l'historique multi-tours

`appendHistory(entries, dispatchedAction?)` maintient un historique roulant de **12 tours maximum**. Après chaque action mutante, les résultats de data tools périmés sont evincés des entrées existantes **et** des nouvelles entrées (un `contact_lookup` fait juste avant un `contact_delete` ne doit pas survivre dans l'historique).

---

## 3. Gestion des PII

### Activation

La pseudonymisation est activée **uniquement en mode remote** (quand les données quittent le device vers une API externe). Elle est configurée dans les paramètres application (`piiEnabled`, `piiWordlist`).

### Couches de détection (`piiDetector.ts`)

`detectPii(text, wordlist?)` retourne des spans non-chevauchants triés par position. Sept couches par priorité décroissante :

| Priorité | Couche                       | Exemples détectés                                                |
| -------- | ---------------------------- | ---------------------------------------------------------------- |
| 1        | **Structural**               | email, téléphone FR, SSN (FR + US), IBAN, SIRET, TVA FR, adresse |
| 2        | **Password context**         | `password:abc123`, `mdp=secret`, `token: xyz`                    |
| 3        | **Context-anchored SIREN**   | `RCS Paris 123 456 789`, `SIREN: 987654321`                      |
| 4        | **Wordlist**                 | termes custom fournis par l'utilisateur                          |
| 5        | **Salutation-anchored**      | `Cher Laurent,`, `Dear John,`, `Bonjour Sophie`                  |
| 6        | **Title-anchored**           | `M. Dupont`, `Maître Martin`, `Dr. Smith`, `Mme Lefebvre`        |
| 7        | **Capitalization heuristic** | séquences Title Case avec ancrage sur un prénom connu            |

La couche 7 (heuristique) nécessite **au moins un prénom reconnu** dans la séquence pour éviter les faux positifs sur les en-têtes de documents juridiques (`Direction Générale`, `Chambre Correctionnelle`…). Les stopwords juridiques (`ATTENDU`, `JUGEMENT`, `PARTIES`…) sont filtrés explicitement.

### Flux de pseudonymisation dans `aiService.ts`

```
User command : "Crée un contact pour Marie Dupont, tél. 06 12 34 56 78"

1. Pseudonymisation du prompt
   → "Crée un contact pour [[PERSON_1]] [[PERSON_2]], tél. [[PHONE_1]]"

2. Envoi au LLM distant (prompt pseudonymisé)

3. Le LLM appelle contact_lookup → args peuvent contenir des tokens pseudonymisés
   wrappedExecuteDataTool:
     a. revertJson(args)           → remplace [[PERSON_1]] par "Marie" dans les args
     b. executeDataTool(realArgs)  → interroge la vraie base de données
     c. pseudonymize(result)       → pseudonymise le JSON retourné avant de le donner au LLM

4. Le LLM appelle contact_upsert (batchable) → même traitement via wrappedExecuteActionTool

5. L'intent retourné contient des tokens pseudonymisés
   revertJson(intent) → restaure les vraies valeurs avant dispatch
```

### Pseudonymisation sélective des document tools

Le comportement est désormais distinct selon le tool :

- `document_list`, `document_get`, `document_search`
  → seuls les **champs humainement lisibles** sont pseudonymisés ; les champs
  structurels (`id`, `uuid`, `relativePath`, `dossierId`, `modifiedAt`,
  `byteLength`, `textExtraction`, etc.) restent intacts pour pouvoir être
  réutilisés dans les appels suivants.
- `document_analyze`
  → `rawContent` et `error` sont **pseudonymisés** avant d'être renvoyés au
  LLM ; `uuid`, `totalChars` et `charsReturned` restent intacts.

```
document_get result:
  uuid        → conservé tel quel (référence stable)
  filename    → pseudonymisé
  description → pseudonymisé
  tags        → pseudonymisés

document_search result:
  query       → pseudonymisée
  excerpt     → pseudonymisé
  filename    → pseudonymisé
  uuid/id     → conservés tels quels

document_analyze result:
  uuid         → conservé tel quel
  rawContent   → pseudonymisé
  totalChars   → conservé tel quel
  charsReturned→ conservé tel quel
  error        → pseudonymisée
```

### Cohérence multi-tours

L'historique de conversation stocke toujours la version **pseudonymisée** du contenu. Les vrais noms ne transitent jamais dans l'historique envoyé au LLM distant. Le revert n'est appliqué qu'au dernier moment, juste avant le dispatch vers l'application.

```
Historique conservé :
  user:      "Crée un contact pour [[PERSON_1]] [[PERSON_2]]"
  assistant: tool_call contact_upsert { firstName: "[[PERSON_1]]", lastName: "[[PERSON_2]]" }
  tool:      { success: true, id: "uuid-xxx" }

Dispatch (après revert) :
  contact_upsert { firstName: "Marie", lastName: "Dupont", id: "uuid-xxx" }
```

---

## 4. Fichiers de référence

| Fichier                      | Rôle                                                      |
| ---------------------------- | --------------------------------------------------------- |
| `aiToolDefinitions.ts`       | Contrat modèle : définition de tous les outils            |
| `aiSdkAgentRuntime.ts`       | Boucle outil, gestion historique, fallback JSON-mode      |
| `aiService.ts`               | Orchestration : prompt building, PII wrapping, dispatch   |
| `pii/piiDetector.ts`         | Détection des spans PII (regex + heuristiques)            |
| `pii/piiPseudonymizer.ts`    | Pseudonymisation / revert des textes et JSON              |
| `pii/personNameDetection.ts` | Détection de noms propres (title-anchored, salutation)    |
| `aiCommandDispatcher.ts`     | Dispatch des `InternalAiCommand` vers les services métier |
| `aiSystemPrompt.ts`          | Construction du system prompt (context + tool guidance)   |
