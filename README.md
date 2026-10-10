---
title: Enterprise DataSphere
emoji: 🌐
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# Enterprise DataSphere — Interactive Showcase

[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688.svg?style=flat&logo=fastapi)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/Frontend-React_19-61DAFB.svg?style=flat&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6.svg?style=flat&logo=typescript)](https://www.typescriptlang.org)
[![Python](https://img.shields.io/badge/Python-3.11%20%7C%203.12%20%7C%203.13-3776AB.svg?style=flat&logo=python)](https://www.python.org)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An interactive, animated architectural showcase for **Enterprise DataSphere**: a high-reliability, multi-database architecture, performance, and automation platform.

In this architecture, **PostgreSQL** serves as the authoritative transactional ledger, bridged to **MongoDB** read models through an **Idempotent Transactional Outbox pattern**. The showcase features interactive disaster recovery (HA/DR) failover drills, an in-memory SQLite performance benchmarking lab, capacity planning models, and data lifecycle management.

---

## 📑 Table of Contents

- [Key Highlights & Features](#key-highlights--features)
- [Architecture & Data Flow](#architecture--data-flow)
- [What is Real vs. Simulated](#what-is-real-vs-simulated)
- [Quick Start](#quick-start)
  - [Prerequisites](#prerequisites)
  - [Running on Windows](#running-on-windows)
  - [Running on macOS / Linux](#running-on-macos--linux)
- [API Endpoints](#api-endpoints)
- [Frontend Development (Optional)](#frontend-development-optional)
- [Project Structure](#project-structure)
- [License & Trademarks](#license--trademarks)

---

## ✨ Key Highlights & Features

1. **Anatomy of an Order**: A scroll-driven interactive walkthrough detailing transaction boundaries, atomic outbox persistence, relay loops, and idempotent event consumer processing.
2. **Live Failure Lab & Chaos Drills**:
   - Order placement with real-time idempotency key validation (`201 Created` → `200 Replayed` → `422 Conflict`).
   - Network simulation: message delays, duplication, consumer crash, and resume token expiration (`ChangeStreamHistoryLost`, Code 286).
   - Read-model corruption and state reconciliation against PostgreSQL truth.
3. **Six Database Engine Explorer**: Side-by-side comparison matrix and workload routing analysis (PostgreSQL, MongoDB, MySQL, SQL Server, Cassandra, HBase).
4. **HA / DR Failover Simulator**: Asynchronous vs. synchronous replication drills (LSNs, timeline splits, node fencing, `pg_rewind`), RPO/RTO calculations, and backup verification pipelines.
5. **Performance Lab**: Live, real-time benchmark comparing indexed vs. unindexed queries using `EXPLAIN QUERY PLAN`, with full sample distribution plots.
6. **Capacity Planner**: 12-month projections, growth scenario modeling, storage threshold crossing, and sensitivity calculations.
7. **Data Lifecycle Engine**: Hot, warm, and cold storage tiering with class-based retention policies and dry-run purge execution.
8. **Real-time Observability**: Live metrics dashboard and standard Prometheus `/metrics` exposition.

---

## 🏛️ Architecture & Data Flow

```text
[ Client Request ]
       │
       ▼
┌────────────────────────────────────────────────────────┐
│               PostgreSQL Transactional Boundary        │
│  ┌───────────────────────┐   ┌──────────────────────┐  │
│  │ Orders & Order Items  │   │  Transactional       │  │
│  │ (Authoritative State) │   │  Outbox Table        │  │
│  └───────────────────────┘   └──────────┬───────────┘  │
└─────────────────────────────────────────┼──────────────┘
                                          │ Reliable Polling / Change Stream
                                          ▼
                               ┌─────────────────────┐
                               │     Event Relay     │
                               └──────────┬──────────┘
                                          │ At-Least-Once Delivery
                                          ▼
                               ┌─────────────────────┐
                               │ Idempotent Consumer │
                               └──────────┬──────────┘
                                          │ Deduplicated Upsert
                                          ▼
                               ┌─────────────────────┐
                               │  MongoDB Read Model │
                               │  (Fast Projections) │
                               └─────────────────────┘
```

---

## 🔬 What is Real vs. Simulated

Every measurement on the dashboard is explicitly categorized:

| Classification | Description | Covered Modules |
| :--- | :--- | :--- |
| **Measured** | Real timings gathered locally on the host machine | **Performance lab**: In-memory SQLite, indexed vs unindexed queries, `EXPLAIN QUERY PLAN`, disk/page storage calculations |
| **Simulated** | In-memory architectural models exposing real-world failure modes | **Live failure lab**: Outbox broker, consumer recovery, read model drift, HA failover (LSNs, lag, timelines) |
| **Estimate** | Computed directly from your parameters & stated formulas | **Capacity planner**: Storage growth projections and threshold analysis |
| **Illustrative** | Explanatory workflows without numerical simulation | Engine selector, RPO/RTO targets, backup runbooks, lifecycle policies |

---

## 🚀 Quick Start

> **Note:** The frontend application is already pre-built in `web/dist/` and served directly by the Python backend. **Node.js is not required to run the showcase.**

### Prerequisites
- **Python 3.11, 3.12, or 3.13** installed (Python 3.12 recommended).
- Ensure Python is added to your system `PATH`.

### Running on Windows
Double-click `start.bat` or run:
```powershell
.\start.bat
```
*Alternatively, from PowerShell:*
```powershell
.\server\run.ps1
```

### Running on macOS / Linux
Open a terminal in the project directory and run:
```bash
bash start.sh
```

### Accessing the Web Interface
Once started, navigate to:
👉 **[http://127.0.0.1:8710](http://127.0.0.1:8710)**

---

## 📡 API Endpoints

The FastAPI backend exposes the following primary endpoints:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Service health, version, and simulation state |
| `GET` | `/api/sim/state` | Current state of simulated commerce components |
| `POST` | `/api/sim/orders` | Place atomic orders with optional `Idempotency-Key` header |
| `POST` | `/api/sim/chaos` | Inject chaos (delivery faults, consumer crash, read-model corruption) |
| `GET` | `/api/sim/stream` | Server-Sent Events (SSE) feed for live updates |
| `GET` | `/api/ha/state` | HA simulation status, WAL tracking, and replica lag |
| `POST` | `/api/ha/action` | Trigger failover, primary kill, promotion, or fencing |
| `POST` | `/api/lab/index-bench` | Execute in-memory SQLite indexing benchmark |
| `GET` | `/api/lab/runs` | Retrieve the 10 most recent benchmark runs |
| `POST` | `/api/capacity` | Calculate multi-scenario capacity plans |
| `GET` | `/metrics` | Prometheus metrics exposition format |

---

## 💻 Frontend Development (Optional)

If you wish to modify the React frontend:

1. Requires **Node.js 20+** and **npm**.
2. Navigate to the frontend directory:
   ```bash
   cd web
   npm install
   npm run dev
   ```
3. Open **http://127.0.0.1:5180** (API calls are proxied automatically to `127.0.0.1:8710`).
4. To rebuild the production bundle served by the backend:
   ```bash
   npm run build
   ```

---

## 📁 Project Structure

```text
datasphere-showcase/
├── start.bat               # Windows one-click startup script
├── start.sh                # macOS / Linux startup script
├── CONTRACT.md             # Strict API specification between server and client
├── README.md               # Project documentation
├── server/                 # FastAPI backend & simulation engine
│   ├── app/                # Application modules (routes, sim, lab, metrics)
│   ├── tests/              # Pytest test suite
│   ├── requirements.txt    # Production dependencies
│   └── run.ps1 / run.sh    # Environment setup & Uvicorn launcher
└── web/                    # React 19 + TypeScript + Vite frontend
    ├── src/                # Three.js 3D canvas, motion animations, components
    └── dist/               # Bundled SPA assets served by FastAPI
```

---

## 📄 License & Trademarks

This project is licensed under the MIT License. Product names, logos, and brands mentioned (PostgreSQL, MongoDB, MySQL, Cassandra, etc.) are property of their respective owners and are used purely for illustrative and architectural comparison purposes.
