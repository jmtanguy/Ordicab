# Ordicab

Ordicab is a desktop application for legal and administrative professionals to manage their dossiers, documents, contacts, and document templates — with flexible AI integration adapted to your security and capability requirements. Built with Electron, React, and TypeScript.

## Core Features

### Data Management

- **Domain management** — Register and switch between local data domains (folder-based workspaces)
- **Dossier management** — Create and track dossiers with status, type, key dates, and key references
- **Document handling** — Read, preview and organize documents (PDF, DOCX, MSG, etc.) attached to dossiers
- **Contact management** — Store and manage contacts per dossier
- **Template engine** — Create rich-text document templates and generate filled documents from dossier data

### AI Integration

- **Multi-mode AI support** — Four distinct integration approaches to handle dossiers and documents according to your constraints
- **Model management** — Configure and switch between different AI sources and deployment modes
- **Multi-language** — French and English UI

## AI Integration Modes

Ordicab supports four flexible AI integration approaches. Choose the mode that best fits your security requirements and capability needs:

### 1. External AI Assistant (Cowork)

Integration with remote AI assistants such as **Claude Cowork**. Your files are organized optimally for AI agents, with an intelligent inbox system and structured intents that ensure robust task execution.

**Best for:** leveraging frontier models with native understanding of your document structure.

### 2. Local Secure Assistant (Ollama)

Deploy an AI assistant directly on your machine using **Ollama**. Your data remains completely local and secure. Processing capability depends on your available hardware.

**Best for:** maximum data privacy and air-gapped environments where all processing stays on-device.

### 3. Remote APIs with Pseudonymization

Standard integration with remote AI APIs. Automatic protection of sensitive personal data through pseudonymization. The model operates exclusively within your application's context and cannot access raw PII.

**Best for:** using standard API-based services while protecting sensitive information.

### 4. Pseudonymized Export for Frontier Models

Innovative solution: export a pseudonymized (not anonymized, for better efficiency) folder for processing by cutting-edge frontier AI models. Reimport the completed work with automatic decoding of pseudonymized data.

**Best for:** intensive work requiring the most advanced models while maintaining data privacy during processing.

## Technical Architecture

Ordicab uses two complementary communication patterns for AI integration, independent of which AI source you choose. Both patterns converge on the same validation and execution layer.

### Communication Patterns

- **Embedded Tool-Driven AI** — Direct in-app tool invocation with immediate execution
- **Delegated AI via Inbox Intents** — File-based intent protocol for external assistants

Both patterns support all four AI integration modes (Cowork, Ollama, Remote APIs, Frontier Export).

### Embedded Tool-Driven AI

Embedded Tool-Driven AI runs inside Ordicab. The application sends the user command plus live dossier, contact, template, and document context to the model. The model calls native tools exposed by Ordicab, resolves structured actions, and Ordicab executes them immediately through the service layer.

**Ordicab is the orchestrator** — it owns the prompt, tool loop, execution flow, and follow-up handling.

**Works with:**

- Ollama (local model via HTTP interface)
- Remote APIs (OpenAI, Anthropic, etc. with proper authentication)

**Strengths:**

- Fast in-app request/response UX
- Immediate context updates after actions
- Good for conversational tasks and clarifications
- No file queue or external session required

**Typical use cases:**

- "Show the contacts in this dossier"
- "Select the mise en demeure template"
- "Generate the document for this contact"
- "Draft an email about this dossier"

### Delegated AI via Inbox Intents

Delegated AI via Inbox Intents is designed for tools such as **Claude Code**, **Claude Cowork**, **Codex**, and **Copilot** working directly in the domain folder. Ordicab generates an instructions file at the domain root, the assistant reads canonical Ordicab files, and all mutations go through delegated JSON intent files written into a watched inbox.

**The external assistant is the orchestrator**, while **Ordicab remains the sole executor of state changes**.

**Works with:**

- Cowork (structured intent-based collaboration)
- Claude Code and other CLI agents
- Remote APIs via delegated protocol

**Supported instruction files:**

- `claude-code` → `CLAUDE.md`
- `cowork` → Inbox-based intent protocol
- `codex` → `AGENTS.md`
- `copilot` → `.github/copilot-instructions.md`

**Strengths:**

- Works with CLI agents already in the domain folder
- Durable, inspectable, file-based workflow
- Safe boundary: assistants never write canonical Ordicab files directly
- Ideal for multi-step tasks like dossier organization
- Response files provide explicit `completed`, `needs_input`, or `failed` states with `nextStep` guidance

**Typical use cases:**

- "Organize this dossier from all the documents"
- "Extract contacts, key dates, and document metadata"
- "Create or update several records in sequence"
- "Work with an external agent for long-running collaborative tasks"

## AI Model Management

Ordicab provides flexible model configuration to support your chosen integration mode:

### Model Configuration

**Local Models (Ollama):**

- Configure Ollama endpoint (default: `http://localhost:11434`)
- Select model variant (e.g., `mistral`, `llama2`, `neural-chat`)
- Configure context window and inference parameters
- All processing remains on your machine

**Remote Models:**

- Configure API credentials (OpenAI, Anthropic, custom endpoints)
- Select model version
- Pseudonymization settings for PII protection
- Rate limiting and quota management

**Cowork Integration:**

