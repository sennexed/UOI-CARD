# Union of Indians (UOI) ID Card System — Feature & Card Info Roadmap

This roadmap details the architectural updates, card information schema expansions, visual layout enhancements, and functional upgrades for the **UOI ID Card Generation & Registry Bot**.

---

## 1. Card Information Schema: Implementation Status

The UOI Citizen ID Card system has been expanded into a complete civil and security identity credential with permanent timestamping and 2-month lifecycle management.

### 1.1 Field Mapping & Status

| Field Name | Type | Status | Function & Description |
|---|---|---|---|
| **Full Legal Name** | String | ✅ Active | Rendered at row 1 with auto-scaling to prevent visual clipping. |
| **Roblox Username** | String | ✅ Active | Displays `@username` with verified Bloxlink/RoVer/auto-detection status. |
| **Roblox User ID** | Numeric String | ✅ Active | Numeric user identifier linked to Roblox profile. |
| **Gender** | Enum / String | ✅ Active | Standardized (`Male`, `Female`, `Unspecified`). |
| **Assigned Rank** | String | ✅ Active | Automatically scanned from Discord server hierarchy roles. |
| **Unique Serial ID** | String | ✅ Active | Standard format: `UOI-YYYY-XXXXXX`. |
| **Scannable Barcode** | Code 128 Image | ✅ Active | High-contrast Code 128 barcode scannable by 1D optical scanners. |
| **High-Density QR Code**| QR Code Image | ✅ Active | Scannable QR code resolving to the verification portal. |
| **Division / Branch** | String | ✅ Active | Civilian Directorate, Homeland Security, or Armed Forces. |
| **Security Clearance** | Enum | ✅ Active | Level I (Civilian) through Level V (Directorate). |
| **Date of Issuance** | ISO / UTC String| ✅ Active | Exact date and time stamped when card is created/approved. |
| **2-Month Expiration** | ISO / UTC String| ✅ Active | Exact expiration date computed at `issuedAt + 2 months`. |
| **Days Remaining** | Integer | ✅ Active | Computed countdown to expiration; tracked in database & exports. |
| **Reminder Flags** | Object | ✅ Active | `{ d10, d5, d3, d1, expired }` anti-spam tracking for automated DMs. |
| **Server Flag** | Dynamic Canvas | ✅ Active | Renders `SERVER-SPECIFIC • [SERVER]` flag when citizen has multi-server cards. |

---

## 2. Card Visual Layout (1200 x 900 Canvas)

Coordinate layout mapping for the official UOI card:

```
+---------------------------------------------------------------------------------------------------------+
| [EMBLEM]  UNION OF INDIANS • CITIZEN IDENTITY CARD                    SERIAL: UOI-2026-849201           |
|                                                     [SERVER-SPECIFIC • LOCAL JURISDICTION] (If multi)   |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|  +---------------------------+   FULL LEGAL NAME:         VIKRAMADITYA CHATTERJEE                       |
|  |                           |   ROBLOX IDENTITY:         @Vikram_RBLX  [UID: 198420412]               |
|  |                           |   ROBLOX UID:              198420412                                     |
|  |    ROBLOX 3D AVATAR       |   GENDER:                  MALE                                          |
|  |    HIGH-RES HEADSHOT      |   RANK / DESIGNATION:      SENIOR COMMANDANT                             |
|  |    (337 x 344 px)         |                                                                          |
|  |                           |   CLEARANCE:               LEVEL IV (EXECUTIVE SECURE)                   |
|  +---------------------------+   DIVISION:                HOMELAND SECURITY & BORDER CORPS              |
|  [ RANK BADGE: COMMANDANT ]      ISSUED: 04 NOV 2026 • VALID THRU: 04 JAN 2027                          |
|  [ SCANNABLE CODE 128 BARCODE]                            [ VERIFICATION QR CODE - SCAN TO VERIFY ]     |
|                                                                                                         |
| ================================== SECURITY MICROTEXT BAND ============================================ |
+---------------------------------------------------------------------------------------------------------+
```

---

## 3. Implemented Functional Features

### 3.1 Download & Upload Card Files (`/card export` & `/card import`)
* **Download (`/card export`)**:
  * Restricted strictly to the **Server Owner** or members with the **Administrator** permission.
  * Exports JSON database dump or CSV spreadsheet.
  * Every card contains complete timestamps (`issuedAt`, `issuedAtFormatted`, `expiresAt`, `expiresAtFormatted`, `daysRemaining`).
  * Automatically archives a permanent backup snapshot in `data/backups/`.
