# Union of Indians (UOI) ID Card Bot — System Architecture & Specification

## 1. Executive Overview
The **Union of Indians (UOI) ID Card Data Processor** is an enterprise-grade Discord bot and web management platform designed for the Roblox UOI community. It provides automated citizen card issuance, real-time Roblox profile and 3D avatar verification, staff approval workflows, custom per-server template rendering with high-resolution canvas engines, resilient multi-server permanent memory, permanent backup snapshotting, and proactive 2-month lifecycle management.

---

## 2. Core Architecture & Data Flow

```
+-----------------------------------------------------------------------------------+
|                                  DISCORD CLIENT                                   |
|   /card generate, /card setup, /card export, /card import, Buttons, Modals        |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                        DISCORD.JS INTERACTION ROUTER                              |
|           • RBAC Validator: Owner/Admin Guard (checkIsOwnerOrAdmin)               |
|           • Staff Review Guard (checkIsStaffOrAdmin)                              |
|           • Input Sanitization & Multi-Attachment Parsing                         |
+-----------------------------------------------------------------------------------+
       |                                      |                                |
       v                                      v                                v
+------------------+             +-----------------------+           +------------------+
|  ROBLOX DETECT   |             |   DATABASE / MEMORY   |           | TEMPLATE MANAGER |
| • Username query |             | • cards.json (store)  |           | • Per-Guild PNG  |
| • Bloxlink API   |             | • backups/ (archive)  |           | • Resolution Fix |
| • RoVer API      |             | • server_memory.json  |           | • Layer Caching  |
| • 3D Headshot CDN|             | • Atomic Write Swap   |           | • Fallback Mgmt  |
+------------------+             +-----------------------+           +------------------+
       \                                      |                                /
        --------------------------------------+--------------------------------
                                              |
                                              v
+-----------------------------------------------------------------------------------+
|                       GRAPHICS & CANVAS RENDERING ENGINE                          |
|         • Engine: @napi-rs/canvas (High-performance Rust / Skia backend)          |
|         • Code 128 Barcode generation (bwip-js)                                  |
|         • Dynamic Text Fitting, 2-Month Expiry Stamping, Security Bands           |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                           DISPATCH & SENTINEL LAYER                               |
|         • Proactive Expiration Sentinel (10, 5, 3, 1 Days Prior DMs)             |
|         • Approval / Decline Direct Message (DM) Dispatcher with Graphic          |
|         • Designated Delivery Channel Announcements & Auto-Nickname Sync          |
+-----------------------------------------------------------------------------------+
```

---

## 3. Storage, Backup & Archival Subsystems

### 3.1 Primary Persistent Database (`data/cards.json`)
The bot maintains all citizen records in an atomic, partitioned store:
* `db.cards[`${guildId}_${userId}`]`: Composite key for instantaneous indexed lookups.
* `db.serverCards[guildId][userId]`: Isolated per-server partition ensuring no cross-server leakage.
* `db.serToUser[serialId]`: Global serial index mapping serials to server contexts.
* **Atomic File Swapping**: Every write executes via temporary buffer write (`.tmp`) followed by atomic rename (`fs.renameSync`) to ensure zero database corruption during container restarts or crash events.

### 3.2 Permanent Archival Storage (`data/backups/`)
Every card file export or import triggers an automatic, immutable backup copy:
* **Import Archival**: Raw uploaded files are archived permanently into `data/backups/import_<guildId>_<timestamp>_<filename>`.
* **Export Archival**: Every database export creates an immutable copy in `data/backups/export_<guildId>_<timestamp>.<ext>`.
* Ensures that historical files and records can never be lost.

---

## 4. File Download & Upload Engine (`/card export` & `/card import`)

### 4.1 Export / Download Engine
* **Access Control**: Strictly restricted to the **Server Owner** or members with the **Administrator** permission (`checkIsOwnerOrAdmin`).
* **Formats**: JSON database dumps and CSV spreadsheets (compatible with Excel & Google Sheets).
* **Scope**: Per-server or network-wide central registry export.
* **Timestamp Stamping**: Every card exported contains complete creation date/time (`issuedAt` in ISO & human-readable UTC), 2-month expiration date (`expiresAt`), `daysRemaining`, clearance, division, and rank.

### 4.2 Multi-File Import Engine
* **Access Control**: Strictly restricted to the **Server Owner** or members with the **Administrator** permission.
* **Multiple Attachments**: Allows uploading up to 5 files in a single execution (`file`, `file2`, `file3`, `file4`, `file5`).
* **Unmarked Format Detection**:
  * If an uploaded file is in an unmarked or legacy format (lacking creation date, timestamp, or expiration fields), the parser flags it as unmarked.
  * The engine **automatically marks and stamps the card with the current date/time**, calculates the 2-month expiration date, and initializes the reminder sentinel.
* **Marked Format Preservation**:
  * If a card already contains valid timestamps, original dates are preserved.
* **Modes**:
  * `merge` (Default): Adds new cards and updates existing records.
  * `replace`: Clears the server's previous records before importing.

---

## 5. 2-Month Lifecycle Sentinel & Automated Proactive DMs

All issued and imported UOI Citizen ID cards adhere to a strict **2-Month Validity Policy**.

### 5.1 Expiration Mathematics
$$\text{expiresAt} = \text{issuedAt} + 2\text{ months}$$
Calculated accurately using calendar month advancement (`date.setMonth(date.getMonth() + 2)`).

### 5.2 Multi-Interval DM Dispatcher
The background sentinel runs every 30 minutes (and on bot startup):
1. **10 Days Prior (`d10`)**: Initial notice alerting the citizen of upcoming expiration.
2. **5 Days Prior (`d5`)**: Follow-up reminder with days remaining.
3. **3 Days Prior (`d3`)**: Urgent warning detailing renewal steps.
4. **1 Day Prior (`d1`)**: Final 24-hour notice before expiration.
5. **0 Days / Expiration Moment (`expired`)**: Official notice that the card has expired, updating status to `EXPIRED`.

Each notification includes:
* Citizen name, unique Serial ID, and server context.
* Formatted Discord timestamp of expiration: `<t:unix:F> (<t:unix:R>)`.
* Actionable instructions for self-renewal via `/card refresh`.
* Anti-spam tracking: each reminder flag (`d10`, `d5`, `d3`, `d1`, `expired`) is recorded in the card record so users are never spammed twice for the same threshold.

---

## 6. Staff Review & Decision Notifications

* **Interactive Buttons**: Officers can click **[✅ Accept & Issue Card]** or **[❌ Decline with Reason]**.
* **Direct Message (DM) on Approval**: Automatically sends a private DM to the citizen with their card graphic attached, serial ID, and 2-month validity details.
* **Direct Message (DM) on Decline**: Automatically sends a private DM containing the reviewing officer's exact explanation.
