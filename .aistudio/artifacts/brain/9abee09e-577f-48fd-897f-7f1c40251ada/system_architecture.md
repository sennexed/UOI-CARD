# Union of Indians (UOI) ID Card Bot — System Architecture & Specification

## 1. Executive Overview
The **Union of Indians (UOI) ID Card Data Processor** is an enterprise-grade Discord bot and web management platform designed for the Roblox UOI community. It provides automated citizen card issuance, real-time Roblox profile and 3D avatar verification, staff approval workflows, custom per-server template rendering with high-resolution canvas engines, and a resilient multi-server permanent memory system.

---

## 2. Core Architecture & Data Flow

```
+-----------------------------------------------------------------------------------+
|                                  DISCORD CLIENT                                   |
|   /card generate, /card setup, /card set-template, Buttons (Approve / Reject)    |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                        DISCORD.JS INTERACTION ROUTER                              |
|           • RBAC Permission Validator (Owner, Admin, Staff, Citizen)              |
|           • Input Sanitization & Option Parsing                                   |
+-----------------------------------------------------------------------------------+
       |                                      |                                |
       v                                      v                                v
+------------------+             +-----------------------+           +------------------+
|  ROBLOX DETECT   |             |   DATABASE / MEMORY   |           | TEMPLATE MANAGER |
| • Username query |             | • server_memory.json  |           | • Per-Guild PNG  |
| • Bloxlink API   |             | • Atomic Write Swap   |           | • Resolution Fix |
| • RoVer API      |             | • guild setups        |           | • Layer Caching  |
| • 3D Headshot CDN|             | • cards & pendingReqs |           | • Fallback Mgmt  |
+------------------+             +-----------------------+           +------------------+
       \                                      |                                /
        --------------------------------------+--------------------------------
                                              |
                                              v
+-----------------------------------------------------------------------------------+
|                       GRAPHICS & CANVAS RENDERING ENGINE                          |
|         • Engine: @napi-rs/canvas (High-performance Rust / Skia backend)          |
|         • Code 128 Barcode generation (bwip-js)                                  |
|         • Dynamic Text Fitting, Tiranga gradients, Watermarks, Badges             |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                           DISPATCH & DELIVERY LAYER                               |
|         • Ephemeral Staff Review embeds with Approve / Reject action buttons      |
|         • Direct Citizen DM & Designated Server Delivery Channel Announcements     |
|         • Automated Server Nickname Synchronizer: "FullName [SerialId]"           |
+-----------------------------------------------------------------------------------+
```

---

## 3. Storage & Memory Subsystems

### 3.1 Persistent Server Memory (`data/server_memory.json`)
The bot implements permanent multi-server memory. Every guild that invites the bot is indexed with its configuration:
* **Guild Configuration**: Staff review channel ID, card delivery channel ID, staff reviewer role ID, auto-nickname toggle, custom Roblox API keys.
* **Auto-Discovery**: Automatic fallback detection of channels named `#staff`, `#card-approval`, `#deliveries`, `#citizenship` if not manually configured.
* **Atomic File Swapping**: Memory writes execute via temporary buffer write (`.tmp`) followed by atomic rename (`fs.renameSync`) to ensure zero database corruption during container restarts or crash events.
* **Automated Redundant Backups**: Maintained at `data/server_memory.backup.json`.

### 3.2 Isolated Template Memory (`templates/`)
* Each Discord guild is assigned an isolated custom template file: `templates/<GuildID>.png`.
* When an administrator uploads a custom badge template using `/card set-template`, the template is processed, validated, and saved specifically for that server ID.
* If no custom template is uploaded, the bot falls back to the default official template (`template.png`).

---

## 4. Role-Based Access Control (RBAC) Specification

| Tier | Role / Entity | Capabilities & Allowed Commands |
|---|---|---|
| **Tier 1: Owner** | • Server Owner (`guild.ownerId`)<br>• Bot Developer Application Owner<br>• Configured `OWNER_ID` in `.env` | • `/card git-sync` (Git remote pull + graceful restart)<br>• `/card git-status` (Commit hash, branch & webhook info)<br>• `/card memory` (Inspect permanent storage & setups)<br>• All Tier 2 & Tier 3 commands |
| **Tier 2: Staff / Admin** | • Server Administrators<br>• `Manage Server` permission<br>• Role designated via `staff_role` | • `/card setup` (Configure review/delivery channels)<br>• `/card set-template` & `/card reset-template`<br>• `/card promote` (Grant rank advancements)<br>• `/card revoke` (Revoke and blacklist citizen IDs)<br>• `/card inspect` (Inspect citizen dossiers)<br>• `/card botstyle` (Modify bot display typography/colors)<br>• Review Action Buttons (Approve/Reject requests) |
| **Tier 3: Citizens** | • All Discord Members | • `/card apply` (Interactive modal application form)<br>• `/card generate` (Submit card application)<br>• `/card refresh` (Self-service avatar & role resync)<br>• `/card show` (Display citizen card and status)<br>• `/card verify` (Verify barcode/serial validity)<br>• `/card whois` (Look up linked Roblox profile)<br>• `/card link` / `/card unlink` (Link personal Roblox account)<br>• `/card view-template` (View server active template) |

---

## 5. Canvas Card Generation Engine

1. **Resolution & Dimensions**:
   * Base Canvas: 1200 x 900 pixels high-definition canvas.
2. **Dynamic Elements**:
   * **Roblox 3D Avatar**: High-res circular or rounded headshot retrieved from Roblox Thumbnails CDN (`337 x 344 px`).
   * **Typography**: Clean hierarchy displaying Full Name, Roblox Username, User ID, Gender, and Assigned Rank Tier.
   * **Security Clearance Level**: Automatically computed five-tier accreditation (*Level I: General Citizen* to *Level V: Union Directorate*).
   * **Government Division**: e.g. *Civilian Directorate*, *Armed Forces*, *Homeland Security & Border Corps*.
   * **Issuance & Expiry Dates**: Formatted dynamic issue date (`22 OCT 2026`) and two-year validity stamp (`VALID THRU: OCT 2028`).
   * **Dual Scannable Verification**:
     * **Code 128 Barcode**: Generated dynamically via `bwip-js` encoding the unique serial ID (`UOI-YYYY-XXXXXX`).
     * **Real-time Verification QR Code**: Encoded with live web verification URL (`https://uoi-gov.in/verify?serial=UOI-2026-XXXXXX`).
   * **Anti-Tamper Security Microtext Band**: High-precision microtext line rendered along the canvas bottom border.
3. **Automated Server Integrations**:
   * **Auto-Role Assignee**: Automatically assigns the configured `@Citizen` role to members on card approval.
   * **Security Audit Trail**: Dispatches audit events (`CARD_ISSUED`, `CARD_REVOKED`, `CARD_PROMOTED`) to `#card-logs`.
   * **Live Web Verification Portal & API**:
     * `/verify/:serialId`: Holographic web dossier for scanned cards.
     * `/api/v1/verify`: JSON verification API for Roblox Lua `HttpService` in-game scripting.
