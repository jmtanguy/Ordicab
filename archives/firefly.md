# Plan — « Ordicab Cloud » : comptes utilisateurs + proxy à clés partagées (PISTE & IA)

## Contexte

Ordicab est une app Electron **100 % locale** pour avocats. Aujourd'hui chaque utilisateur doit fournir
**ses propres** clés, ce qui est un frein majeur à l'adoption :

- **PISTE** (Légifrance/Judilibre) : OAuth2 `client_credentials`, base URL **codée en dur** dans
  [legalService.ts](src/main/services/legal/legalService.ts) (`PISTE_BASE_URL`, `oauthUrl`).
- **IA** : provider compatible OpenAI, base URL **déjà configurable**
  ([remoteProviders.ts](src/shared/ai/remoteProviders.ts), [aiHandler.ts](src/main/handlers/aiHandler.ts)).

**Objectif** : un **proxy** qui détient _ses propres_ clés PISTE + IA. Les utilisateurs inscrits se
connectent **depuis l'app** et accèdent à ces fonctionnalités sans gérer aucune clé, contre un abonnement.

**Principe directeur — rester local-first** : les dossiers, documents et PII **ne quittent pas le poste**.
Le proxy ne relaie que deux flux externes (recherche légale + IA) et ne stocke **aucune donnée de dossier**
— uniquement compte (email/hash) + métrage d'usage. C'est la posture RGPD la plus défendable.

### Décisions validées

- **Modèle éco.** : abonnement mensuel (Stripe) + **quotas/métrage** par utilisateur.
- **Auth & BDD** : **Supabase région EU**.
- **Hébergement du proxy** : **Supabase Edge Functions** (un seul backend) ; repli CleverCloud si besoin.
- **IA** : **3 fournisseurs supportés dès le départ — Infomaniak, OVH, Scaleway** — commutables par **config
  serveur** (sans toucher au code ni à l'app). Infomaniak **actif** au démarrage (compte déjà existant).
- **Surface / connexion** : **login dans l'app** = formulaire email/mot de passe exécuté en **main
  process** → Supabase Auth, session dans le keychain (**option A**). **Inscription + paiement sur le web**
  (couplés à Stripe Checkout) ; gestion d'abonnement via le **portail Stripe déclenché depuis l'app**.
  L'option **B** (« login via navigateur » + deep-link `ordicab://`, requise pour social-login/SSO Google /
  Microsoft 365) est **planifiée comme évolution additive**, pas pour le MVP.
- **Code** : un repo **privé `ordicab-cloud`** contient _tout_ le commercial (backend Supabase **+** site
  web complet) ; le `docs/` actuel est **déplacé** hors du repo public.
- **Mode double conservé** : l'app garde « mes propres clés » (local, open source) **et** ajoute « Compte
  Ordicab Cloud ». Essentiel pour le **secret professionnel** (les plus prudents restent BYO-key / IA locale).

## Architecture cible

```
┌──────────────────┐                       ┌──────────────────────────────────────┐
│  App Electron    │  1. login ──► JWT     │  Supabase EU   (UN SEUL backend)     │
│  (local-first)   │ ────────────────────► │  • Auth + Postgres                   │
│  dossiers / PII  │                       │      (profiles, subscriptions,       │
│  restent LOCAUX  │  2. JWT bearer        │       usage, cache token PISTE)      │
│                  │   /legal · /ai/v1 ──► │  • Edge Functions = PROXY            │
└──────────────────┘                       │      JWT · quota · route · stream ·  │
                                           │      métrage · rate-limit            │
                                           └───────────────┬──────────────────────┘
                                    clés serveur           │
                          ┌────────────────────────────────┴───────────────┐
                          ▼                                                 ▼
                  ┌──────────────┐                              ┌────────────────────────┐
                  │ PISTE (DILA) │                              │ LLM (compatible OpenAI)│
                  │ Légifrance / │                              │ Infomaniak·OVH·Scaleway│
                  │ Judilibre    │                              │ (actif = config serveur)│
                  └──────────────┘                              └────────────────────────┘

  Stripe ──webhook──► Supabase (statut d'abonnement)
  Site web (repo privé ordicab-cloud/web → OVH statique) : marketing + guide + pages compte
  Repli si limites Edge dépassées : déplacer le proxy vers CleverCloud (PaaS FR, git push)
```

