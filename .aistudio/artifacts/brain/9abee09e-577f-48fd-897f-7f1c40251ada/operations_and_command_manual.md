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
/card set-template reset:True
```
Removes the custom template and restores the default official Union of Indians template.

---

## 3. Citizen Card Workflow

### Applying for an ID Card (`/card generate` or `/card apply`)

The `/card generate` command is an intelligent, streamlined application command:

#### Method A: Interactive Modal Popup Form (Recommended)
```
/card generate
```
Type `/card generate` with no options to open an interactive modal prompting for:
* **Full Legal Name**
* **Gender**
* **Roblox Username** (optional — auto-detects if left blank)
* **Division / Branch Preference** (optional — e.g. *Civilian Directorate*, *Armed Forces*, *Homeland Security*)

#### Method B: Direct Fast One-Liner Command
```
/card generate fullname:Suresh Kumar gender:Male [roblox:Suresh_RBLX] [division:Civilian Directorate] [citizen:@user]
```
* **Auto-Scanned Server Role**: Automatically scans the applicant's Discord roles in the server and stamps their genuine hierarchical role (e.g. *Senior Officer*, *Commandant*, *Cadet*, *Citizen*) onto the card. Manual rank typing has been eliminated to prevent falsification.
* If the user already linked their Roblox account, the `roblox` parameter can be omitted.
* Dispatches an interactive review ticket to the staff channel.

### Self-Service Card Refresh
```
/card refresh
```
Allows cardholders to refresh their card graphic with their latest Roblox 3D avatar headshot and latest Discord server role while preserving their exact same unique Serial ID. If an expired cardholder runs `/card refresh`, their active 2-month validity window is renewed!

### Inspecting Active Citizen Card & Records
```
/card show [citizen:@user]
```
* **Implicit Server Context Detection**: Automatically resolves the current server's citizenship registry and active custom template.
* **Server-Specific Credential Flag**:
  * If a citizen holds active cards across multiple servers (e.g. Server A as *Commandant* and Server B as *Cadet*), the card graphic dynamically renders a prominent **`SERVER-SPECIFIC • [SERVER NAME]`** security flag in gold and emerald.
  * Embed highlights the jurisdiction scope and lists how many distinct server-specific cards the member holds.
* **2-Month Validity & Expiration Display**:
  * Displays issue date, exact 2-month expiration date (`<t:unix:F>`), and countdown (`<t:unix:R>`).
  * If expired, displays red alert banner: `🔴 EXPIRED (2-Month Validity Ended)` and prompts renewal.

### Inspecting Roblox Identity & Linking
```
/card whois [citizen:@user] [roblox:username]
```
Displays comprehensive Roblox identity dossier, 3D avatar headshot, Bloxlink/RoVer cross-check status, and registry record.

---

## 4. Downloading & Uploading Card Files (Owner & Administrator Only)

Strictly restricted to the **Server Owner** or members with the **Administrator** permission.

### Downloading Card Database Files (`/card export`)
```
/card export [format:json|csv] [scope:this_server|all_servers]
```
* **Complete Metadata & Timestamps**: Every card exported contains full creation date/time (`issuedAt` in ISO & human-readable UTC), exact 2-month expiration date (`expiresAt`), `daysRemaining`, clearance, division, Roblox UID, and Discord ID.
* **Format Choices**:
  * `json` (Default): Complete JSON database dump.
  * `csv`: Excel / Google Sheets compatible spreadsheet.
* **Permanent Backup Snapshot**: Every export automatically creates an immutable, permanent snapshot in `data/backups/export_<guildId>_<timestamp>.<ext>`.

### Uploading Card Files (`/card import`)
```
/card import file:<attachment> [file2:<attachment>] [file3:<attachment>] [file4:<attachment>] [file5:<attachment>] [mode:merge|replace]
```
* **Multiple Files Supported**: Attach up to 5 card files (`file`, `file2`, `file3`, `file4`, `file5`) in a single command.
* **Accepts Unmarked Format**:
  * If an uploaded file is in legacy or unmarked format (missing `issuedAt`, creation dates, or timestamps), the bot **automatically detects it and stamps it with the current date and time**, computes the 2-month expiration date, and activates the proactive reminder sentinel.
  * If a card already has timestamps, the original dates are preserved.
* **Permanent Storage Onwards**:
  * Persisted directly to `data/cards.json` with synchronous atomic flush.
  * Raw uploaded files are archived permanently into `data/backups/import_<guildId>_<timestamp>_<filename>`.
* **Modes**:
  * `merge` (Default): Updates existing cards and appends new ones.
  * `replace`: Clears the server's previous records before importing.

---

## 5. 2-Month Expiration & Automated Proactive DMs

All issued and imported UOI Citizen ID cards follow a strict **2-Month Validity Policy**.

### Automated Expiration Sentinel Intervals
The bot continuously monitors all registered cards in the background and automatically sends proactive Direct Messages (DMs) to cardholders at all four specified intervals:

1. **10 Days Prior (`d10`)**: Initial courtesy notice that card will expire in 10 days.
2. **5 Days Prior (`d5`)**: Reminder notice with days remaining and renewal guidance.
3. **3 Days Prior (`d3`)**: Urgent warning notice detailing steps to renew.
4. **1 Day Prior (`d1`)**: Final 24-hour notice alerting citizen of imminent credential expiration.
5. **0 Days / Expiration Moment (`expired`)**: Official notice that the card has expired, updating card status to `EXPIRED` until renewed via `/card refresh` or `/card apply`.

Each DM contains:
* Full Citizen Name & unique Serial ID.
* Server Name where card was issued.
* Issue Date & exact Expiration Timestamp (`<t:unix:F>`).
* Actionable renewal instructions.
* Anti-spam tracking: each alert interval is only sent once per cycle.

---

## 6. Staff Review & Instant Direct Message (DM) Notification

When an applicant submits `/card generate`, an interactive review ticket is posted to the designated `staff_channel`:

### Staff Action Buttons:
1. **[✅ Accept & Issue Card]**:
   * Stamps card onto official server template with photo, rank, barcode, QR code, and 2-month validity (`VALID THRU`).
   * Automatically assigns server nickname: `FullName [UOI-Serial-ID]`.
   * Automatically grants verified role (e.g. `@Citizen`).
   * Broadcasts card to public `delivery_channel` with expiration timestamp.
   * 📬 **Automatic Direct Message (DM) Notification**: Instantly DMs the citizen with:
     * Official approval message from the server.
     * Full legal name, permanent Serial ID, and scanned rank tier.
     * High-resolution PNG image of their official ID card attached.
     * Explicit 2-month validity window with notification schedule.
2. **[❌ Decline with Reason]**:
   * Prompts the officer for a specific rejection reason.
   * 📬 **Direct Message (DM) Notification**: Immediately DMs the user detailing the exact reason specified by staff so they can rectify and reapply.

---

## 7. Automated 48-Hour Card Application Expiry Sentinel

To prevent applications from hanging or bugging when staff queues are busy or inactive, all pending applications enforce an automatic expiration timeout.

### Standard Review Window (Default: 48 Hours / Configurable)
* **Creation Timestamping**: When an application is submitted via `/card apply`, `/card generate`, or modal form (`card_modal_apply`), the bot records `submittedAt`, `expiresAt` (default: 48 hours), and `expiresAtTimestamp`.
* **Live Expiration Countdowns**:
  * **Staff Review Embed**: Displays `⏳ Application Expiry: <t:unix:R> (<t:unix:f>)`.
  * **Applicant Confirmation Embed**: Displays `⏳ Review Timeout Window: <t:unix:R> (Auto-expires if unreviewed)`.
* **Configurable in `/card setup`**:
  * Administrators can customize the review timeout window using the optional `application_expiry_hours` option (range: 1 to 336 hours / default: 48).

### Automated Resolution & Unblocking
1. **Auto-Unblock on Reapplication**:
   * If an applicant runs `/card apply` or `/card generate` and has an existing pending application that has exceeded its review window, the bot **automatically transitions the stale request to `EXPIRED`** and allows the new application to proceed immediately.
   * Citizens are never blocked or stuck permanently because of an old unreviewed ticket.
2. **Review Button Guarding**:
   * Clicking `[✅ Accept & Issue Card]` or `[❌ Decline with Reason]` on an expired ticket rejects the action cleanly with an ephemeral notice informing the officer that the 48-hour review window elapsed.
   * Automatically edits the staff message to deactivate the buttons and labels them `⏰ Application Expired (48h Timeout)`.
3. **Background Auto-Sweep & Proactive DM**:
   * An automated background sentinel sweeps the pending queue every 30 minutes (and on bot startup).
   * Stale applications are transitioned to `EXPIRED`, staff review buttons are deactivated, and the applicant receives a courtesy Direct Message (DM) informing them of the expiration and inviting them to reapply freely.

---

## 8. Public Web Dossier & Roblox REST API

The bot runs an integrated HTTP verification service on port 3000:
* **Web Dossier**: Visit `/verify?serial=UOI-2026-XXXXXX` or scan the QR code on any card.
* **In-Game Roblox API**: `GET /api/v1/verify?serial=UOI-2026-XXXXXX` or `GET /api/v1/verify?robloxId=12345678`.

---

## 8. Bot Display Name Styling & Color Studio (`/card botstyle`)

```
/card botstyle [font:10] [effect:1-9] [color:<theme>] [custom_hex:#HEX1] [custom_hex2:#HEX2]
```

### Full Customization Spectrum:
* **25 Curated Two-Tone Color Themes** (Maximum allowed Discord choices):
  1. `tiranga`: 🇮🇳 Indian Tricolor (#D95700 & #0D652D) [Default]
  2. `ashoka_navy`: 🇮🇳 Ashoka Royal Navy (#000080 & #FF671F)
  3. `cyber_cyan`: ⚡ Cyberpunk Neon (#00F0FF & #3B82F6)
  4. `imperial_gold`: 👑 Imperial Gold (#F59E0B & #B45309)
  5. `blood_crimson`: 🩸 Blood Crimson (#EF4444 & #991B1B)
  6. `emerald_forest`: 🌿 Deep Emerald (#0D652D & #10B981)
  7. `royal_purple`: 🔮 Royal Amethyst (#8B5CF6 & #6D28D9)
  8. `sunset_blaze`: 🌅 Sunset Blaze (#F97316 & #F43F5E)
  9. `toxic_matrix`: ☣️ Toxic Acid Matrix (#84CC16 & #22C55E)
  10. `midnight_sapphire`: 🌌 Midnight Sapphire (#2563EB & #1E1B4B)
  11. `sakura_blossom`: 🌸 Sakura Blossom (#EC4899 & #F472B6)
  12. `obsidian_stealth`: 🖤 Obsidian Stealth (#334155 & #0F172A)
  13. `arctic_glacier`: ❄️ Arctic Glacier (#06B6D4 & #E2E8F0)
  14. `plasma_fire`: 🔥 Plasma Fire (#FF5722 & #FFC107)
  15. `synthwave_neon`: 🌆 Synthwave Neon (#D946EF & #8B5CF6)
  16. `bronze_copper`: 🛡️ Antique Bronze (#D97706 & #78350F)
  17. `aurora_teal`: 🌌 Aurora Borealis (#14B8A6 & #6366F1)
  18. `velvet_wine`: 🍷 Velvet Wine (#E11D48 & #881337)
  19. `uoi_cyan`: 💠 UOI Signature Cyan (#38BDF8 & #0284C7)
  20. `solar_yellow`: ☀️ Solar Flare (#EAB308 & #EA580C)
  21. `deep_nebula`: 🚀 Deep Nebula (#6366F1 & #A855F7)
  22. `platinum_ghost`: 👻 Platinum Ghost (#CBD5E1 & #64748B)
  23. `ruby_rose`: 🌹 Ruby Rose (#FB7185 & #BE123C)
  24. `ocean_lagoon`: 🌊 Ocean Lagoon (#0284C7 & #2DD4BF)
  25. `golden_hour`: ✨ Golden Hour (#F59E0B & #F97316)

* **Infinite 24-Bit RGB Custom Hex Input**:
  * `custom_hex`: Primary color (e.g., `#FF0055`, `FF0055`, `#00FFAA`).
  * `custom_hex2`: Secondary gradient stop (e.g., `#001122`).
  * If valid 6-digit hex values are provided, they take priority over preset themes, giving server owners complete brand freedom.

* **9 Visual Rendering Effects**:
  1. `1`: ⬛ Solid Flat Color
  2. `2`: 🌈 Two-Tone Linear Gradient [Default]
  3. `3`: ⚡ Electric Neon Glow
  4. `4`: 🎨 Toon Pop Outline
  5. `5`: 💥 3D Pop Drop-Shadow
  6. `6`: 🔮 Holographic Prismatic Shimmer
  7. `7`: ⚡ Cyberpunk Pulse & Glitch
  8. `8`: ✨ Velvet Luxe Radiance
  9. `9`: ☀️ Radial Sunburst Flare

* **100% Reliable Server Role Coloring**:
  * Fixes Discord client inconsistencies where display name API styling isn't rendered on all mobile/legacy devices.
  * Checks the bot's editable server roles and updates the color to the primary palette color (or creates an auto-managed `@UOI Bot Display` role).
  * Guarantees vibrant username color in chat, the server member sidebar, and user popouts!

---

## 9. Citizen ID Card Visual Themes & Security Effects (`/card show`)

Citizens and staff inspecting cards via `/card show` can customize the rendering theme and security watermark overlay:

```
/card show [citizen:@user] [serial:UOI-2026-XXXXXX] [theme:<theme>] [effect:<effect>]
```

### 10 Visual Accent Color Themes:
* `gold`: Imperial Gold (#F59E0B & #B45309) [Default]
* `cyan`: UOI Government Cyan (#38BDF8 & #0284C7)
* `crimson`: Blood Crimson (#EF4444 & #991B1B)
* `emerald`: Forest Emerald (#10B981 & #0D652D)
* `purple`: Royal Amethyst (#8B5CF6 & #6D28D9)
* `cyber`: Cyberpunk Neon (#00F0FF & #3B82F6)
* `matrix`: Toxic Acid Matrix (#22C55E & #84CC16)
* `sunset`: Sunset Blaze (#F97316 & #F43F5E)
* `sakura`: Sakura Blossom (#EC4899 & #F472B6)
* `stealth`: Obsidian Tactical Stealth (#64748B & #0F172A)

### 4 Visual Security Effects:
* `standard`: Clean, high-contrast official blueprint layout.
* `holographic`: Prismatic rainbow diffraction foil with intricate anti-counterfeiting guilloche wavy security lines.
* `gold_embossed`: Dual metallic gold borders with beveled corner security crests.
* `stealth`: Matte dark tactical vignette with muted monochrome tone.

