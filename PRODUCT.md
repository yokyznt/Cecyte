# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Existing: static HTML/CSS/JS on Vercel with serverless functions in `api/` (Vercel KV, Web Push). No build step. Keep it dependency-free on the front end.

## Users
*(Inferred from the repo, not interviewed.)*
- **Alumnos** of CECyTE Plantel 18, mostly on a phone between classes, often in bright light, glancing for a few seconds: what is on now, what is next, when does it end.
- **Dirección / administración**, on a desktop or phone, who edit the schedule, groups, the school bell (ESP32) and see the alert log.

## Product Purpose
One shared class schedule per group, always current, with automatic push alerts when a class block changes and a remote school bell. Success: a student answers "what do I have now / next" in under three seconds, and the admin changes a subject in under a minute.

## Positioning
A school-owned, real-time timetable tied to the physical bell (ESP32) and to push notifications, not a static PDF or a generic calendar.

## Operating Context
Schedule blocks are fixed: 07:00-08:00, 08:00-08:45, 08:45-09:15 (receso), 09:15-10:00, then hourly to 15:00. Monday to Friday. Groups look like "501 Programación". Only dirección edits.

## Capabilities and Constraints
- Group selector remembered per device; live clock; current-class card with progress and countdown; next class.
- Weekly table on desktop, per-day list on phone.
- Push notification opt-in and test.
- Admin (password): CRUD subjects, groups, JSON import, bell times/days/duration, ring now, alert log.
- All copy is Spanish (es-MX). Keep every existing feature, id and behavior.

## Brand Commitments
CECyTE institutional green stays the primary brand color (confirmed by the user). Palette is green and white with some black, light, friendly but formal (user request, 2026-09-29); no other accent hues. Name shown: "CECyTE Plantel 18". No official logo asset in the repo; do not fabricate one.

## Evidence on Hand
No logo, photos or testimonials in the repo. Do not invent any.

## Product Principles
1. The present moment leads: what is happening now outranks the full grid.
2. Phone first for students, density for the admin.
3. Every state is legible at a glance and in sunlight (contrast, size, no color-only meaning).
4. The interface is quiet; the school's green carries identity and state, black carries formality.

## Accessibility & Inclusion
Students are teenagers on mid-range phones and variable connections. Target WCAG AA contrast, 44px touch targets, keyboard and screen-reader operable, respects reduced motion.
