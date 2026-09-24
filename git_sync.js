// ============================================================================
// UOI Bot - Git Auto-Sync & Automatic Commit Deployment Engine
// Features: GitHub Webhooks, Git Polling, HMAC Signature Verification, Graceful Auto-Restart
// ============================================================================

import { exec, execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const COMMIT_HISTORY_FILE = path.join(process.cwd(), 'data', 'commit_history.json');

// Memory cache for git state
let currentGitState = {
  isGitRepo: false,
  branch: 'main',
  commitHash: 'initial',
  shortHash: 'init',
  commitMessage: 'Initial build',
  commitAuthor: 'System',
  commitDate: new Date().toISOString(),
  remoteUrl: null,
  githubRepo: process.env.GITHUB_REPO || null,
  lastChecked: new Date().toISOString(),
  autoRestartEnabled: true,
  lastRestartReason: null,
};

/**
 * Initialize and read initial git state from filesystem or environment.
 */
export function initGitState() {
  try {
    const isGit = fs.existsSync(path.join(process.cwd(), '.git'));
    currentGitState.isGitRepo = isGit;

    if (isGit) {
      try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        const hash = execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        const msg = execSync('git log -1 --pretty=%B', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        const author = execSync('git log -1 --pretty=%an', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        const date = execSync('git log -1 --pretty=%cd --date=iso', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();

        currentGitState.branch = branch || 'main';
        currentGitState.commitHash = hash;
        currentGitState.shortHash = hash.substring(0, 7);
        currentGitState.commitMessage = msg;
        currentGitState.commitAuthor = author;
        currentGitState.commitDate = date;

        try {
          const remote = execSync('git config --get remote.origin.url', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
          currentGitState.remoteUrl = remote;
          if (remote && !currentGitState.githubRepo) {
            const match = remote.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
            if (match) currentGitState.githubRepo = match[1];
          }
        } catch (_) {}
      } catch (err) {
        console.warn('[Git Sync] Could not parse local git repository:', err.message);
      }
    } else {
      // Non-git filesystem or container environment
      if (fs.existsSync(COMMIT_HISTORY_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(COMMIT_HISTORY_FILE, 'utf8'));
          if (saved.latestCommit) {
            currentGitState = { ...currentGitState, ...saved.latestCommit };
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    console.warn('[Git Sync] Init git state error:', err.message);
  }

  currentGitState.lastChecked = new Date().toISOString();
  return currentGitState;
}

/**
 * Returns the current live Git & deployment status.
 */
export function getGitStatus() {
  currentGitState.lastChecked = new Date().toISOString();
  return {
    ...currentGitState,
    webhookEndpoint: '/api/webhook/github',
    pollIntervalSeconds: parseInt(process.env.GIT_POLL_INTERVAL || '45', 10),
    autoPullEnabled: process.env.GIT_AUTO_PULL !== 'false',
  };
}

/**
 * Save commit info to local storage for persistence across restarts.
 */
function recordCommitHistory(commitData) {
  try {
    const dataDir = path.dirname(COMMIT_HISTORY_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    let history = { commits: [], latestCommit: null };
    if (fs.existsSync(COMMIT_HISTORY_FILE)) {
      try {
        history = JSON.parse(fs.readFileSync(COMMIT_HISTORY_FILE, 'utf8'));
      } catch (_) {}
    }

    history.latestCommit = commitData;
    history.commits = history.commits || [];
    history.commits.unshift({
      ...commitData,
      recordedAt: new Date().toISOString(),
    });
    // Keep last 25 commits
    history.commits = history.commits.slice(0, 25);

    fs.writeFileSync(COMMIT_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Git Sync] Error recording commit history:', err.message);
  }
}

/**
 * Verify GitHub webhook HMAC-SHA256 signature if a secret is configured.
 */
export function verifyGitHubSignature(payloadBuffer, signatureHeader, secret) {
  if (!secret) return true; // Secret optional if not configured
  if (!signatureHeader) return false;

  try {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payloadBuffer);
    const expectedSig = `sha256=${hmac.digest('hex')}`;
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expectedSig));
  } catch (err) {
    console.error('[Git Sync] Signature verification error:', err.message);
    return false;
  }
}

/**
 * Perform a graceful restart of the process so process managers (PM2, Docker, Pterodactyl, Systemd)
 * restart the server with the latest code.
 */
export function gracefulRestart(reason = 'Git Commit Auto-Deploy') {
  console.log(`\n🔄 [Git Sync] RESTART TRIGGERED: ${reason}`);
  console.log('🔄 [Git Sync] Terminating current process gracefully for auto-restart...');

  currentGitState.lastRestartReason = reason;

  // Destroy Discord client connection gracefully if active
  if (globalThis.__uoiBotClient) {
    try {
      globalThis.__uoiBotClient.destroy();
      console.log('🔄 [Git Sync] Discord bot client disconnected.');
    } catch (_) {}
  }

  // Delay 750ms so HTTP responses and audit logs finish writing cleanly
  setTimeout(() => {
    process.exit(0);
  }, 750);
}

/**
 * Execute git pull on the server repository.
 */
export async function pullLatestCode() {
  return new Promise((resolve) => {
    if (!fs.existsSync(path.join(process.cwd(), '.git'))) {
      return resolve({
        success: false,
        message: 'No local .git directory found. Webhook payload registered without git pull.',
      });
    }

    exec('git pull', { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('[Git Sync] git pull error:', error.message);
        return resolve({
          success: false,
          error: error.message,
          output: stderr || stdout,
        });
      }

      console.log('[Git Sync] git pull output:\n', stdout);
      initGitState();
      resolve({
        success: true,
        output: stdout,
      });
    });
  });
}

/**
 * Handle incoming GitHub Webhook HTTP requests (/api/webhook/github or /webhook).
 */
export async function handleGitHubWebhook(req, res, rawBodyBuffer) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET || process.env.GITHUB_SECRET;
  const signature = req.headers['x-hub-signature-256'] || req.headers['x-hub-signature'];
  const githubEvent = req.headers['x-github-event'] || 'push';

  // 1. Signature Verification
  if (secret && !verifyGitHubSignature(rawBodyBuffer, signature, secret)) {
    console.warn('[Git Sync] ❌ Rejected webhook with invalid HMAC signature.');
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid HMAC signature.' }));
  }

  // 2. Ping Event (GitHub test webhook ping)
  if (githubEvent === 'ping') {
    console.log('[Git Sync] 🏓 Received GitHub Webhook Ping event. Connection verified!');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        success: true,
        message: 'GitHub webhook ping received. UOI Auto-Deploy is connected and listening.',
      })
    );
  }

  // 3. Push Event (New Commit)
  if (githubEvent === 'push') {
    try {
      const payload = JSON.parse(rawBodyBuffer.toString('utf8'));
      const ref = payload.ref || 'refs/heads/main';
      const branch = ref.replace(/^refs\/heads\//, '');
      const headCommit = payload.head_commit || payload.commits?.[payload.commits.length - 1] || {};
      const commitHash = payload.after || headCommit.id || 'unknown';
      const shortHash = commitHash.substring(0, 7);
      const commitMessage = headCommit.message || 'No commit message';
      const commitAuthor = headCommit.author?.name || payload.pusher?.name || 'GitHub User';
      const commitUrl = headCommit.url || payload.compare || '';
      const repoFullName = payload.repository?.full_name || currentGitState.githubRepo;

      console.log(`\n======================================================`);
      console.log(`🚀 [Git Sync] INCOMING REPOSITORY COMMIT DETECTED!`);
      console.log(`• Repository: ${repoFullName || 'Local'}`);
      console.log(`• Branch:     ${branch}`);
      console.log(`• Commit SHA: ${shortHash} (${commitHash})`);
      console.log(`• Author:     ${commitAuthor}`);
      console.log(`• Message:    ${commitMessage.split('\n')[0]}`);
      console.log(`======================================================\n`);

      const commitData = {
        branch,
        commitHash,
        shortHash,
        commitMessage,
        commitAuthor,
        commitUrl,
        githubRepo: repoFullName,
        commitDate: headCommit.timestamp || new Date().toISOString(),
        deployedAt: new Date().toISOString(),
      };

      currentGitState = { ...currentGitState, ...commitData };
      recordCommitHistory(commitData);

      // Perform git pull if git repo
      let pullResult = null;
      if (fs.existsSync(path.join(process.cwd(), '.git'))) {
        pullResult = await pullLatestCode();
      }

      // Respond immediately to GitHub HTTP request with 200 OK
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          message: `Commit ${shortHash} accepted. Auto-restarting server...`,
          commit: commitData,
          pullResult,
        })
      );

      // Trigger server restart
      gracefulRestart(`GitHub Push: ${shortHash} ("${commitMessage.split('\n')[0]}")`);
      return;
    } catch (parseErr) {
      console.error('[Git Sync] Error processing webhook push payload:', parseErr);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Malformed JSON payload: ' + parseErr.message }));
    }
  }

  // Other GitHub events
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ message: `Event "${githubEvent}" received (no action needed).` }));
}

