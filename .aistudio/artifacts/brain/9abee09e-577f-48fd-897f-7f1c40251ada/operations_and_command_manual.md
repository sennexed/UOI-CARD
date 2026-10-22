# Union of Indians (UOI) ID Card Bot — Operations & Command Manual

This manual provides instructions for Server Owners, Administrators, Staff Reviewers, and Citizens using the **Union of Indians (UOI) ID Card System**.

---

## 1. Initial Server Setup (For Administrators)

Before citizens can receive cards, the server should be configured with designated review and announcement channels:

```
/card setup staff_channel:#card-review delivery_channel:#citizen-cards staff_role:@ImmigrationOfficer verified_role:@Citizen audit_channel:#card-logs auto_nickname:True
```

### Setup Options Explained:
* `staff_channel` *(Required)*: The private channel where officers review submitted card applications with inline **Approve** and **Reject** buttons.
* `delivery_channel` *(Optional)*: The public announcement channel where approved citizen ID cards are broadcasted.
* `staff_role` *(Optional)*: Role permitted to review cards. If omitted, the bot automatically auto-scans for staff/officer roles.
* `verified_role` *(Optional)*: Role automatically granted to the citizen upon card approval (e.g. `@Citizen` or `@Verified`).
* `audit_channel` *(Optional)*: Channel where security audit events (approvals, revocations, promotions) are recorded.
* `auto_nickname` *(Default: True)*: Automatically renames the citizen to `FullName [UOI-Serial-ID]` upon card approval.
* `bloxlink_api_key` / `rover_api_key` *(Optional)*: API keys for zero-friction cryptographic verification of Roblox accounts.

---

## 2. Managing Custom Card Templates

Each server can upload its own custom card template. The template will only apply to cards generated within that server:

### Upload Custom Template
```
/card set-template template:<image_attachment>
```
* **Recommended image resolution**: 1200 x 900 pixels (or 16:9 / 4:3 high-resolution PNG).
* The bot automatically normalizes, scales, and validates the uploaded image.

### Inspect Active Template
```
/card view-template
```
Displays whether the server is currently using a custom uploaded template or the default national template.

### Revert to Default Template
```
/card reset-template
```
Removes the custom template and restores the default official Union of Indians template.

---

## 3. Citizen Card Workflow

### Applying for an ID Card (Two Methods)

#### Method A: Interactive Modal Popup (Recommended)
```
/card apply
```
Opens a native Discord form modal prompting for:
* **Full Legal Name**
* **Gender**
* **Roblox Username** (optional — auto-detects if left blank)
* **Division / Branch Preference** (optional — e.g. *Civilian Directorate*, *Armed Forces*, *Homeland Security*)

#### Method B: Direct Slash Command
```
/card generate fullname:Suresh Kumar gender:Male [roblox:Suresh_RBLX] [division:Civilian Directorate]
```
* **Auto-Scanned Server Role**: The bot automatically scans the applicant's Discord roles in the server and stamps their genuine hierarchical role (e.g. *Senior Officer*, *Commandant*, *Cadet*, *Citizen*) onto the card. The manual rank option has been removed to prevent false rank claims.
* If the user already linked their Roblox account, the `roblox` parameter can also be left blank.
* The bot queues the request and dispatches an interactive review ticket to the staff channel.

### Self-Service Card Refresh
```
/card refresh
```
Allows existing cardholders to refresh their card graphic with their latest Roblox 3D avatar headshot (e.g. changed outfits or accessories) and latest Discord server role while preserving their exact same unique Serial ID!

### Inspecting Active Citizen Card
```
/card show [citizen:@user]
```
* **Implicit Server Context Detection**: The bot automatically resolves the current server's citizenship registry and active custom template.
* **Server-Specific Credential Flag**:
  * If a citizen holds active cards across multiple servers (e.g. Server A as *Commandant* and Server B as *Cadet*), the card graphic dynamically renders a prominent **`SERVER-SPECIFIC • [SERVER NAME]`** security flag in gold and emerald.
  * The Discord embed highlights the jurisdiction scope and lists how many distinct server-specific cards the member holds.
  * If the citizen does not have a card in the current server, the command cleanly indicates this and lists the other servers where they hold registered citizenship, preventing cross-server confusion.

### Inspecting Citizen Records (Staff/Officers)
```
/card inspect user:@user
```
Displays comprehensive dossier, registered serial ID, Roblox profile link, issuance timestamps, and status.

### Exporting Citizen Database (Admins & Officers)
```
/card export format:csv
```
Generates a downloadable CSV spreadsheet or JSON database dump of all registered citizen cards in the server for offline archiving.

---

## 5. Web Verification Portal & In-Game Roblox API

The bot runs an active web service on port 3000:

* **Public Verification Dossier Page**:
  * Visit `/verify?serial=UOI-2026-XXXXXX` or scan the dynamic QR code on any issued card to inspect the real-time hologram verification page and validity certificate.
* **In-Game Roblox `HttpService` REST API**:
  * `GET /api/v1/verify?serial=UOI-2026-XXXXXX`
  * `GET /api/v1/verify?robloxId=12345678`
  * Returns JSON payload: `{ success: true, verified: true, card: { serialId, fullName, robloxUsername, assignedRank, division, clearanceLevel, status } }`.

---

## 6. Owner-Only Maintenance Commands

The following commands are restricted to the **Server Owner** and **Bot Developer**:

| Command | Function |
|---|---|
| `/card git-status` | Displays active Git commit hash, auto-sync polling frequency, and webhook endpoint. |
| `/card git-sync` | Performs an automated Git pull from the remote repository and gracefully reboots the bot. |
| `/card memory` | Displays multi-server persistence status, active guild setups, and backup integrity metrics. |

---

## 6. Styling the Bot Display Name

Customize the bot's visual branding in your server:
```
/card botstyle font:10 effect:2 color:tiranga
```
* **Font 10 (Sinistre)**: High-impact stylistic lettering.
* **Effect 2 (Gradient)**: Smooth multi-stop gradient.
* **Color Schemes**: `tiranga` (Saffron, White, Emerald Green), `cyan`, `saffron`, or `emerald`.
