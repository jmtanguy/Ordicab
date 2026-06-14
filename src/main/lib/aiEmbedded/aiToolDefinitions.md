# Architecture AI Agent Runtime — Outils, boucle et PII

> Fichier de référence pour comprendre l'articulation entre `aiToolDefinitions.ts`,
> `aiSdkAgentRuntime.ts` et la gestion des données personnelles (PII) du mode IA embarqué.

---

## 1. Contrat modèle : `aiToolDefinitions.ts`

Définit **tous les outils exposés au LLM** via les définitions natives du Vercel AI SDK.
C'est le seul point de vérité sur ce que le modèle peut appeler.

### Trois familles d'outils

#### Data tools — `buildDataTools()`

Outils **intermédiaires** : leur résultat est réinjecté au LLM, la boucle continue.

| Outil                | Rôle                                                                     |
| -------------------- | ------------------------------------------------------------------------ |
| `managed_fields_get` | Configuration des champs gérés (rôles, champs contacts/dates/références) |
| `contact_lookup`     | Liste les contacts d'un dossier avec leurs UUIDs                         |
| `contact_get`        | Détail complet d'un contact par UUID                                     |
| `dossier_list`       | Liste tous les dossiers enregistrés (id/uuid/nom/statut/type)            |
| `dossier_get`        | Détail complet d'un dossier (dates, références, prestations, factures)   |
| `invoice_list`       | Liste les factures émises, filtrable par dossier                         |
| `invoice_get`        | Détail complet d'une facture                                             |
| `template_list`      | Liste les modèles disponibles                                            |
| `document_list`      | Liste les documents d'un dossier                                         |
| `document_get`       | Métadonnées + statistiques de taille d'un document (**pas** le texte)    |
| `document_search`    | Recherche hybride (exacte + sémantique) dans le texte extrait            |
| `note_search`        | Recherche hybride dans les notes/pense-bête (filtrable kind/status)      |
| `note_get`           | Lit une note complète par UUID                                           |
| `legal_search_legifrance`  | Recherche obligatoire pour les textes juridiques français officiels (Légifrance) |
| `legal_consult_legifrance` | Consulte le contenu Légifrance complet avant validation/citation          |
| `legal_search_judilibre`   | Recherche obligatoire pour la jurisprudence française (Judilibre)         |
| `legal_consult_judilibre`  | Consulte une décision Judilibre complète avant synthèse/citation          |
| `legal_taxonomy_judilibre` | Résout les codes Judilibre (chambres, thèmes, juridictions…)              |
| `legal_verify_references`  | Vérifie des références juridiques via Légifrance/Judilibre                |

Pour les recherches juridiques, les descriptions des tools demandent explicitement au
modèle d'utiliser Légifrance (`https://www.legifrance.gouv.fr`) et Judilibre
(`https://www.courdecassation.fr/recherche-judilibre`) avant de répondre, puis
d'inclure les liens publics `url` retournés par les résultats lorsque disponibles.

#### Batchable action tools — `buildBatchableActionTools()` / `BATCHABLE_ACTION_TOOL_NAMES`

Action tools exécutés **inline** dans la boucle (résultat réinjecté), ce qui permet
d'enchaîner plusieurs actions en un tour.

```text
contact_create, contact_update, contact_delete, dossier_select, template_select,
dossier_create_key_date, dossier_update_key_date, dossier_delete_key_date,
dossier_create_key_reference, dossier_update_key_reference, dossier_delete_key_reference,
dossier_create_billing_item, dossier_update_billing_item, dossier_delete_billing_item,
note_create, note_update, note_delete,
document_analyze, document_metadata_save
```

Les mutations sont **sérialisées** (`runBatchableActionSerially`) pour éviter les
races read-modify-write côté persistance.

#### Terminal action tools — `terminalActionTools`

Outils **terminaux** : pas d'`execute`. Leur appel arrête la boucle ; le runtime les
renvoie comme `InternalAiCommand` dispatché vers l'application.

```text
field_populate, document_generate, document_metadata_batch,
document_summary_batch, dossier_create, dossier_update,
document_relocate, template_create, template_update, template_delete,
text_generate, dossier_summarize, clarification_request, unknown
```

`dossier_summarize` produit une **synthèse exécutive** du dossier complet (objet, parties,
faits & contexte, chronologie & échéances, références clés, points à traiter). Comme
`text_generate`, il déclenche un second appel LLM (`handleDossierSummarize`) ; le résultat
est restitué dans le chat (lecture seule, pas de persistance).

### Invalidation de cache : `STALE_TOOL_NAMES_AFTER_ACTION`

Après une action mutante, les résultats de data tools devenus périmés sont **évincés
de l'historique** par `appendHistory()` :