/**
 * Background watcher: periodically checks GitHub repository API or local git commits.
 */
let watcherInterval = null;
export function startGitCommitWatcher() {
  if (watcherInterval) clearInterval(watcherInterval);

  initGitState();
  const pollSeconds = parseInt(process.env.GIT_POLL_INTERVAL || '45', 10);
  const repoName = process.env.GITHUB_REPO || currentGitState.githubRepo;

  console.log(`👀 [Git Sync] Auto-Restart on commit is ACTIVE (Webhook endpoint: /api/webhook/github, Polling interval: ${pollSeconds}s)`);

  watcherInterval = setInterval(async () => {
    try {
      // 1. Check local git repo if available
      if (fs.existsSync(path.join(process.cwd(), '.git'))) {
        try {
          exec('git rev-parse HEAD', { encoding: 'utf8', timeout: 5000 }, (err, stdout) => {
            if (!err && stdout) {
              const currentHead = stdout.trim();
              if (currentGitState.commitHash && currentGitState.commitHash !== 'initial' && currentHead !== currentGitState.commitHash) {
                console.log(`[Git Sync] Detected local commit update: ${currentHead.substring(0, 7)}`);
                initGitState();
                gracefulRestart(`Local Git Commit Update (${currentHead.substring(0, 7)})`);
              }
            }
          });
        } catch (_) {}
      }

      // 2. Poll GitHub API if GITHUB_REPO is provided
      if (repoName) {
        try {
          const headers = {
            'User-Agent': 'UOI-Discord-Bot-AutoSync',
            Accept: 'application/vnd.github.v3+json',
          };
          if (process.env.GITHUB_TOKEN) {
            headers.Authorization = `token ${process.env.GITHUB_TOKEN}`;
          }

          const resp = await fetch(`https://api.github.com/repos/${repoName}/commits?per_page=1`, {
            headers,
            signal: AbortSignal.timeout(8000),
          });

          if (resp.ok) {
            const commits = await resp.json();
            const latest = commits?.[0];
            if (latest && latest.sha) {
              const remoteSha = latest.sha;
              if (currentGitState.commitHash && currentGitState.commitHash !== 'initial' && remoteSha !== currentGitState.commitHash) {
                console.log(`[Git Sync] 🚀 New remote commit detected on GitHub: ${remoteSha.substring(0, 7)} - "${latest.commit?.message?.split('\n')[0]}"`);
                
                const commitData = {
                  commitHash: remoteSha,
                  shortHash: remoteSha.substring(0, 7),
                  commitMessage: latest.commit?.message || 'Remote commit',
                  commitAuthor: latest.commit?.author?.name || 'GitHub Committer',
                  commitDate: latest.commit?.author?.date || new Date().toISOString(),
                  githubRepo: repoName,
                  deployedAt: new Date().toISOString(),
                };

                recordCommitHistory(commitData);
                if (fs.existsSync(path.join(process.cwd(), '.git'))) {
                  await pullLatestCode();
                }

                gracefulRestart(`GitHub Remote Commit: ${commitData.shortHash}`);
              }
            }
          }
        } catch (_) {}
      }
    } catch (pollErr) {
      // Silent error catching to keep bot healthy
    }
  }, pollSeconds * 1000);
}