### Ce que vous gérez réellement

| Composant                                | Hébergé par                 | À gérer                        |
| ---------------------------------------- | --------------------------- | ------------------------------ |
| Auth + BDD + **proxy** (Edge Functions)  | **Supabase** (1 projet, EU) | 1 projet Supabase              |
| Paiement (Checkout + portail client)     | **Stripe** (pages Stripe)   | 1 compte Stripe                |
| IA (Infomaniak · OVH · Scaleway) & PISTE | Fournisseurs externes       | comptes API (appels HTTPS)     |
| Site web (marketing + guide + compte)    | **OVH** (statique)          | repo privé `ordicab-cloud/web` |
| App de bureau                            | Poste de l'utilisateur      | ajout d'un mode « connexion »  |

### Dépôts & déploiement

| Dépôt / cible                 | Contenu                                                                                                                                               | Visibilité          | Déploiement                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------- |
| **`Ordicab`** (existant)      | **App Electron uniquement** — `docs/` **retiré**                                                                                                      | public (Apache-2.0) | GitHub Releases                                                   |
| **`ordicab-cloud`** (nouveau) | `web/` = site complet (marketing + guide + compte) · `supabase/functions/` (`legal`, `ai`, `stripe-webhook`) · `supabase/migrations/` · `config.toml` | **privé**           | `web/` → **OVH** ; `supabase/` → **Supabase CLI** (GitHub Action) |
| **Projet Supabase** (cloud)   | Auth + Postgres + Edge Functions en exécution                                                                                                         | —                   | provisionné depuis `ordicab-cloud`                                |

- **Migration `docs/`** : déplacer l'actuel `docs/` (index + 12 pages de guide + images) vers
  `ordicab-cloud/web`. Conséquence assumée : la _source_ de la doc quitte le repo open-source (le site OVH
  reste en ligne) ; les MAJ de doc ne sont plus couplées aux PR de l'app.
- **Aucun secret dans les dépôts** : PISTE, clés IA, Stripe `secret`, `service_role` → **variables d'env
  Supabase** / GitHub Secrets. Seules les clés **publiables** (URL + anon Supabase, clé publiable Stripe)
  figurent dans `web/`, ce qui est leur usage prévu.

#### Organisation de `ordicab-cloud` en **deux parties**

```
ordicab-cloud/
├── web/                     ← PARTIE 1 : site marketing + guide + INSCRIPTION (+ Stripe CÔTÉ CLIENT)
│   ├── index.html, guide/…  (depuis l'actuel docs/)
│   ├── inscription/         (création de compte via supabase-js + Stripe Checkout) — PAS de login ici
│   ├── apres-paiement/      (page « ouvrez l'app et connectez-vous »)
│   └── legal/               (CGU, DPA, politique de confidentialité)
│         → déploiement : OVH statique
└── supabase/                ← PARTIE 2 : backend
    ├── functions/
    │   ├── legal/           (proxy PISTE : OAuth serveur + cache token)
    │   ├── ai/              (proxy IA compatible OpenAI, streaming + métrage)
    │   ├── billing/         (créer Checkout Session + Customer Portal Session)
    │   └── stripe-webhook/  (Stripe → statut d'abonnement en base)
    ├── migrations/          (schéma : profiles, subscriptions, usage_counters, piste_token)
    └── config.toml
          → déploiement : Supabase CLI (db push + functions deploy)

(Login = dans l'app, pas sur le web. La gestion d'abonnement est déclenchée depuis l'app : bouton « Gérer
mon abonnement » → Edge Function `billing` → URL du portail Stripe → ouverture navigateur.)
```

