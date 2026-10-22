# Union of Indians (UOI) ID Card Bot — Operations & Command Manual

This manual provides instructions for Server Owners, Administrators, Staff Reviewers, and Citizens using the **Union of Indians (UOI) ID Card System**.

---

## 1. Initial Server Setup (For Administrators)

Before citizens can receive cards, the server should be configured with designated review and announcement channels:

```
/card setup staff_channel:#card-review delivery_channel:#citizen-cards staff_role:@ImmigrationOfficer auto_nickname:True
```

### Setup Options Explained:
* `staff_channel` *(Required)*: The private channel where officers review submitted card applications with inline **Approve** and **Reject** buttons.
* `delivery_channel` *(Optional)*: The public announcement channel where approved citizen ID cards are broadcasted. If omitted, cards are sent to the citizen's original command channel.
* `staff_role` *(Optional)*: Role permitted to approve/reject cards and run staff commands without requiring server administrator rights.
* `auto_nickname` *(Default: True)*: Automatically renames the citizen to their `FullName [UOI-Serial-ID]` upon card approval.
* `bloxlink_api_key` / `rover_api_key` *(Optional)*: API keys for zero-friction cryptographic verification of Roblox accounts.

---

## 2. Managing Custom Card Templates

Each server can upload its own custom card template. The template will only apply to cards generated within that server:

### Upload Custom Template
```
/card set-template template:<image_attachment>
```
* **Recommended image resolution**: 1200 x 750 pixels (or 16:9 / 4:3 high-resolution PNG).
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

### Step 1: Linking Roblox Account (One-time)
Citizens can permanently associate their Roblox profile:
```
/card link roblox:<RobloxUsernameOrID>
```
To verify linked account details:
```
/card whois citizen:@user
```

### Step 2: Applying for an ID Card
```
/card generate fullname:Suresh Kumar gender:Male roblox:Suresh_RBLX
```
* **Auto-Scanned Server Role**: The bot automatically scans the applicant's Discord roles in the server and stamps their genuine hierarchical role (e.g. *Senior Officer*, *Commandant*, *Cadet*, *Citizen*) onto the card. The manual rank option has been removed to prevent false rank claims.
* If the user already linked their Roblox account, the `roblox` parameter can also be left blank.
* The bot queues the request and dispatches an interactive review ticket to the staff channel.

### Step 3: Staff Approval / Rejection
Staff members with the configured role or administrator permissions will see the application embed with action buttons:
* **✅ Approve & Issue**: Generates the final card with an official serial number and barcode, saves the entry in the persistent database, announces the card in `#citizen-cards`, updates the user's server nickname, and DMs the citizen.
* **❌ Reject**: Opens a reason dialog and notifies the applicant with feedback.

---

## 4. Administrative & Security Commands

### Promoting a Citizen
```
/card promote citizen:@user rank:Senior Officer reason:Exemplary field service
```
Updates the citizen's database record and card badge rank.

### Revoking a Card
```
/card revoke serial:UOI-2026-849201 reason:Disciplinary discharge
```
Marks the serial ID as **REVOKED & BLACKLISTED**. Any future verification attempts will flag the card as invalid.

### Inspecting Citizen Records
```
/card inspect user:@user
```
Displays comprehensive dossier, registered serial ID, Roblox profile link, issuance timestamps, and status.

---

## 5. Owner-Only Maintenance Commands

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