- File-based configuration via domain metadata
- Automatic intent routing to Claude Cowork
- Inbox-based response handling

### Handling Sensitive Data Across Integration Modes

**Embedded (Local via Ollama):**

- No data leaves your machine
- Full raw dossier and document context
- Best for confidential data

**Embedded (Remote APIs):**

- Automatic pseudonymization of PII before API calls
- Contact names, addresses, and identifiers replaced with stable pseudonyms
- Model cannot access raw sensitive data
- Response data automatically decoded before insertion

**Delegated (Cowork):**

- Files organized for agent discovery
- Inbox ensures safe boundaries
- Cowork sees file structure but respects Ordicab's execution model

**Delegated (Export & Frontier):**

- Complete folder pseudonymization before export
- Process with frontier models in isolated environment
- Reimport and decode results safely
- Audit trail of what data was shared

### Why Delegated AI uses an inbox

The delegated inbox is not just a convenience. It is the control boundary that makes external AI safe and reliable enough to work on real Ordicab data.

External assistants such as Claude Code, Codex, or Copilot operate outside the Ordicab application process. They can inspect files in the domain folder, but they should not directly modify canonical Ordicab state such as dossier metadata, contacts, templates, or generated documents. Instead, they write one structured JSON intent into a dedicated inbox, and Ordicab remains the only component that performs the actual mutation.

This solves several important problems:

- **Safety**: the assistant never edits `.ordicab` source files directly. Ordicab stays in control of persistence and business rules.
- **Validation**: every delegated action is schema-checked before execution. Invalid payloads become explicit failures instead of corrupting data silently.
- **Durability**: the file-based intent and response flow is inspectable and survives process boundaries better than an in-memory request path.
- **Traceability**: intents and responses make it clear what the assistant asked Ordicab to do and what Ordicab actually did.
- **Multi-step workflows**: external agents often do long tasks. Response files let Ordicab return `completed`, `needs_input`, or `failed` plus a precise `nextStep`.
- **Device scoping**: synchronized domains can appear on multiple machines. The delegated protocol uses `originDeviceId` so only the device that started the workflow continues it.
- **Deduplication and replay protection**: command ids and processed-command tracking prevent the same delegated mutation from being applied twice.
- **Separation of concerns**: the assistant focuses on reading, extracting, and deciding; Ordicab owns execution, validation, and storage.

In short, the inbox makes external AI collaboration predictable. The assistant proposes structured actions, and Ordicab executes them under its own rules.

### Shared action layer

Both architectures converge on the same canonical Ordicab action layer for write operations. That means actions such as `contact.upsert`, `dossier.update`, `template.update`, and `generate.document` share the same validation and execution behavior whether they come from Embedded Tool-Driven AI or from Delegated AI via Inbox Intents.

The difference is the transport and UX:

- Embedded Tool-Driven AI uses in-memory tool calls and immediate execution for speed
- Delegated AI via Inbox Intents uses inbox and response files for safety, traceability, and CLI collaboration

### Delegated action examples

| Action                                                      | Description                                |
| ----------------------------------------------------------- | ------------------------------------------ |
| `dossier.create` / `dossier.update`                         | Create or update a dossier                 |
| `dossier.upsertKeyDate` / `dossier.deleteKeyDate`           | Manage key dates                           |
| `dossier.upsertKeyReference` / `dossier.deleteKeyReference` | Manage key references                      |
| `contact.upsert` / `contact.delete`                         | Manage contacts                            |
| `entity.update`                                             | Update the professional entity profile     |
| `document.saveMetadata` / `document.relocate`               | Update document metadata                   |
| `template.create` / `template.update` / `template.delete`   | Manage templates                           |
| `generate.document`                                         | Generate a filled document from a template |

### Delegated workflow

1. Ordicab generates `CLAUDE.md`, `AGENTS.md`, or `.github/copilot-instructions.md` depending on the selected AI mode
2. The external assistant reads that file as workflow and path guidance
3. The assistant reads canonical Ordicab files directly to discover current state
4. The assistant writes one JSON intent per mutation into the delegated inbox
5. Ordicab watches that inbox, validates and executes the action, and writes a response file with the outcome
6. The assistant follows the response status and `nextStep` before continuing

### Choosing between them

- Use **Embedded Tool-Driven AI** for fast in-app interaction, short task loops, and immediate execution.
- Use **Delegated AI via Inbox Intents** for CLI-based agents, long-running workflows, dossier organization, and auditable multi-step collaboration.

This makes delegated agents effective coworkers for longer-running domain tasks, while the embedded architecture remains the best option for fast in-app interaction.

## Tech stack

- [Electron](https://www.electronjs.org/) + [electron-vite](https://electron-vite.org/)
- [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS v4](https://tailwindcss.com/)
- [Zustand](https://zustand-demo.pmnd.rs/) for state management
- [Tiptap](https://tiptap.dev/) for rich-text editing
- [Zod](https://zod.dev/) for schema validation
- [electron-updater](https://www.electron.build/auto-update) for auto-updates via GitHub Releases

## Development

```bash
npm install
npm run dev
```

## Build & release

```bash
# Local package only
npm run package:mac
npm run package:win

# Publish a release to GitHub (requires GH_TOKEN in .env.local)
npm run publish:mac
npm run publish:win
```

Releases are published to GitHub Releases and auto-updates are delivered automatically to installed clients.