- **Stripe est réparti** : intégration **client** (Checkout/Portal) dans `web/stripe/` ; **webhook serveur**
  (vérité sur l'abonnement) dans `supabase/functions/stripe-webhook/`.
- Les deux parties se déploient **indépendamment** (OVH vs Supabase) et ne partagent que des clés publiables.

#### Prérequis (vérifiés)

- ✅ **Sibling** `/Users/tanguyj/Dev/GitHub/ordicab-cloud` libre, parent inscriptible (hors répertoires de
  travail actuels → à ajouter / approuver lors de la création).
- ✅ **GitHub** `jmtanguy`, scopes `repo` (repo **privé** OK) + `workflow` (Actions OK).
- ✅ **Supabase CLI** installée (Deno embarqué par la CLI → pas d'install Deno séparée). **Node** v24.
- ⚠️ **Stripe CLI** à installer plus tard pour tester les webhooks en local (`brew install stripe/stripe-cli/stripe`).

### Synchronisation entre `Ordicab` (app) et `ordicab-cloud` (backend + web)

**Pas de sync de données.** Les deux dépôts sont reliés **uniquement au runtime** par HTTPS (app → proxy).
Ce qu'il faut garder cohérent tient en trois mécanismes :

1. **Contrat ASYMÉTRIQUE — rien de sensible côté public.** Le repo public ne contient **que** le strict
   nécessaire client : la **base URL** (config), le **JWT bearer**, et les **types requête/réponse qu'il
   possède déjà** (les formes _legal_ = API publique Légifrance ; l'IA = protocole **OpenAI standard**).
   **Par construction**, l'interface générique (`/v1/legal`, `/ai/v1` compatible OpenAI) **masque** quel
   fournisseur IA, quelle logique de quota et quel routage sont utilisés — tout cela vit **uniquement** dans
   le repo privé.
   - **La définition faisant foi du contrat + les tests de conformité vivent dans `ordicab-cloud` (privé).**
     L'asymétrie joue en votre faveur : le backend (privé) **peut lire l'app open-source** pour savoir
     exactement à quoi rester compatible ; l'app, elle, **n'a pas besoin** du contrat backend → on **ne
     recopie aucun contrat dans le repo public**, donc zéro fuite.
   - **Erreurs génériques** : le backend renvoie des codes neutres (`quota_exceeded`,
     `subscription_inactive`) + un message à afficher ; les **seuils, tiers, noms de modèles et fournisseurs
     restent serveur** — l'app n'en connaît jamais les valeurs.
2. **Découplage par domaine stable.** L'app (binaire distribué) appelle le proxy via un **domaine custom
   stable `api.ordicab.com`** (mappé sur les Functions Supabase) — **jamais** `xyz.supabase.co` en dur. On
   peut alors déplacer/reconfigurer le backend (voire migrer vers CleverCloud) **sans re-livrer l'app**.
   URL + anon key Supabase (publiables) = simple config de build (app & web).
3. **Compatibilité de versions (déploiements découplés).** L'app part en GitHub Releases à sa cadence, le
   backend via Supabase CLI à la sienne ; de **vieilles versions d'app restent installées** :
   - **Versionner l'API** (`/v1/...`) et **ne jamais casser `v1`** tant que des apps en dépendent ; un
     breaking change → `/v2`.
   - L'app envoie un header `X-Ordicab-Version` ; le backend peut répondre une erreur structurée
     « mise à jour requise » sous un seuil minimal.

```
Ordicab (PUBLIC) : base URL + JWT + types standards (Légifrance / OpenAI)
   │  ne contient AUCUN détail backend (fournisseurs, quotas, routage, seuils)
   ▼ HTTPS
api.ordicab.com ──► ordicab-cloud (PRIVÉ) : contrat faisant foi + logique + tests de conformité
                     (le privé lit l'app publique pour rester compatible ; l'inverse n'est pas nécessaire)
```

## Choix techniques

- **Langage : TypeScript partout** — _pas_ PHP/Python/Java. Les Edge Functions tournent en **Deno/TS** (API
  web standard `fetch`/`Request`/`Response`) ; on réutilise types, schémas Zod et
  [remoteProviders.ts](src/shared/ai/remoteProviders.ts).
- **Proxy = Supabase Edge Functions** : vit _dans_ Supabase, à côté de l'auth et de la BDD → **zéro serveur,
  zéro TLS, zéro patch OS**. Réserves : (a) **plan payant** (plafond **400 s/req** vs 150 s gratuit ;
  suffisant pour du streaming IA qui émet immédiatement) ; (b) **cache du token PISTE en Postgres**
  (instances éphémères, pas de cache mémoire fiable).
  - **OVH écarté pour l'hébergement** : pas de vrai PaaS Node (VPS à administrer soi-même, ou produit Labs
    instable). Co-localiser le proxy avec l'IA OVH **n'apporte rien** (simple appel HTTPS).
  - **Repli** si on dépasse les limites Edge (>400 s, cold starts) : **CleverCloud** (PaaS FR, `git push`,
    auto-TLS, zéro-ops). Code TS réutilisable.
- **Auth + BDD : Supabase EU (Francfort)** + DPA. L'auth managé (hash, JWT, magic-link, MFA, reset) évite de
  coder soi-même la couche la plus sensible aux failles.
- **Paiement : Stripe** (Checkout + Customer Portal) — abonnements, factures, TVA, relances. Webhook →
  Supabase pour synchroniser le statut.
- **IA : 3 fournisseurs supportés dès le départ — Infomaniak, OVH, Scaleway — commutables par config
  serveur.** Tous compatibles OpenAI → un **registre de providers côté serveur** (base URL + clé + modèles
  par fournisseur) ; le fournisseur **actif** est choisi par **variable d'environnement**, sans toucher au
  code ni à l'app (qui ne voit que `/ai/v1`). Bascule à chaud Infomaniak ↔ OVH ↔ Scaleway.
  - **Infomaniak** (`…/openai/v1`, CH, no-training contractuel) = **actif au démarrage** (compte existant).
    ⚠️ plafond **~60 req/min non augmentable** → throttle global.
  - **Scaleway** (`api.scaleway.ai/v1`, Paris, **300/600 req/min**, no-training, GA) et **OVHcloud AI
    Endpoints** (`oai.endpoints.kepler.ai.cloud.ovh.net/v1`, Gravelines, **400 req/min**, zéro-rétention)
    **prêts** à devenir actifs par simple config (charge/souveraineté).
  - **Évolution** : **routage/failover automatique** entre les trois (sur 429/5xx) ; Mistral en option.
  - **Clever Cloud** = passerelle (alpha privée), **pas** un fournisseur d'inférence.
- **Métrage IA** : les réponses OpenAI renvoient `usage` ; en streaming, demander
  `stream_options: { include_usage: true }` pour récupérer les tokens dans le chunk final.

## Schéma Supabase (minimal, RLS activé)

- `profiles` : `id` (= `auth.users.id`), `stripe_customer_id`, `plan`, `created_at`.
- `subscriptions` : `user_id`, `status`, `plan`, `current_period_end`, `stripe_subscription_id`.
- `usage_counters` : `user_id`, `period`, `ai_input_tokens`, `ai_output_tokens`, `piste_requests`
  (agrégé par période → vérif. quota rapide). Optionnel `usage_events` détaillé pour audit.
- `piste_token` : cache du token OAuth PISTE (valeur + expiration), partagé entre instances Edge.
- **RLS** : chaque utilisateur ne lit que ses propres lignes ; le proxy écrit via `service_role`.

## Responsabilités du proxy (Edge Functions)

1. **Valider le JWT Supabase** (signature via secret JWT / JWKS).
2. **Vérifier abonnement actif + quota restant** (`subscriptions` / `usage_counters`).
3. **`/legal/*`** : injecter l'OAuth PISTE côté serveur (clientId/secret en variables d'env, **token caché
   en Postgres**), forwarder vers `api.piste.gouv.fr`, métrer les requêtes. Judilibre : faire respecter
   l'**interdiction de profilage des magistrats** et router les **demandes d'occultation**.
4. **`/ai/v1/*`** : passthrough OpenAI vers le **fournisseur actif** (choisi par config serveur parmi
   **Infomaniak / OVH / Scaleway** — registre de providers), **streaming SSE** (`stream_options:
include_usage`), métrer les tokens. **Routage/failover** (sur 429/5xx → autre fournisseur) prévu dès la
   conception du registre.
5. **Rate-limiting** : (a) **par fournisseur** (plafond du fournisseur actif — ≈60 req/min si Infomaniak,
   300/600 si Scaleway, 400 si OVH — via throttle global Upstash) ; (b) **par utilisateur** (protège le
   quota PISTE partagé + plafonne les coûts IA).
6. **Aucun logging du corps** des requêtes/réponses (prompts = PII potentielle). Logs = métadonnées
   uniquement (user id, modèle, tokens, timestamp).
7. **`billing`** (fonctions hors proxy) : `create-checkout-session` (appelée par la page web d'inscription)
   et `create-portal-session` (appelée par l'app, JWT requis) → renvoient une URL Stripe ; `stripe-webhook`
   met à jour `subscriptions` (source de vérité de l'abonnement).

## Modifications côté app Electron (mode « Ordicab Cloud »)

Tout reste **additif** (le mode BYO-key local n'est pas touché). Le code public ne porte que le client
générique — voir « Contrat asymétrique ». Détail par couche, ancré sur le code existant :

### A. Nouveau service d'auth Cloud (main process)

- **Nouveau `src/main/services/cloud/cloudAuthService.ts`** : `login(email, password)`, `logout()`,
  `getAccessToken()` (JWT en mémoire), `refresh()`, `getSession()`. Appelle l'**API Auth Supabase** (REST ou
  supabase-js en Node) — **option A, exécuté en main process**, jamais dans le renderer.
- **[credentialStore.ts](src/main/lib/system/credentialStore.ts)** (API existante `saveSecret/getSecret/
deleteSecret/hasSecret`, l.9-14) : nouvelle clé `ordicab.cloud.refreshToken`. Le JWT d'accès reste en
  mémoire ; seul le refresh token est persisté (chiffré `safeStorage`).
- **Nouveau handler `src/main/handlers/cloudHandler.ts`** + canaux dans
  [channels.ts](src/shared/contracts/channels.ts) : `cloud:login`, `cloud:logout`, `cloud:session`,
  `cloud:status`. Enregistré dans [container.ts](src/main/container.ts) comme les autres
  (`registerAiHandlers`, l.1251). Bridge : ajouter un namespace `cloud.*` dans
  [preload/api.ts](src/preload/api.ts) (modèle de `ai.*`, l.358-375).
- **Nouveau store `src/renderer/stores/cloudStore.ts`** (modèle [aiStore.ts](src/renderer/stores/aiStore.ts))
  - **écran de login** (réutilise le pattern Dialog de
    [LegalSettings.tsx](src/renderer/features/settings/LegalSettings.tsx)), inséré dans
    [SettingsPanel.tsx](src/renderer/features/domain/SettingsPanel.tsx). Liens : « Créer un compte » → ouvre le
    **web** (inscription + paiement) ; « Mot de passe oublié » → reset Supabase ; « Gérer mon abonnement »
    → `billing` → **portail Stripe** dans le navigateur.

### B. Legal — router vers le proxy en mode Cloud

- **[legalService.ts](src/main/services/legal/legalService.ts)** : rendre `PISTE_ENDPOINTS` (l.131-137,
  utilisé par `LegifranceClient`/`JudilibreClient`) **injectable**, et introduire une **stratégie de token**
  derrière `getAccessToken()` (l.582-596) :
  - _local_ (inchangé) : `PisteAuthClient` (OAuth `client_credentials`, l.598-628).
  - _cloud_ : endpoints = `api.ordicab.com/v1/legal`, le « token » renvoyé = **JWT Ordicab** (via
    `cloudAuthService`). `authenticatedJson()` (l.566-580) **retry déjà sur 401** → en cloud, `invalidate()`
    déclenche un `refresh()` du JWT au lieu d'un re-OAuth. **Aucun autre changement** dans les méthodes de
    recherche (le header `Authorization: Bearer …` est déjà générique).
- Le **mode** (local/cloud) est décidé dans [legalHandler.ts](src/main/handlers/legalHandler.ts) /
  [container.ts](src/main/container.ts), qui injecte la stratégie + les endpoints.

### C. IA — réutiliser le provider distant existant

- En mode Cloud, configurer le provider distant déjà en place : `remoteProvider` =
  `api.ordicab.com/ai/v1`, `apiKey` = **JWT Ordicab**. Passe par
  [aiHandler.ts](src/main/handlers/aiHandler.ts) (`settingsSave`, `AI_REMOTE_API_KEY_SECRET`, l.46/252) et
  `normalizeOpenAiCompatibleBaseUrl` (déjà OpenAI-compatible) → **changement minimal**. Réutiliser le `mode`
  AI existant (`AiMode`, et le canal `ai:cloud-provider-status` déjà présent) plutôt que d'en créer un.

### D. Toggle de mode unique

- Un réglage « Mes propres clés (local) » ↔ « Compte Ordicab Cloud » qui, en cloud : (1) bascule la
  stratégie legal (B), (2) pré-remplit le provider IA (C). Persister le mode dans `appState` (modèle des
  réglages existants). En cloud, masquer les champs de clés locales (PISTE clientId/secret, clé IA).

## Site web (repo `ordicab-cloud/web`, statique sur OVH)

- **Migration** : déplacer `docs/` (marketing + 12 pages de guide + images) dans `ordicab-cloud/web` et le
  **retirer du repo public**.
- **Pages ajoutées** : **inscription** (création de compte via `supabase-js` + redirection Stripe Checkout
  via l'Edge Function `billing`), page **après-paiement** (« ouvrez l'app et connectez-vous »), **CGU/DPA/
  confidentialité**. **Pas de login ni de tableau de bord sur le web** : le login est dans l'app et la
  gestion d'abonnement passe par le portail Stripe (déclenché depuis l'app).
- Reste du **HTML statique** (cohérent avec l'existant) — pas de framework ; `supabase-js` et Stripe sont
  appelés côté client. Seules les clés **publiables** sont dans le code.

## RGPD & conformité

- **Rôles** : l'avocat = _responsable de traitement_ ; vous = _sous-traitant_ (art. 28) → fournir un **DPA**.
- **Sous-traitants ultérieurs** : Supabase (EU), **IA** = Infomaniak (CH — adéquation EU, _no-training_) /
  OVH / Scaleway (FR) selon config, Stripe (facturation), **Resend** (emails), **Upstash** (rate-limit, EU),
  DILA/PISTE (données publiques), + CleverCloud si repli. Hébergement **EU/adéquat**. Tenir la **liste à
  jour dans le DPA**.
- **Minimisation** : pas de rétention du contenu des prompts/requêtes ; logs = métadonnées de facturation.
  TLS partout. Droit à l'effacement = suppression compte + métrage.
- **Secret professionnel** : garder BYO-key + IA locale embarquée comme options pour les plus prudents.

## ✅ Verrous de conformité — VÉRIFIÉS (sources primaires, juin 2026)

Les trois verrous sont **levés : feu vert, sous conditions.**

1. **PISTE/DILA — multi-tenant AUTORISÉ.** Aucune clause anti-revente dans les CGU ; la CGU PISTE §3.1.3
   anticipe « le nombre d'utilisateurs qui peuvent être servis ». **Seule règle dure** (§3.1.2 /
   Légifrance §III.3 / Judilibre §XI.C) : les clés sont **réservées à l'application** et ne doivent **jamais
   être divulguées à un tiers** → garder les clés **côté serveur** = conforme (un « BYO-key revendu » serait
   en infraction).
   - **Quotas = par application** (bucket partagé), non publics (console PISTE). → **Action** : demander
     l'inscription **production + hausse de quota** à la DILA en déclarant le modèle éditeur multi-tenant
     (retours-legifrance-modernise@dila.gouv.fr ; judilibre.courdecassation@justice.fr).
   - **Obligations Judilibre** : interdiction du profilage des magistrats (COJ L.111-13, sanction pénale) ;
     transmission des demandes d'occultation à la Cour de cassation.
   - **Données Légifrance** : Licence Ouverte/Etalab 2.0 — réuse commercial autorisé avec attribution.
2. **IA (Infomaniak / OVH / Scaleway) — multi-tenant OK pour les 3.** Tous compatibles OpenAI, posture
   **no-training**, EU/adéquat. **Infomaniak** (CH, no-training contractuel — Conditions LLM Art. 6, rév.
   07/10/2025 ; la _Politique d'API_ Art. 5.1 impose une politique de confidentialité aux utilisateurs
   finaux, couverte par le site) est **actif au démarrage** ; ⚠️ **plafond ~60 req/min non augmentable** →
   throttle global. **OVH** (Gravelines FR, 400/min, zéro-rétention) et **Scaleway** (Paris FR, 300/600/min,
   no-training, GA) sont **supportés dès le départ**, activables par config.
   - **Action** : obtenir le **DPA** du/des fournisseur(s) activé(s) ; figer les IDs de modèles ;
     re-télécharger les CGU datées à la signature.
3. **Supabase EU — défendable (données de compte uniquement).** Régions **Paris/Frankfurt** épinglent BDD
   **et** auth. **DPA + SCC 2021/914 (Module 2)**, SOC 2 / ISO 27001. **Réserve** : maison-mère **US** →
   exposition résiduelle CLOUD Act = _résidence_ et non _souveraineté_ ; proportionné car **aucune donnée
   client/dossier** en base. **Repli souveraineté** si un Ordre l'exige : Postgres FR (Scaleway/CleverCloud)
   - auth auto-hébergée (Ory/Keycloak), ou Supabase auto-hébergé.

**À produire avant mise en ligne** : **DPA + politique de confidentialité** Ordicab.

## Robustesse & améliorations (2ᵉ passe — vérifiées juin 2026)

L'architecture/conformité sont solides ; ces points la rendent **production-robuste**.

### 🔴 Haute priorité

- **Contrôle des coûts / abus IA** : le coût n'est connu **qu'après** la réponse → ajouter plafond
  `max_tokens`/requête, **limite de taille de prompt**, **hard-stop** de quota (avec marge), **concurrence
  max/utilisateur**, et **annulation de l'appel upstream sur déconnexion client** en cours de stream
  (propager `AbortSignal`, métrer la complétion partielle).
- **Rate-limiting GLOBAL en serverless** : Edge Functions **stateless** → un compteur mémoire ne tient pas.
  Utiliser **Upstash Global Redis + `@upstash/ratelimit`** (pattern officiel Supabase, client REST, region
  EU). Le plafond dur **60 req/min Infomaniak** exige un **token-bucket + backoff/file** (le rate-limiter
  _rejette_, il ne met pas en file) → **renforce l'intérêt de passer à Scaleway tôt**. ⚠️ Upstash = un petit
  2ᵉ fournisseur ; ne pas se fier au cache mémoire per-instance pour le plafond global.
- **Fiabilité webhook Stripe** : **idempotence** (table des `event.id` traités), + **job de réconciliation**
  (poll Stripe périodique) en filet. Gérer les **états** (`trialing`, `past_due` → période de grâce,
  `canceled`, `incomplete`) et **vérifier l'abonnement en base à CHAQUE requête** (un JWT reste valide après
  annulation, jusqu'à expiration).
- **Emails d'auth → SMTP custom obligatoire** : le sender Supabase par défaut = **2/h, « pas pour la prod »**.
  Utiliser **Resend** (SMTP custom Supabase) depuis **`ordicab.com`** avec SPF/DKIM/DMARC.

### 🟡 Moyenne priorité

- **Domaine custom `api.ordicab.com`** : natif Supabase, **add-on payant (~10 $/mois/projet)**. ⚠️
  `SUPABASE_URL` dans les functions reste l'hôte d'origine → construire les URLs auto-référentielles
  (callbacks Stripe, liens) depuis une **config**, pas `SUPABASE_URL`. (Confirme le découplage voulu.)
- **Observabilité & alertes** : error tracking (Sentry), **alertes coût/usage** (seuil dépense IA, approche
  du quota PISTE), monitoring uptime.
- **UX app « connecté mais sans abonnement actif »** : mapper `subscription_inactive` / `quota_exceeded` à
  des écrans clairs (proposer l'abonnement, ou revenir en mode local) — pas un échec brut.

### 🟢 À acter (mineur)

- **Cache token PISTE single-flight** (lock sur `piste_token`) pour éviter le thundering herd au refresh.
- **CGU end-user + clause de non-garantie** (l'IA peut halluciner du droit ; vous relayez des données PISTE).
- **PITR/sauvegardes** Supabase (plan payant), **rotation des secrets** (surtout `service_role`), **process
  RGPD** (export/effacement de compte).
- **Tests backend** : `supabase functions serve` + tests Deno + CI du repo privé + tests de contrat (2 côtés).

## Phasage

- **Phase 0 — Conformité** : DILA (production + quota), DPA Infomaniak, rédaction **DPA + politique de
  confidentialité + CGU end-user (avec clause de non-garantie** sur l'exactitude IA/légale).
- **Phase 1 — Amorçage `ordicab-cloud`** : créer le **repo privé** (sibling), poser la structure **deux
  parties** (`web/` + `supabase/`) avec `supabase init`, `.gitignore`, et la GitHub Action de déploiement.
  Premier push privé.
- **Phase 2 — Supabase EU** : projet + schéma (profiles/subscriptions/usage_counters/piste_token +
  `stripe_events` pour l'idempotence) + RLS. **Domaine custom `api.ordicab.com`** + **SMTP via Resend**
  (`ordicab.com`, SPF/DKIM/DMARC). Produits Stripe + Customer Portal + webhook **idempotent** → Supabase
  (états `trialing`/`past_due`/`canceled`) + **job de réconciliation**. **Durcissement** : activer
  **PITR/sauvegardes**, secrets en variables d'env (jamais en repo), plan de **rotation** du `service_role`.
- **Phase 3 — Proxy (Edge Functions, plan payant)** : validation JWT, quota **hard-stop** (vérif. abonnement
  en base à chaque requête), passthrough PISTE (OAuth + token caché en Postgres **single-flight**) et IA via
  un **registre 3 fournisseurs (Infomaniak actif, OVH + Scaleway configurables)** commutable par config
  (streaming + métrage + **annulation sur déconnexion** + caps `max_tokens`/taille prompt).
  **Rate-limiting global via Upstash Redis** (token-bucket dimensionné au fournisseur actif). **Observabilité**
  (Sentry + alertes coût/quota). _(Repli hébergement CleverCloud si limites Edge dépassées.)_
- **Phase 4 — App mode Cloud** : **login option A** (formulaire email/mot de passe → Supabase Auth en main
  process), session dans credentialStore, `PISTE_BASE_URL` configurable + branche auth Cloud dans
  legalService, auto-config base URL IA, refresh token, bouton « Gérer mon abonnement » → `billing`.
  **UX dégradée** : `subscription_inactive`/`quota_exceeded` → écran clair (s'abonner / revenir en local).
- **Phase 5 — Site web (`ordicab-cloud/web`)** : déplacer `docs/` hors d'Ordicab vers `web/`, ajouter pages
  inscription (`supabase-js`), `web/stripe/` (Checkout/Portal), `web/legal/` (CGU end-user/DPA/
  confidentialité). Déploiement OVH.
- **Phase 6 — Vérification** (ci-dessous).
- **Phase 7 (ultérieure, déclenchée par la charge) — Failover IA automatique** : activer le routage/failover
  auto entre Infomaniak/OVH/Scaleway (déjà supportés) sur 429/5xx ; Mistral en option. Aucune modif de l'app.
- **Phase 8 (ultérieure, sur besoin) — Login option B (navigateur/SSO)** : flux « se connecter via le
  navigateur » + deep-link `ordicab://` (PKCE), pour activer le social-login Google / Microsoft 365.
  Ajout additif au login A, pas une refonte.

## Vérification

- **Proxy isolé** : avec un JWT de test, `curl` sur `/legal/search` et `/ai/v1/chat/completions` → forward
  correct, streaming IA OK, incrément des compteurs d'usage en base.
- **Quota** : épuiser le quota d'un compte test → refus propre (429/402) côté proxy **et** message clair côté
  app.
- **Bout-en-bout** : connexion en mode Cloud, recherche Légifrance + requête IA **sans aucune clé locale** →
  succès ; rafraîchissement de JWT à expiration (401 → refresh → retry).
- **Bascule de mode** : Cloud ↔ BYO-key sans casser l'état ; les clés locales restent fonctionnelles.
- **Bascule de fournisseur IA** : changer la config serveur Infomaniak → OVH → Scaleway et vérifier que
  l'app fonctionne sans modification (elle ne voit que `/ai/v1`).
- **Robustesse** : déconnexion client en cours de stream → l'appel upstream est annulé (pas de surcoût) ;
  webhook Stripe rejoué → idempotent (pas de double-traitement) ; throttle Upstash → le plafond global tient
  sous charge concurrente.
- **RGPD** : confirmer qu'aucun corps de prompt/requête n'apparaît dans les logs du proxy.
- **Tests** : `npm test` (Vitest) côté app (legalService, credentialStore) ; **backend** `supabase functions
serve` + tests Deno + **tests de contrat des 2 côtés** en CI.
- **Revue de sécurité** avant ouverture publique (validation JWT, isolation des secrets, RLS).
