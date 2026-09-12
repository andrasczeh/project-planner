# Project Planner

A browser-only, local-first project management tool with Gantt charts, task management, and people allocation tracking. Installable as a PWA.

## Features

- **Gantt Chart** with drag-to-reschedule, dependencies, milestones, and zoom levels (day/week/month)
- **Task Management** with hierarchical subtasks, custom statuses, priorities, and estimates
- **People View** with workload allocation and capacity tracking
- **Offline-first** — all data stored in IndexedDB via Dexie, no server required
- **PWA** — installable on mobile and desktop with full offline support
- **Mobile-optimized** — touch-friendly with swipe-to-open sidebar, long-press-to-drag Gantt bars, and bottom-sheet modals

## Tech Stack

- React + TypeScript
- Vite + vite-plugin-pwa
- Dexie 4 (IndexedDB)
- Vitest for testing

## Getting Started

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```