```text
contact_create  → contact_lookup, contact_get, document_search, document_analyze
contact_update  → contact_lookup, contact_get, document_search, document_analyze
contact_delete  → contact_lookup, contact_get
dossier_create_key_date → dossier_get
dossier_update_key_date → dossier_get
dossier_delete_key_date → dossier_get
dossier_create_key_reference → dossier_get
dossier_update_key_reference → dossier_get
dossier_delete_key_reference → dossier_get
dossier_create_billing_item → dossier_get
dossier_update_billing_item → dossier_get
dossier_delete_billing_item → dossier_get
dossier_create  → dossier_get, dossier_list
dossier_update  → dossier_get, dossier_list
template_create → template_list
…
```

---

## 2. Boucle outil : `aiSdkAgentRuntime.ts`

### Vue d'ensemble

````text
sendCommand(payload, mode)
  └─► executeWithRetryOnTruncatedToolCalls()   [retry x1 sur TruncatedToolCallsError]
        └─► runSdkToolLoop()
              ├─ sdkGenerateText({ system: toolSystemPrompt, messages, tools,
              │                    maxOutputTokens: 2048, stopWhen: stepCountIs(32) })
              │
              ├─ data tool appelé   → execute() → résultat réinjecté → continue
              ├─ batchable action   → execute() inline (sérialisé) → réinjecté → continue
              └─ terminal action    → pas d'execute ; la boucle s'arrête
              │
              ├─► result.steps[*].toolCalls : 1er outil terminal trouvé
              │     → renvoyé comme InternalAiCommand
              └─► sinon result.text :
                    ├─ parseInternalAiCommand     (JSON {type,…} ou texte [TOOL_CALLS])
                    ├─ extractNarratedToolRequest (bloc ``` nommant un outil terminal)
                    ├─ [TOOL_CALLS] tronqué       → TruncatedToolCallsError
                    └─ sinon                      → { type: 'direct_response', message }
        │
        └─► runSdkToolLoop renvoie null → AiRuntimeError(INTENT_PARSE_FAILED)
````

`sendCommand` capture aussi les erreurs provider : message utilisateur dédié →
`REMOTE_API_ERROR` ; dépassement de la fenêtre de contexte → un retry avec historique
vide (`historyStrategy: 'fresh'`) ; `network_error` / `timeout_error` / `rate_limit` →
attente puis retry ; sinon `AI_RUNTIME_UNAVAILABLE`.

### Robustesse face aux modèles faibles

Certains modèles locaux (Mistral-Nemo, Qwen, DeepSeek) ne respectent pas toujours le
protocole d'outils natif. Quand `result.text` est non vide et qu'aucun outil natif n'a
été appelé, trois stratégies de récupération sont tentées :

1. **JSON intent direct** — le modèle émet `{ "type": …, … }`.
2. **Texte `[TOOL_CALLS]`** — payload `{ name, arguments }` en texte brut
   (`parseBracketedToolCallsText`).
3. **Tool narré** — l'appel décrit dans un bloc Markdown fencé qui nomme un outil
   terminal (`extractNarratedToolRequest`).

> Les blocs `<think>…</think>` (DeepSeek/Qwen) sont retirés (`stripReasoningBlocks`)
> avant tout parsing JSON / narré.

### Gestion de l'historique multi-tours

`appendHistory(entries, dispatchedAction?)` maintient un historique roulant capé à
`MAX_HISTORY_ENTRIES` (**12 entrées** — messages user/assistant/tool, pas tours).

- Les résultats de data tools périmés sont évincés selon `STALE_TOOL_NAMES_AFTER_ACTION`.
- Le slice au cap est appliqué **avant** `sanitizeHistoryToolIntegrity`, qui ne conserve
  que les paires tool-call ↔ tool-result complètes (les deux orphelins possibles sont
  supprimés).
- À l'envoi, `compactMessagesForContextWindow` garde un **suffixe contigu** sous
  `MAX_MESSAGES_TOTAL_CHARS` (24000) et retire un message `tool` orphelin en tête.

> L'historique persistant vit dans `aiSdkAgentRuntime` : c'est la source de vérité. Le
> renderer n'envoie pas d'historique ; `AiCommandInput.history` n'est qu'un fallback
> consulté si l'historique runtime est vide.

---

## 3. Gestion des PII

### Activation

La pseudonymisation est activée **uniquement en mode remote** (quand les données
quittent le device vers une API externe). Elle est configurée dans les paramètres
application (`piiEnabled`, `piiWordlist`).

### Couches de détection (`piiDetector.ts`)

`detectPii(text, wordlist?)` retourne des spans non-chevauchants triés par position.
Sept couches par priorité décroissante :

| Priorité | Couche                       | Exemples détectés                                                |
| -------- | ---------------------------- | ---------------------------------------------------------------- |
| 1        | **Structural**               | email, téléphone FR, SSN (FR + US), IBAN, SIRET, TVA FR, adresse |
| 2        | **Password context**         | `password:abc123`, `mdp=secret`, `token: xyz`                    |
| 3        | **Context-anchored SIREN**   | `RCS Paris 123 456 789`, `SIREN: 987654321`                      |
| 4        | **Wordlist**                 | termes custom fournis par l'utilisateur                          |
| 5        | **Salutation-anchored**      | `Cher Laurent,`, `Dear John,`, `Bonjour Sophie`                  |
| 6        | **Title-anchored**           | `M. Dupont`, `Maître Martin`, `Dr. Smith`, `Mme Lefebvre`        |
| 7        | **Capitalization heuristic** | séquences Title Case avec ancrage sur un prénom connu            |

La couche 7 (heuristique) nécessite **au moins un prénom reconnu** dans la séquence
pour éviter les faux positifs sur les en-têtes de documents juridiques
(`Direction Générale`, `Chambre Correctionnelle`…). Les stopwords juridiques
(`ATTENDU`, `JUGEMENT`, `PARTIES`…) sont filtrés explicitement.

### Flux de pseudonymisation

`aiService` instancie un `PiiPseudonymizer` par commande (remote + `piiEnabled`), puis
construit un `piiToolGateway` qui enveloppe les deux executors :

```text
User command : "Crée un contact pour Marie Dupont, tél. 06 12 34 56 78"

1. pseudonymizeText(command / history / exemples du prompt)
   → "Crée un contact pour Antoine Masson, tél. 07 65 61 45 81"

2. Envoi au LLM distant (prompt pseudonymisé)

3. Le LLM appelle un data tool → piiToolGateway.executeDataTool :
     a. revertPiiJson(args)          → restaure les vraies valeurs dans les args
     b. dataToolExecutor.execute(...)→ interroge la vraie base de données
     c. pseudonymizeToolResult(...)  → pseudonymise le résultat avant réinjection

4. Le LLM appelle une action batchable → piiToolGateway.executeActionTool :
     même traitement (pour contact_create/contact_update :
     sanitizeContactMutationArgsAfterPiiRevert est appliqué après le revert)

5. L'intent terminal renvoyé peut contenir des tokens pseudonymisés
   revertPiiJson(intent) → restaure les vraies valeurs avant dispatch
```

### Pseudonymisation des résultats d'outils — `pseudonymizeToolResult`

Table de dispatch `toolResultPseudonymizers` (dans `piiToolGateway.ts`) :

- `managed_fields_get` → passthrough (libellés de config, pas de PII).
- `template_list`, `document_list`, `document_get`, `document_search` → handlers dédiés
  qui pseudonymisent les **champs humainement lisibles** (nom, description, tags,
  excerpt, query…) et **préservent les champs structurels** (`id`, `uuid`, références `*Uuid`,
  `relativePath`, `modifiedAt`, macros de template…) nécessaires aux appels suivants.
- `document_analyze` → `rawContent` et `error` pseudonymisés ; `uuid` / `totalChars` /
  `charsReturned` intacts.
- Action tools batchables → `pseudonymizeActionToolResultAsync` : seuls `feedback` et
  les chaînes imbriquées de `entity` sont pseudonymisés ; `entity.id` / `entity.uuid` / `entity.*Uuid`
  restent verbatim.
- Tout autre outil → `pseudonymizeAuto` (parcourt le JSON, pseudonymise les valeurs
  string, laisse les clés et les chaînes en forme d'UUID intactes).

Un résultat malformé (JSON invalide) **échoue en mode fermé** : le gateway renvoie un
objet d'erreur générique plutôt que la chaîne brute, pour qu'aucune donnée non
pseudonymisée ne puisse atteindre le modèle.

### Cohérence multi-tours

L'historique de conversation stocke toujours la version **pseudonymisée** du contenu.
Les vrais noms ne transitent jamais dans l'historique envoyé au LLM distant. Le revert
n'est appliqué qu'au dernier moment, juste avant le dispatch vers l'application.

---

## 4. Fichiers de référence

| Fichier                   | Rôle                                                                |
| ------------------------- | ------------------------------------------------------------------- |
| `aiToolDefinitions.ts`    | Contrat modèle : définition de tous les outils                      |
| `aiSdkAgentRuntime.ts`    | Boucle outil, gestion de l'historique, récupération modèles faibles |
| `aiService.ts`            | Orchestration : prompt building, wrapping PII, dispatch             |
| `aiSystemPrompt.ts`       | Construction du system prompt tool-mode (contexte + guidance)       |
| `piiToolGateway.ts`       | Wrapping PII unique autour des executors d'outils                   |
| `dataToolExecutor.ts`     | Exécution des data tools + pseudonymisation des résultats           |
| `actionToolExecutor.ts`   | Exécution inline des action tools batchables                        |
| `pii/piiDetector.ts`      | Détection des spans PII (regex + heuristiques)                      |
| `pii/piiPseudonymizer.ts` | Pseudonymisation / revert des textes et JSON                        |
| `aiCommandDispatcher.ts`  | Dispatch des `InternalAiCommand` vers les services métier           |
