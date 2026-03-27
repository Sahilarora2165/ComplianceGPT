# ComplianceGPT Project Context

## Overview
ComplianceGPT is a compliance operations platform for CA firms. The backend orchestrates the full workflow for monitoring regulatory circulars, matching them to affected clients, generating advisory drafts, tracking deadlines, maintaining audit history, and answering analyst queries from the knowledge base.

The frontend is now aligned to this backend and reads real operational state from backend endpoints instead of relying on mock UI flows.

## Backend Responsibilities
The backend currently handles these major areas:

1. Regulatory monitoring
2. Client matching
3. Draft generation
4. Deadline scanning and prevention
5. Audit event logging
6. Analyst query / retrieval
7. Scheduler and pipeline control

## Pipeline Flow
The main orchestration path is driven by:

- `POST /pipeline/run`
- `GET /pipeline/status`

The pipeline currently runs in stages:

1. Monitoring
   - collects new circulars from configured regulator sources
   - stores results in `new_documents`

2. Matching
   - maps circulars to affected clients using client records and regulatory context
   - stores results in `match_results`

3. Drafting
   - generates advisory drafts for matched client/circular combinations
   - stores results in `drafts`

4. Status updates
   - backend updates pipeline state incrementally during long runs
   - frontend polls the state to show live progress

## Pipeline Status Model
`GET /pipeline/status` is the main state endpoint used by the dashboard and pipeline-aware pages.

Important fields include:

- `new_documents`
- `match_results`
- `drafts`
- `total_circulars`
- `total_matches`
- `total_drafts`
- `last_run`
- `run_mode`
- `status`
- `stage`
- `status_message`
- `started_at`
- `updated_at`

This endpoint is now updated during execution, so the UI can reflect progress while the pipeline is still running.

## Persisted Pipeline State
The latest pipeline result is persisted to disk and reloaded on startup.

Purpose:

- dashboard state survives backend restart
- latest run context remains visible after reboot
- counts do not reset to zero just because the service restarted

## Draft Workflow
Draft endpoints:

- `GET /drafts`
- `POST /drafts/{draft_id}/approve`

Draft objects can include:

- `draft_id`
- `client_name`
- `client_email`
- `client_contact`
- `circular_title`
- `regulator`
- `priority`
- `circular_summary`
- `actions`
- `deadline`
- `risk_level`
- `penalty_if_missed`
- `applicable_sections`
- `email_subject`
- `email_body`
- `internal_notes`
- `source_chunks`
- `model_used`
- `generated_at`
- `version`
- `status`

Frontend `Draft Review` is restricted to backend-supported review actions and does not invent unsupported delivery or editing flows.

## Deadline Prevention System
Deadline-related endpoints:

- `GET /deadlines`
- `GET /deadlines/summary`
- `POST /deadlines/scan`
- `POST /deadlines/{alert_id}/send`

After merging the `feature/deadline_prevention` branch, deadline alerts now come from two backend sources:

- `clients_json`
  - recurring obligations defined in client records
- `draft`
  - deadlines derived from generated advisory drafts

Important alert fields now include:

- `alert_id`
- `client_id`
- `client_name`
- `obligation_type`
- `due_date`
- `level`
- `generated_at`
- `source`
- `draft_id`
- `deadline_format`
- `deadline_raw`
- `client_email`
- `client_contact`
- `headline`
- `recommended_action`
- `risk_level`
- `penalty`
- `exposure.exposure_rupees`
- `exposure.exposure_label`
- `advisory_email.subject`
- `advisory_email.body`

This means deadline handling is now both:

- proactive, from known client obligations
- reactive, from newly generated advisory drafts

## Deadline Alert Sending
The backend now supports sending or triggering deadline alerts directly from alert records:

- `POST /deadlines/{alert_id}/send?ca_name=...`

Frontend `Deadline Watch` is aligned to this and can trigger alert sending without changing backend code.

## Client Registry
Client data is exposed through:

- `GET /clients`

Client records include:

- `id`
- `name`
- `constitution`
- `industry`
- `tags`
- `identifiers`
- `contact`
- `regulatory_profile`
- `active_obligations`
- `risk_profile`
- `priority`

This client structure is used by:

- client profile views
- matching logic
- deadline scanning
- risk presentation

## Audit Trail
Audit endpoint:

- `GET /audit`

Audit events generally include:

- `timestamp`
- `agent`
- `action`
- `details`

Depending on the event source, additional metadata may also be present. The frontend renders audit details generically so it can handle varying payload structures.

## Scheduler and Operational Control
Operational endpoints:

- `GET /scheduler/status`
- `POST /scheduler/trigger`
- `POST /pipeline/reset`

These support:

- checking scheduler state
- viewing scheduled jobs
- manually triggering monitoring
- resetting pipeline state

Frontend `Pipeline Control` is wired directly to these endpoints.

## Analyst Query
Research endpoint:

- `POST /query`

Purpose:

- answer analyst questions using the ingested knowledge base
- return grounded answers with sources or citations when available

Frontend `Analyst Query` is connected to this endpoint and is intentionally designed as a single-turn backend-driven research interface.

## Frontend Pages Connected to Backend
The following pages now use real backend endpoints:

- Dashboard
- Circulars Monitor
- Draft Review
- Deadline Watch
- Client Profiles
- Audit Trail
- Pipeline Control
- Analyst Query

## Frontend Alignment to Backend Deadline Changes
Frontend has been updated to match the new deadline-prevention backend behavior:

- supports `POST /deadlines/{alert_id}/send`
- reads real deadline alert metadata
- shows backend-driven `headline` and `recommended_action`
- distinguishes alert source:
  - `Generated Draft`
  - `Client Profile`

No backend logic was changed during this alignment work.

## Current Runtime Model
The current product model is:

- backend computes state
- frontend polls backend state
- no websocket event bus yet
- long-running pipeline progress is surfaced through incremental status updates

So live progress is supported through polling, not streaming.

## Docker Context
Docker setup includes:

- `backend/Dockerfile`
- `frontend/Dockerfile`
- `docker-compose.yml`

Backend Docker compatibility was hardened by switching the backend image to:

- `python:3.11-slim`

Reason:

- better wheel availability across Intel and Apple Silicon Macs
- safer dependency installation for packages like `torch`, `sentence-transformers`, and related native dependencies

The duplicate Playwright install step was also removed from the backend Dockerfile because `playwright` is already included in `requirements.txt`.

## Current Backend State Summary
The backend now supports:

- monitored pipeline execution
- persisted latest run state
- client matching
- advisory draft generation
- deadline scanning from client obligations and generated drafts
- deadline alert sending
- audit history inspection
- scheduler visibility and manual triggering
- RAG-backed analyst query handling

## Operational Summary
In plain terms, the backend is now the command layer for a compliance workflow system:

- detect circulars
- decide who is affected
- draft what should be sent
- identify deadline risk
- send preventive alerts
- log what happened
- answer analyst questions against the knowledge base

