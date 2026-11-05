---
name: multi-tenant-security-audit
description: >-
  Executes an adversarial multi-tenant and RBAC security audit across Next.js API
  Route Handlers, Server Components, SERE batch imports, audit logs, and CSV exports
  in Rede Ativa SaaS. Use this skill whenever the user asks for a security audit,
  QA adversarial testing, IDOR/BOLA verification, multi-tenant isolation checks,
  or comparison against previous security audits.
---

# Multi-Tenant Adversarial Security Audit

Never rely solely on static code reading or isolated helper unit tests when auditing tenant isolation. Always validate the real Next.js Route Handlers and Server Components with stateful persistence assertions.

## Audit Workflow

1. **Inspect Delta Since Last Audit**
   - Check `docs/AUDITORIA_SEGURANCA_MULTITENANT_2026.md` (and any newer audit reports in `docs/`) and run `git log --oneline` / `git diff` from the last audited commit to `HEAD` to pinpoint newly touched routes, SSR pages, and Prisma filters.

2. **Execute & Extend Live Adversarial Integration Suite**
   - Run the integration suite in `src/app/api/__tests__/adversarialQa.test.ts` via `npx vitest run src/app/api/__tests__/adversarialQa.test.ts`.
   - Ensure test cases instantiate at least three distinct contexts (`authContextSchoolA`, `authContextSchoolB`, and `authContextLeopoldina` with INEP `41042730`), simulate `next/headers` cookies (including forged `active_school_id=escola-b`), and assert both HTTP status codes and post-request database state (confirming failed `4xx` calls leave zero partial mutations).

3. **Verify the 7 Mandatory Risk Vectors**
   - **V1 — BOLA / IDOR (API & SSR):** Test `GET`, `PATCH`, `PUT`, `DELETE`, `/addendums`, `/void`, `/finalize` on `/api/atas/*`, `/api/messages/*`, `/api/justifications/*`, plus dynamic SSR pages (`/atas/[id]/imprimir`, `/atas/livro/[ano]`, `/alunos/[id]/dossie`).
   - **V2 — Tenant Context & Cookie Spoofing:** Inject `"schoolId": "escola-b"` in JSON bodies AND `Cookie: active_school_id=escola-b` in headers on creation/read routes.
   - **V3 — SERE Batch Import & Founding School Protection:** Test `/api/students/import` with foreign CGMs, `transferredStudents`, `options.updateSchoolInfo: true` (must return `403` for non-`SUPERADMIN`), and confirm external tenants never match or leak `schoolId: null` / `"default-leopoldina"` records.
   - **V4 — Cross-Tenant FK Traversal:** Test foreign `classGroupId`, mixed `studentIds` (on `POST`, `PATCH`, and `/finalize`), and foreign private `templateId`.
   - **V5 — Horizontal & Vertical RBAC Escalation:** Test `PUT /api/users` targeting another school's user (`403`) and self/peer promotion to `SUPERADMIN`, `GESTAO_SECRETARIA`, or `ADMIN` (`403`).
   - **V6 — CSV Injection & RFC 4180 Escaping:** Verify `sanitizeCsvField` prefixes `=`, `+`, `-`, `@`, `\t`, `\r` with `'` AND all exported columns escape internal `"` as `""`.
   - **V7 — Tenant-Blind Audit Logging:** Scan all `logAudit({ ... })` calls in `src/` to verify top-level `schoolId` is passed (not nested only inside `details`), and verify `/auditoria` never leaks cross-tenant or orphan `null` logs.

4. **Reporting & Quality Gate**
   - For each vector, report: **Vetor Testado**, **Request Enviada** (method, URL, headers, payload), **Status Code Recebido**, **Comportamento do Banco**, and **Veredito (`PASS` / `FAIL`)**, followed by a comparison table against the previous audit if requested.
   - If running in read-only audit mode, keep `git status` clean (use artifact `scratch/` for temporary harnesses). If applying fixes, run `npm test` and `npm run build` before finishing.