* **Upload (`/card import`)**:
  * Restricted strictly to the **Server Owner** or members with the **Administrator** permission.
  * Supports multiple file attachments in a single execution (`file`, `file2`, `file3`, `file4`, `file5`).
  * Seamlessly accepts **unmarked format** (legacy files without dates/times): automatically detects missing timestamps and auto-stamps current creation date/time and 2-month expiry.
  * Preserves existing marked timestamps for cards with valid dates.
  * Archives raw files into `data/backups/` and persists to `data/cards.json` with synchronous atomic flush.

### 3.2 2-Month Validity & Automated Proactive DMs
* **Validity Window**: Every citizen card is valid for exactly 2 calendar months from issuance.
* **Proactive Sentinel DMs**:
  * **10 Days Prior**: Initial courtesy reminder.
  * **5 Days Prior**: Second reminder with days remaining.
  * **3 Days Prior**: Urgent warning notice.
  * **1 Day Prior**: Final 24-hour notice before expiration.
  * **0 Days (Expired)**: Expiration notice updating card status to `EXPIRED`.
* **Self-Service Renewal**:
  * Cardholders can renew their validity for another 2 months at any time by running `/card refresh`.
  * Staff can approve renewal applications submitted through `/card apply` or `/card generate`.

### 3.3 Server Role Auto-Scanning
* The bot automatically inspects the applicant's Discord roles to determine their highest hierarchical, hoisted, or colored role.
* Manual role typing has been eliminated to protect against rank falsification.

### 3.4 Approval Direct Messages (DMs)
* When staff clicks **[✅ Accept & Issue Card]**, the bot automatically sends a celebratory DM directly to the citizen with their attached ID card graphic and expiration date.
* When staff clicks **[❌ Decline with Reason]**, the bot sends a DM detailing the officer's exact justification.

### 3.5 Server Display Name Styling & Color Studio
* **25 Color Choices (Discord Limit)**: Curated spectrum from Indian Tricolor, Ashoka Navy, Cyber Cyan, Imperial Gold, Blood Crimson, to Obsidian Stealth, Toxic Matrix, and Sunset Blaze.
* **Infinite Custom Hex Option**: Support for `custom_hex` and `custom_hex2` allowing any 24-bit RGB gradient (#HEX).
* **9 Visual Effects**: Solid Flat Color, Two-Tone Linear Gradient [Default], Electric Neon Glow, Toon Pop Outline, 3D Pop Drop-Shadow, Holographic Prismatic Shimmer, Cyberpunk Pulse & Glitch, Velvet Luxe Radiance, Radial Sunburst Flare.
* **100% Guaranteed Color Rendering**: Automatically synchronizes or creates an auto-managed `@UOI Bot Display` server role color so the bot's username is vibrantly colored in chat, sidebars, and popups across all Discord desktop, web, and mobile clients.
* **Persistent Multi-Server Memory**: Saved into `data/cards.json` under `db.guilds[guildId].botStyle` and restored on ready and `guildCreate`.

### 3.6 Automated 48-Hour Card Application Expiry Sentinel
* **Prevents Stuck / Hanging Applications**:
  * Unreviewed card applications automatically expire after a configurable review window (default: 48 hours).
  * Stamped with `submittedAt`, `expiresAt`, and `expiresAtTimestamp` upon creation in `/card apply`, `/card generate`, or interactive modal.
  * Live countdowns rendered in both the staff review ticket (`<t:unix:R>`) and applicant confirmation embed.
* **Auto-Unblock on Reapplication**:
  * If an applicant runs `/card apply` or `/card generate` while having a stale pending request, the bot automatically transitions the stale request to `EXPIRED` and allows the new submission through.
* **Review Button Guarding & Sweep**:
  * Action buttons on expired review messages reject clicks with an explanation and are automatically deactivated to `⏰ Application Expired (48h Timeout)`.
  * Background sentinel auto-sweeps every 30 minutes, transitioning expired records and sending a courtesy DM to the applicant so they know they are cleared to reapply.

### 3.7 Citizen ID Card Visual Themes & Security Overlays (`/card show`)
* **10 Accent Color Themes**: Gold, Cyan, Crimson, Emerald, Purple, Cyber, Matrix, Sunset, Sakura, and Stealth. Dynamic accent coloring of Serial ID, rank box borders, barcodes, and QR modules.
* **4 Security Effects**:
  1. `standard`: Official clean high-contrast blueprint layout.
  2. `holographic`: Prismatic rainbow diffraction foil with dynamic anti-counterfeiting guilloche wavy security lines across the credential canvas.
  3. `gold_embossed`: Dual metallic gold borders with beveled corner security crests.
  4. `stealth`: Matte dark tactical border vignette with muted monochrome tone.

