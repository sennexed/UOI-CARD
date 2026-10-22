# Union of Indians (UOI) ID Card System — Feature & Card Info Roadmap

This roadmap details the planned architectural updates, card information schema expansions, visual layout enhancements, and functional upgrades for the **UOI ID Card Generation & Registry Bot**.

---

## 1. Card Information Schema: Current vs. Proposed

The next evolution of the UOI Citizen ID Card expands the data payload from basic identity verification into a comprehensive civil and security identity credential.

### 1.1 Field Mapping Comparison

| Field Name | Type | Current State | Proposed Update & Purpose |
|---|---|---|---|
| **Full Legal Name** | String | ✅ Active | Enhanced text-scaling algorithm to support multi-part names up to 36 characters without overflow. |
| **Roblox Username** | String | ✅ Active | Displays `@username` with verified Bloxlink/RoVer cross-check status. |
| **Roblox User ID** | Numeric String | ✅ Active | Numeric user identifier linked to Roblox profile. |
| **Gender** | Enum / String | ✅ Active | Standardized (`Male`, `Female`, `Non-Binary`, `Classified`). |
| **Assigned Rank** | String | ✅ Active | Rendered prominently inside the golden under-portrait rank badge. |
| **Unique Serial ID** | String | ✅ Active | Standard format: `UOI-YYYY-XXXXXX`. |
| **Scannable Barcode** | Code 128 Image | ✅ Active | Scannable by 1D laser/optical barcode scanners. |
| **Division / Branch** | String / Enum | 🆕 **Proposed** | **New field**: Identifies the citizen's government or military branch: *(e.g. Armed Forces, Homeland Security, Diplomatic Corps, Civil Service, Judiciary, Civilian Directorate)*. |
| **Security Clearance Level** | Enum | 🆕 **Proposed** | **New field**: Tiered clearance level *(Level I: General Citizen, Level II: Civil Officer, Level III: Field Operative, Level IV: High Command, Level V: Directorate)*. |
| **Date of Issuance** | Date String | 🆕 **Proposed** | Formatted date of approval *(e.g. `24 OCT 2026`)*. |
| **Validity / Expiry** | Date String | 🆕 **Proposed** | Formatted expiration stamp *(e.g. `VALID THRU: OCT 2028` or `LIFETIME CITIZENSHIP`)*. |
| **Territory / State** | String | 🆕 **Proposed** | Province/District of registration *(e.g. `New Delhi Capital Territory`, `Punjab`, `Bengal`, `Maharashtra`)*. |
| **Blood Group** | String | 🆕 **Proposed** | Optional military roleplay identifier *(e.g. `O+`, `A+`, `B+`, `AB+`)*. |
| **Dual Scan: Verification QR** | QR Code Image | 🆕 **Proposed** | High-density QR code pointing directly to the live web verification URL: `https://<domain>/verify?serial=UOI-2026-XXXXXX`. |
| **Digital Hologram / Seal** | Graphical Asset | 🆕 **Proposed** | Embossed Ministry of Home Affairs / Union Directorate metallic foil seal overlay. |
| **Officer Signature Stamp** | Rendered Path | 🆕 **Proposed** | Dynamic digital signature script of the reviewing officer. |

---

## 2. Updated Card Visual Layout (1200 x 900 Canvas)

Below is the coordinate layout mapping for the expanded card info:

```
+---------------------------------------------------------------------------------------------------------+
| [EMBLEM]  UNION OF INDIANS • CITIZEN IDENTITY CARD                    SERIAL: UOI-2026-849201           |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|  +---------------------------+   FULL LEGAL NAME:         VIKRAMADITYA CHATTERJEE                       |
|  |                           |   ROBLOX IDENTITY:         @Vikram_RBLX  [UID: 198420412]               |
|  |                           |   DIVISION / BRANCH:       HOMELAND SECURITY & BORDER CORPS              |
|  |    ROBLOX 3D AVATAR       |   RANK / DESIGNATION:      SENIOR COMMANDANT                             |
|  |    HIGH-RES HEADSHOT      |   CLEARANCE TIER:          LEVEL IV (EXECUTIVE SECURE)                   |
|  |    (337 x 344 px)         |   TERRITORY / STATE:       BENGAL DISTRICT                               |
|  |                           |   GENDER & BLOOD TYPE:     MALE  •  O+ POSITIVE                          |
|  |                           |   DATE OF ISSUANCE:        24 OCT 2026                                   |
|  +---------------------------+   EXPIRATION STAMP:        VALID THRU: OCT 2028                          |
|  | RANK: SENIOR COMMANDANT   |                                                                          |
|  +---------------------------+   [GOVT SEAL]              [OFFICER SIGNATURE]         [VERIFY QR]       |
|  | ||||||||||||||||||||||||| |   Ministry of Home Affairs  Approved: @MajorSingh       Scan for Live    |
|  | CODE 128 SERIAL BARCODE   |   Union of Indians          Directorate of Personnel    Dossier Record   |
|  +---------------------------+                                                                          |
|                                                                                                         |
|  MICROTEXT: UNION OF INDIANS OFFICIAL CITIZEN IDENTITY DOCUMENT • UNAUTHORIZED ALTERATION IS PROHIBITED |
+---------------------------------------------------------------------------------------------------------+
```

