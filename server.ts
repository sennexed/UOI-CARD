import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API: Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // API: Get current permanent template
  app.get('/api/template', (req, res) => {
    for (const f of ['template.png', 'template.jpg', 'public/template.png', 'public/template.jpg']) {
      if (fs.existsSync(f)) {
        return res.sendFile(path.resolve(f));
      }
    }
    return res.status(404).json({ error: 'No permanent template found on server' });
  });

  // API: Save uploaded template to server as template.png
  app.post('/api/template', (req, res) => {
    try {
      const { dataUrl } = req.body;
      if (!dataUrl || !dataUrl.includes('base64,')) {
        return res.status(400).json({ error: 'Invalid dataUrl payload' });
      }
      const base64Data = dataUrl.split('base64,')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync('template.png', buffer);
      try {
        if (!fs.existsSync('public')) fs.mkdirSync('public');
        fs.writeFileSync('public/template.png', buffer);
      } catch (_) {}
      return res.json({ success: true, message: 'Template saved as template.png successfully' });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Helper to fetch binary image and convert to base64 data URL
  async function fetchImageAsDataUrl(imageUrl: string): Promise<string | null> {
    try {
      const resp = await fetch(imageUrl, {
        headers: { 'User-Agent': 'RobloxIdCardModule/1.0' },
      });
      if (!resp.ok) return null;
      const arrayBuffer = await resp.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mime = resp.headers.get('content-type') || 'image/png';
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch (err) {
      console.error('Failed to fetch image as data URL:', err);
      return null;
    }
  }

  // API: Roblox User & Avatar Lookup
  app.get('/api/roblox/user/:query', async (req, res) => {
    const query = req.params.query?.trim();
    if (!query) {
      return res.status(400).json({ error: 'Username or User ID is required' });
    }

    try {
      let userId: number | null = null;
      let userDetails: any = null;

      // Check if query is numeric (User ID)
      if (/^\d+$/.test(query)) {
        userId = parseInt(query, 10);
        const userResp = await fetch(`https://users.roblox.com/v1/users/${userId}`);
        if (userResp.ok) {
          userDetails = await userResp.json();
        } else if (userResp.status === 404) {
          return res.status(404).json({ error: `Roblox User ID ${query} not found` });
        }
      }

      // If not numeric or not found by ID, search by Username
      if (!userDetails) {
        const cleanUsername = query.replace(/^@/, '');
        const searchResp = await fetch('https://users.roblox.com/v1/usernames/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            usernames: [cleanUsername],
            excludeBannedUsers: false,
          }),
        });

        if (searchResp.ok) {
          const searchData = await searchResp.json();
          const match = searchData.data?.[0];
          if (match && match.id) {
            userId = match.id;
            const userResp = await fetch(`https://users.roblox.com/v1/users/${userId}`);
            if (userResp.ok) {
              userDetails = await userResp.json();
            } else {
              userDetails = {
                id: match.id,
                name: match.name,
                displayName: match.displayName,
                hasVerifiedBadge: match.hasVerifiedBadge,
              };
            }
          }
        }
      }

      if (!userDetails || !userId) {
        return res.status(404).json({ error: `Roblox user "${query}" not found` });
      }

      // Fetch avatar thumbnails in parallel
      const [fullBodyResp, bustResp, headshotResp] = await Promise.all([
        fetch(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=720x720&format=Png&isCircular=false`),
        fetch(`https://thumbnails.roblox.com/v1/users/avatar-bust?userIds=${userId}&size=420x420&format=Png&isCircular=false`),
        fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`),
      ]);

      const [fullBodyJson, bustJson, headshotJson] = await Promise.all([
        fullBodyResp.ok ? fullBodyResp.json() : { data: [] },
        bustResp.ok ? bustResp.json() : { data: [] },
        headshotResp.ok ? headshotResp.json() : { data: [] },
      ]);

      const fullBodyUrl = fullBodyJson.data?.[0]?.imageUrl || null;
      const bustUrl = bustJson.data?.[0]?.imageUrl || null;
      const headshotUrl = headshotJson.data?.[0]?.imageUrl || null;

      // Convert primary full body and bust thumbnails to base64 Data URLs so canvas is 100% CORS clean
      let fullBodyDataUrl: string | null = null;
      let bustDataUrl: string | null = null;

      if (fullBodyUrl) {
        fullBodyDataUrl = await fetchImageAsDataUrl(fullBodyUrl);
      }
      if (bustUrl) {
        bustDataUrl = await fetchImageAsDataUrl(bustUrl);
      }

      return res.json({
        success: true,
        user: {
          id: userDetails.id,
          name: userDetails.name,
          displayName: userDetails.displayName || userDetails.name,
          description: userDetails.description || '',
          created: userDetails.created || null,
          isBanned: !!userDetails.isBanned,
          hasVerifiedBadge: !!userDetails.hasVerifiedBadge,
        },
        avatar: {
          fullBodyUrl,
          bustUrl,
          headshotUrl,
          fullBodyDataUrl,
          bustDataUrl,
        },
      });
    } catch (err: any) {
      console.error('Roblox API Proxy error:', err);
      return res.status(500).json({ error: err.message || 'Failed to connect to Roblox API' });
    }
  });

  // API: Convert any Roblox avatar URL to CORS-safe data URL
  app.get('/api/roblox/avatar-data', async (req, res) => {
    const userId = req.query.userId as string;
    const type = (req.query.type as string) || 'avatar'; // 'avatar' (full body), 'avatar-bust', or 'avatar-headshot'

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    try {
      const size = type === 'avatar' ? '720x720' : '420x420';
      const thumbResp = await fetch(
        `https://thumbnails.roblox.com/v1/users/${type}?userIds=${userId}&size=${size}&format=Png&isCircular=false`
      );
      if (!thumbResp.ok) {
        return res.status(thumbResp.status).json({ error: 'Thumbnail API error' });
      }
      const thumbJson = await thumbResp.json();
      const imageUrl = thumbJson.data?.[0]?.imageUrl;
      if (!imageUrl) {
        return res.status(404).json({ error: 'Avatar image not available' });
      }

      const dataUrl = await fetchImageAsDataUrl(imageUrl);
      return res.json({ dataUrl, imageUrl });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // --- CARD DATABASE VAULT & DISCORD COMMANDS API ---
  interface CardVaultRecord {
    serialId: string;
    status: 'ACTIVE' | 'REVOKED';
    issuedTo: {
      discordId: string;
      discordTag: string;
      robloxUsername: string;
      robloxUserId: string;
      fullName: string;
      assignedRank: string;
      gender?: string;
    };
    issuedBy: {
      discordId: string;
      discordTag: string;
    };
    issuedAt: string;
    serverNickname: string;
    revokeReason?: string;
    history: Array<{
      action: 'ISSUED' | 'PROMOTED' | 'REVOKED';
      performedBy: { discordId: string; discordTag: string };
      timestamp: string;
      details: string;
    }>;
  }

  interface ServerGuildConfig {
    isSetup: boolean;
    staffChannelId: string;
    staffChannelName: string;
    deliveryChannelId: string | null;
    deliveryChannelName: string | null;
    staffRoleId: string | null;
    staffRoleName: string | null;
    autoNickname: boolean;
    setupAt: string;
    setupBy: { discordId: string; discordTag: string };
  }

  interface PendingCardRequest {
    id: string;
    targetUser: {
      discordId: string;
      discordTag: string;
    };
    applicantUser: {
      discordId: string;
      discordTag: string;
    };
    fullName: string;
    gender: string;
    assignedRank: string;
    robloxUsername: string;
    robloxUserId: string;
    robloxAvatarUrl: string | null;
    submittedAt: string;
    status: 'PENDING' | 'APPROVED' | 'DECLINED';
    declineReason?: string | null;
    reviewedBy?: { discordId: string; discordTag: string } | null;
    reviewedAt?: string | null;
    issuedSerialId?: string | null;
  }

  let defaultGuildConfig: ServerGuildConfig = {
    isSetup: true,
    staffChannelId: '112233445566778899',
    staffChannelName: 'officer-review',
    deliveryChannelId: '223344556677889900',
    deliveryChannelName: 'citizen-id-cards',
    staffRoleId: '334455667788990011',
    staffRoleName: 'Union Officer',
    autoNickname: true,
    setupAt: new Date(Date.now() - 86400000 * 10).toISOString(),
    setupBy: { discordId: '998877665544332211', discordTag: 'ChiefJustice#1122' },
  };

  const cardRequests: Map<string, PendingCardRequest> = new Map([
    [
      'REQ-2026-8812',
      {
        id: 'REQ-2026-8812',
        targetUser: {
          discordId: '883322114455667788',
          discordTag: 'CitizenAarav#0001',
        },
        applicantUser: {
          discordId: '883322114455667788',
          discordTag: 'CitizenAarav#0001',
        },
        fullName: 'Aarav Patel',
        gender: 'Male',
        assignedRank: 'COMMUNITY MEMBER',
        robloxUsername: 'Aarav_RTP',
        robloxUserId: '48291045',
        robloxAvatarUrl: 'https://tr.rbxcdn.com/30DAY-AvatarHeadshot-B1E29F9CAE1E09441113EFB2E8513364-Png/420/420/AvatarHeadshot/Png/noFilter',
        submittedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
        status: 'PENDING',
      },
    ],
  ]);

  // Pre-seed card vault with official records
  const cardVault: Map<string, CardVaultRecord> = new Map([
    [
      'UOI-2026-109283',
      {
        serialId: 'UOI-2026-109283',
        status: 'ACTIVE',
        issuedTo: {
          discordId: '123456789012345678',
          discordTag: 'Aarav_Prez#0001',
          robloxUsername: 'Aarav_Prez99',
          robloxUserId: '1092837461',
          fullName: 'Aarav Dev Sharma',
          assignedRank: 'PRESIDENT',
        },
        issuedBy: {
          discordId: '998877665544332211',
          discordTag: 'ChiefJustice#1122',
        },
        issuedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
        serverNickname: 'Aarav Dev Sharma [UOI-2026-109283]',
        history: [
          {
            action: 'ISSUED',
            performedBy: { discordId: '998877665544332211', discordTag: 'ChiefJustice#1122' },
            timestamp: new Date(Date.now() - 86400000 * 5).toISOString(),
            details: 'Initial Presidential ID issued following election certification',
          },
        ],
      },
    ],
    [
      'UOI-2026-156001',
      {
        serialId: 'UOI-2026-156001',
        status: 'ACTIVE',
        issuedTo: {
          discordId: '223344556677889900',
          discordTag: 'Builderman#0001',
          robloxUsername: 'Builderman',
          robloxUserId: '156',
          fullName: 'David Baszucki',
          assignedRank: 'PRESIDENT',
        },
        issuedBy: {
          discordId: '123456789012345678',
          discordTag: 'Aarav_Prez#0001',
        },
        issuedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
        serverNickname: 'David Baszucki [UOI-2026-156001]',
        history: [
          {
            action: 'ISSUED',
            performedBy: { discordId: '123456789012345678', discordTag: 'Aarav_Prez#0001' },
            timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
            details: 'Honorary Union Presidential Card issued to Roblox founder',
          },
        ],
      },
    ],
    [
      'UOI-2026-991823',
      {
        serialId: 'UOI-2026-991823',
        status: 'REVOKED',
        issuedTo: {
          discordId: '334455667788990011',
          discordTag: 'RogueCadet#4433',
          robloxUsername: 'RogueCadet_X',
          robloxUserId: '88776655',
          fullName: 'Devansh Roy',
          assignedRank: 'COMMUNITY MEMBER',
        },
        issuedBy: {
          discordId: '456789012345678901',
          discordTag: 'SecurityCmdr#9900',
        },
        issuedAt: new Date(Date.now() - 86400000 * 12).toISOString(),
        serverNickname: 'Devansh Roy [REVOKED]',
        revokeReason: 'Violation of Union Security Protocol §4.2 (Unauthorized border trespass)',
        history: [
          {
            action: 'ISSUED',
            performedBy: { discordId: '456789012345678901', discordTag: 'SecurityCmdr#9900' },
            timestamp: new Date(Date.now() - 86400000 * 12).toISOString(),
            details: 'Community enlistment card issued',
          },
          {
            action: 'REVOKED',
            performedBy: { discordId: '456789012345678901', discordTag: 'SecurityCmdr#9900' },
            timestamp: new Date(Date.now() - 86400000 * 1).toISOString(),
            details: 'Card revoked: Violation of Union Security Protocol §4.2',
          },
        ],
      },
    ],
  ]);

  // --- SETUP & CONFIGURATION ENDPOINTS ---
  // GET /api/card/setup/status
  app.get('/api/card/setup/status', (req, res) => {
    res.json({ config: defaultGuildConfig });
  });

  // POST /api/card/setup - Configure server setup
  app.post('/api/card/setup', (req, res) => {
    const { staffChannelId, staffChannelName, deliveryChannelId, deliveryChannelName, staffRoleId, staffRoleName, autoNickname, setupBy } = req.body;
    if (!staffChannelId && !staffChannelName) {
      return res.status(400).json({ error: 'staff_channel is required for setup' });
    }

    defaultGuildConfig = {
      isSetup: true,
      staffChannelId: staffChannelId || '112233445566778899',
      staffChannelName: staffChannelName || 'officer-review',
      deliveryChannelId: deliveryChannelId || null,
      deliveryChannelName: deliveryChannelName || null,
      staffRoleId: staffRoleId || null,
      staffRoleName: staffRoleName || null,
      autoNickname: autoNickname ?? true,
      setupAt: new Date().toISOString(),
      setupBy: {
        discordId: setupBy?.discordId || 'ADMIN',
        discordTag: setupBy?.discordTag || 'Server Administrator',
      },
    };

    return res.json({ success: true, message: 'Server setup completed successfully', config: defaultGuildConfig });
  });

  // POST /api/card/setup/reset - Reset setup (lock commands for demonstration)
  app.post('/api/card/setup/reset', (req, res) => {
    defaultGuildConfig.isSetup = false;
    return res.json({ success: true, message: 'Server setup reset to UNCONFIGURED', config: defaultGuildConfig });
  });

  // --- CARD REQUEST QUEUE (STAFF APPROVAL WORKFLOW) ---
  // GET /api/card/requests - List all requests
  app.get('/api/card/requests', (req, res) => {
    const list = Array.from(cardRequests.values()).reverse();
    res.json({ total: list.length, requests: list, isServerSetup: defaultGuildConfig.isSetup });
  });

  // POST /api/card/request/submit - Citizen submits /card generate request (pending staff review)
  app.post('/api/card/request/submit', (req, res) => {
    if (!defaultGuildConfig.isSetup) {
      return res.status(403).json({
        error: 'SERVER_NOT_CONFIGURED',
        message: 'This server has not completed setup yet. An administrator must run /card setup first.',
      });
    }

    const { targetUser, applicantUser, fullName, gender, assignedRank, robloxUsername, robloxUserId, robloxAvatarUrl } = req.body;
    if (!fullName || !assignedRank || !robloxUsername) {
      return res.status(400).json({ error: 'Missing required card application details' });
    }

    const target = {
      discordId: targetUser?.discordId?.trim() || '000000000000000000',
      discordTag: targetUser?.discordTag?.trim() || `${robloxUsername}#0000`,
    };

    // 1. Strict 1 Card Per Person check in active vault
    const existingActiveCard = Array.from(cardVault.values()).find(
      (c) =>
        c.status === 'ACTIVE' &&
        ((target.discordId !== '000000000000000000' && c.issuedTo.discordId === target.discordId) ||
          (robloxUserId && c.issuedTo.robloxUserId === robloxUserId) ||
          (c.issuedTo.robloxUsername.toLowerCase() === robloxUsername.toLowerCase()))
    );

    if (existingActiveCard) {
      return res.status(409).json({
        error: `Citizen already has an active card (${existingActiveCard.serialId}). Policy allows only 1 card per citizen.`,
        existingCard: existingActiveCard,
      });
    }

    // 2. Check if already has a PENDING request
    const existingPending = Array.from(cardRequests.values()).find(
      (r) =>
        r.status === 'PENDING' &&
        ((target.discordId !== '000000000000000000' && r.targetUser.discordId === target.discordId) ||
          (robloxUserId && r.robloxUserId === robloxUserId) ||
          (r.robloxUsername.toLowerCase() === robloxUsername.toLowerCase()))
    );

    if (existingPending) {
      return res.status(409).json({
        error: 'PENDING_REQUEST_EXISTS',
        message: `There is already a pending card application for this citizen in #${defaultGuildConfig.staffChannelName || 'staff-review'} (ID: ${existingPending.id}).`,
        request: existingPending,
      });
    }

    const requestId = `REQ-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const newRequest: PendingCardRequest = {
      id: requestId,
      targetUser: target,
      applicantUser: {
        discordId: applicantUser?.discordId?.trim() || target.discordId,
        discordTag: applicantUser?.discordTag?.trim() || target.discordTag,
      },
      fullName,
      gender: gender || 'Other',
      assignedRank: assignedRank.toUpperCase(),
      robloxUsername,
      robloxUserId: robloxUserId || '',
      robloxAvatarUrl: robloxAvatarUrl || null,
      submittedAt: new Date().toISOString(),
      status: 'PENDING',
    };

    cardRequests.set(requestId, newRequest);
    return res.status(201).json({
      success: true,
      message: 'Card application submitted successfully and dispatched to staff review channel.',
      request: newRequest,
      reviewChannel: defaultGuildConfig.staffChannelName,
    });
  });

  // POST /api/card/request/accept - Staff accepts card application
  app.post('/api/card/request/accept', (req, res) => {
    const { requestId, reviewedBy } = req.body;
    if (!requestId) {
      return res.status(400).json({ error: 'requestId is required' });
    }

    const request = cardRequests.get(requestId);
    if (!request) {
      return res.status(404).json({ error: `Request ${requestId} not found` });
    }

    if (request.status !== 'PENDING') {
      return res.status(400).json({ error: `Request is already ${request.status}` });
    }

    const reviewer = {
      discordId: reviewedBy?.discordId || 'OFFICER-ADMIN',
      discordTag: reviewedBy?.discordTag || 'Staff Reviewer',
    };

    const serialId = `UOI-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const serverNickname = `${request.fullName} [${serialId}]`;

    const newCard: CardVaultRecord = {
      serialId,
      status: 'ACTIVE',
      issuedTo: {
        discordId: request.targetUser.discordId,
        discordTag: request.targetUser.discordTag,
        robloxUsername: request.robloxUsername,
        robloxUserId: request.robloxUserId,
        fullName: request.fullName,
        assignedRank: request.assignedRank,
        gender: request.gender,
      },
      issuedBy: reviewer,
      issuedAt: new Date().toISOString(),
      serverNickname,
      history: [
        {
          action: 'ISSUED',
          performedBy: reviewer,
          timestamp: new Date().toISOString(),
          details: `Card application ${request.id} accepted and approved by ${reviewer.discordTag}`,
        },
      ],
    };

    cardVault.set(serialId, newCard);

    request.status = 'APPROVED';
    request.reviewedBy = reviewer;
    request.reviewedAt = new Date().toISOString();
    request.issuedSerialId = serialId;
    cardRequests.set(requestId, request);

    return res.json({
      success: true,
      message: `Card approved and issued for ${request.fullName} (${serialId})`,
      card: newCard,
      request,
      deliveryChannel: defaultGuildConfig.deliveryChannelName,
      serverNickname,
    });
  });

  // POST /api/card/request/decline - Staff declines card application with reason
  app.post('/api/card/request/decline', (req, res) => {
    const { requestId, reason, reviewedBy } = req.body;
    if (!requestId || !reason) {
      return res.status(400).json({ error: 'requestId and reason are required' });
    }

    const request = cardRequests.get(requestId);
    if (!request) {
      return res.status(404).json({ error: `Request ${requestId} not found` });
    }

    if (request.status !== 'PENDING') {
      return res.status(400).json({ error: `Request is already ${request.status}` });
    }

    const reviewer = {
      discordId: reviewedBy?.discordId || 'OFFICER-ADMIN',
      discordTag: reviewedBy?.discordTag || 'Staff Reviewer',
    };

    request.status = 'DECLINED';
    request.declineReason = reason;
    request.reviewedBy = reviewer;
    request.reviewedAt = new Date().toISOString();
    cardRequests.set(requestId, request);

    return res.json({
      success: true,
      message: `Card request ${requestId} declined: ${reason}`,
      request,
    });
  });

  // GET /api/card/vault - List all cards
  app.get('/api/card/vault', (req, res) => {
    const list = Array.from(cardVault.values()).reverse();
    res.json({ total: list.length, cards: list });
  });

  // POST /api/card/issue - Command 1: /card generate (1 card per person enforcement)
  app.post('/api/card/issue', (req, res) => {
    if (!defaultGuildConfig.isSetup) {
      return res.status(403).json({
        error: 'SERVER_NOT_CONFIGURED',
        message: 'This server has not completed setup yet. An administrator must run /card setup first.',
      });
    }

    const { serialId, issuedTo, issuedBy } = req.body;
    if (!serialId || !issuedTo || !issuedTo.fullName || !issuedTo.assignedRank) {
      return res.status(400).json({ error: 'Incomplete card issue payload' });
    }

    const executor = {
      discordId: issuedBy?.discordId?.trim() || 'ADMIN-DISPATCH',
      discordTag: issuedBy?.discordTag?.trim() || 'UOI Dispatch Bot',
    };

    const targetUser = {
      discordId: issuedTo.discordId?.trim() || '000000000000000000',
      discordTag: issuedTo.discordTag?.trim() || `${issuedTo.robloxUsername || 'citizen'}#0000`,
      robloxUsername: issuedTo.robloxUsername || '',
      robloxUserId: issuedTo.robloxUserId || '',
      fullName: issuedTo.fullName,
      assignedRank: issuedTo.assignedRank,
      gender: ['Male', 'Female'].includes(issuedTo.gender) ? issuedTo.gender : (issuedTo.gender?.toLowerCase() === 'female' ? 'Female' : issuedTo.gender?.toLowerCase() === 'male' ? 'Male' : 'Other'),
    };

    // STRICT 1 CARD PER PERSON CHECK:
    const existingActiveCard = Array.from(cardVault.values()).find(
      (c) =>
        c.status === 'ACTIVE' &&
        ((targetUser.discordId !== '000000000000000000' && c.issuedTo.discordId === targetUser.discordId) ||
          (targetUser.robloxUserId && c.issuedTo.robloxUserId === targetUser.robloxUserId) ||
          (targetUser.robloxUsername && c.issuedTo.robloxUsername.toLowerCase() === targetUser.robloxUsername.toLowerCase()))
    );

    if (existingActiveCard) {
      return res.status(409).json({
        error: `Citizen ${targetUser.fullName} already has an active card (${existingActiveCard.serialId}). Policy allows only 1 card per person. Use /card show to view it.`,
        card: existingActiveCard,
      });
    }

    const serverNickname = `${targetUser.fullName} [${serialId}]`;

    const record: CardVaultRecord = {
      serialId,
      status: 'ACTIVE',
      issuedTo: targetUser,
      issuedBy: executor,
      issuedAt: new Date().toISOString(),
      serverNickname,
      history: [
        {
          action: 'ISSUED',
          performedBy: executor,
          timestamp: new Date().toISOString(),
          details: `Card successfully issued via slash command by ${executor.discordTag}`,
        },
      ],
    };

    cardVault.set(serialId, record);
    return res.status(201).json({ success: true, card: record });
  });

  // GET /api/card/show/:target - Command: /card show [user]
  app.get('/api/card/show/:target', (req, res) => {
    const query = req.params.target?.trim().toLowerCase();
    if (!query) {
      return res.status(400).json({ error: 'Target query is required' });
    }

    const found = Array.from(cardVault.values()).find((c) => {
      return (
        c.issuedTo.discordId.toLowerCase() === query ||
        c.issuedTo.discordTag.toLowerCase() === query ||
        c.issuedTo.robloxUsername.toLowerCase() === query ||
        c.issuedTo.robloxUserId === query ||
        c.serialId.toLowerCase() === query
      );
    });

    if (!found || found.status === 'REVOKED') {
      return res.status(404).json({
        found: false,
        message: `No active UOI Citizen ID Card found in the database for '${req.params.target}'.`,
      });
    }

    return res.json({ found: true, card: found });
  });

  // GET /api/card/verify/:serialId - Command 2: /card verify [serial_id]
  app.get('/api/card/verify/:serialId', (req, res) => {
    const cleanSerial = req.params.serialId?.trim().toUpperCase();
    if (!cleanSerial) {
      return res.status(400).json({ error: 'Serial ID is required' });
    }

    const card = cardVault.get(cleanSerial);
    if (!card) {
      return res.status(404).json({
        verified: false,
        status: 'COUNTERFEIT_OR_NOT_FOUND',
        message: `Serial '${cleanSerial}' is not registered in the Union of Indians registry.`,
      });
    }

    return res.json({
      verified: card.status === 'ACTIVE',
      card,
      message:
        card.status === 'ACTIVE'
          ? `Verified authentic card for ${card.issuedTo.fullName} (${card.issuedTo.assignedRank}). Issued by ${card.issuedBy.discordTag}.`
          : `Warning: This card was REVOKED on ${card.history.find((h) => h.action === 'REVOKED')?.timestamp.split('T')[0]}. Reason: ${card.revokeReason || 'Administrative order'}.`,
    });
  });

  // GET /api/card/inspect/:query - Command 3: /card inspect @user or [roblox]
  app.get('/api/card/inspect/:query', (req, res) => {
    const query = req.params.query?.trim().toLowerCase();
    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const cards = Array.from(cardVault.values()).filter((c) => {
      const matchRobloxName = c.issuedTo.robloxUsername.toLowerCase() === query.replace(/^@/, '');
      const matchRobloxId = c.issuedTo.robloxUserId === query;
      const matchDiscordId = c.issuedTo.discordId === query;
      const matchFullName = c.issuedTo.fullName.toLowerCase().includes(query);
      const matchSerial = c.serialId.toLowerCase() === query;
      return matchRobloxName || matchRobloxId || matchDiscordId || matchFullName || matchSerial;
    });

    if (cards.length === 0) {
      return res.status(404).json({ error: `No citizen records found matching '${query}'` });
    }

    return res.json({ query, totalMatches: cards.length, records: cards });
  });

  // POST /api/card/promote - Command 4a: /card promote @user [new_rank]
  app.post('/api/card/promote', (req, res) => {
    const { serialId, newRank, performedBy, reason } = req.body;
    if (!serialId || !newRank) {
      return res.status(400).json({ error: 'serialId and newRank are required' });
    }

    const card = cardVault.get(serialId);
    if (!card) {
      return res.status(404).json({ error: `Card '${serialId}' not found in vault` });
    }

    const oldRank = card.issuedTo.assignedRank;
    card.issuedTo.assignedRank = newRank;

    const actor = {
      discordId: performedBy?.discordId || 'ADMIN',
      discordTag: performedBy?.discordTag || 'Commanding Officer',
    };

    card.history.push({
      action: 'PROMOTED',
      performedBy: actor,
      timestamp: new Date().toISOString(),
      details: reason || `Promoted from ${oldRank} to ${newRank} by ${actor.discordTag}`,
    });

    cardVault.set(serialId, card);
    return res.json({ success: true, card, oldRank, newRank });
  });

  // POST /api/card/revoke - Command 4b: /card revoke @user [reason]
  app.post('/api/card/revoke', (req, res) => {
    const { serialId, reason, performedBy } = req.body;
    if (!serialId) {
      return res.status(400).json({ error: 'serialId is required' });
    }

    const card = cardVault.get(serialId);
    if (!card) {
      return res.status(404).json({ error: `Card '${serialId}' not found in vault` });
    }

    const actor = {
      discordId: performedBy?.discordId || 'ADMIN',
      discordTag: performedBy?.discordTag || 'Commanding Officer',
    };

    card.status = 'REVOKED';
    card.revokeReason = reason || 'Administrative revocation by commanding officer';
    card.serverNickname = `${card.issuedTo.fullName} [REVOKED]`;

    card.history.push({
      action: 'REVOKED',
      performedBy: actor,
      timestamp: new Date().toISOString(),
      details: `Revoked by ${actor.discordTag}. Reason: ${card.revokeReason}`,
    });

    cardVault.set(serialId, card);
    return res.json({ success: true, card });
  });

  // Vite middleware for development vs static dist for production

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