### Coordinate Allocation Specifications
1. **Left Identity Column (X: 54 to 402)**:
   * **Avatar Frame**: `X: 60, Y: 324, W: 337, H: 344` (Curved corners, gold inner bezel).
   * **Rank Badge Banner**: `X: 54, Y: 687, W: 348, H: 46` (Deep navy background, bold gold border, center text).
   * **1D Barcode Container**: `X: 54, Y: 758, W: 348, H: 100` (Crisp white container with scannable Code 128 bars).
2. **Right Citizen Dossier Column (X: 472 to 1140)**:
   * **Field Label Font**: Bold 14px Slate-400 monospace / uppercase.
   * **Field Value Font**: Bold 20px - 22px High-contrast white typography with dynamic auto-scaling for long names.
   * **Row Spacing**: 9 distinct data rows spaced at 44px intervals.
3. **Bottom Security Footer (Y: 770 to 860)**:
   * **Holographic Seal**: Rendered at `X: 472, Y: 770, W: 85, H: 85`.
   * **Officer Endorsement**: Rendered at `X: 610, Y: 780` displaying reviewing officer handle and date.
   * **Live Verification QR**: Rendered at `X: 1020, Y: 765, W: 90, H: 90`.
   * **Security Microtext Strip**: Continuous 8px microtext rendered at `Y: 885` spanning canvas width.

---

## 3. Functioning & Feature Roadmap

### Phase 1: Streamlined Application & Auto-Role Workflow (Immediate)
* **Interactive Modal Application (`/card apply`)**:
  * Instead of typing all parameters in a slash command, clicking `/card apply` opens a native Discord Modal with form fields (Full Name, Roblox Profile, Gender, Division preference).
* **Automated Verified Role Provisioning**:
  * New configuration option in `/card setup verified_role:@Citizen`.
  * When a card is accepted, the bot automatically grants the `@Citizen` role in the Discord server alongside the existing nickname synchronizer.
* **Audit & Log Routing (`audit_channel`)**:
  * Added to `/card setup audit_channel:#card-logs`.
  * Logs all administrative actions (approvals, rejections, promotions, revocations, template changes) with audit metadata.

### Phase 2: Self-Service & Lifecycle Management (Mid-Term)
* **Card Refresh & Avatar Resync (`/card refresh`)**:
  * Allows citizens to update their card image when they change Roblox avatars or clothing without changing their existing Serial ID or requiring full staff re-application.
* **Division Transfer Requests (`/card transfer`)**:
  * Workflow for moving between divisions (e.g. from Civil Service to Armed Forces) with officer sign-off.
* **Bulk Registry Export (`/card export`)**:
  * Restricted to Server Owner & Admins.
  * Exports all active, pending, and revoked cards as structured CSV or JSON for server backups.

### Phase 3: External Integration & In-Game Roblox Lua Bridge (Advanced)
* **Web Verification Hologram Portal**:
  * Public web route on the bot's HTTP server (`/verify/:serialId`) where scanning the QR code or visiting the URL displays a 3D holographic rendering of the card and citizen status.
* **Roblox In-Game HTTP API**:
  * REST API endpoint (`/api/v1/verify?robloxId=XXXXX`) enabling Roblox game scripts to:
    * Check if an in-game player holds an active UOI Citizen Card.
    * Grant exclusive in-game perks, access doors, or uniform ranks based on their verified card division and rank tier.
* **Card NFC / Mobile Wallet Pass Generation**:
  * Optional Apple Wallet (.pkpass) export enabling citizens to carry their UOI ID card directly on mobile devices.

---

## 4. Implementation Priority Matrix

| Feature | Impact | Complexity | Priority |
|---|---|---|---|
| Expanded Card Metadata Schema (Division, Clearance, Dates) | High | Low | **P0 (Immediate)** |
| Automatic `@Citizen` Discord Role Assignment | High | Low | **P0 (Immediate)** |
| Interactive Discord Modal Form (`/card apply`) | High | Medium | **P1 (Near-Term)** |
| Web Verification Portal (`/verify/[serialId]`) | High | Medium | **P1 (Near-Term)** |
| Dynamic QR Code Generation on Card Graphic | High | Low | **P1 (Near-Term)** |
| Self-Service Card Avatar Resync (`/card refresh`) | Medium | Low | **P2 (Follow-up)** |
| In-Game Roblox HTTP Verification API | High | Medium | **P2 (Follow-up)** |
| Administrative Audit Log Channel | Medium | Low | **P2 (Follow-up)** |
| Batch CSV/JSON Export | Medium | Low | **P3 (Planned)** |
