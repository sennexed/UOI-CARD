import { useEffect, useRef, useState, useCallback } from 'react';
import JSZip from 'jszip';
import { ProcessedCardData, ROLE_HIERARCHY, RobloxUserData } from '../types';
import {
  Download,
  ShieldCheck,
  CheckCircle2,
  Upload,
  User,
  Sliders,
  Trash2,
  Globe2,
  Hash,
  Archive,
  Check,
  Image as ImageIcon,
  Loader2,
  Eye,
  Maximize2,
  X,
} from 'lucide-react';
import { saveStoredImage, getStoredImage, removeStoredImage } from '../utils/imageStore';

interface CanvasIdCardProps {
  data: ProcessedCardData;
  robloxAvatar?: string | null;
  robloxUser?: RobloxUserData | null;
  externalSerialId?: string;
  onSerialIdChange?: (newSerial: string) => void;
}

export function CanvasIdCard({
  data,
  robloxAvatar,
  robloxUser,
  externalSerialId,
  onSerialIdChange,
}: CanvasIdCardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  // Permanent template image (the user's official template image)
  const [templateImg, setTemplateImg] = useState<HTMLImageElement | null>(null);
  const [templateLoaded, setTemplateLoaded] = useState<boolean>(false);
  const [templateFileName, setTemplateFileName] = useState<string>('');

  // User avatar image (uploaded custom headshot)
  const [avatarImg, setAvatarImg] = useState<HTMLImageElement | null>(null);
  const [avatarLoaded, setAvatarLoaded] = useState<boolean>(false);

  // Fine-tuning adjustments (X/Y offsets for text fields)
  const [offsetY, setOffsetY] = useState<number>(0);
  const [offsetX, setOffsetX] = useState<number>(0);
  const [fontSize, setFontSize] = useState<number>(22);
  const [showAdjustments, setShowAdjustments] = useState<boolean>(false);

  // Serial ID adjustments and state
  const [serialId, setSerialId] = useState<string>(() => {
    return externalSerialId || `UOI-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
  });

  useEffect(() => {
    if (externalSerialId && externalSerialId !== serialId) {
      setSerialId(externalSerialId);
    }
  }, [externalSerialId]);

  const handleUpdateSerial = (newVal: string) => {
    setSerialId(newVal);
    onSerialIdChange?.(newVal);
  };

  const [serialX, setSerialX] = useState<number>(1010);
  const [serialY, setSerialY] = useState<number>(36);

  // ZIP download state
  const [zipping, setZipping] = useState<boolean>(false);
  const [zipDownloaded, setZipDownloaded] = useState<boolean>(false);

  // Full-screen / Pop-out Preview Modal state
  const [showFullPreview, setShowFullPreview] = useState<boolean>(false);
  const [previewDataUrl, setPreviewDataUrl] = useState<string>('');

  // Load image from Data URL helper
  const loadImageFromDataUrl = useCallback((dataUrl: string, onSuccess: (img: HTMLImageElement) => void) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => onSuccess(img);
    img.src = dataUrl;
  }, []);

  // Sync Roblox avatar from live API
  useEffect(() => {
    if (robloxAvatar) {
      loadImageFromDataUrl(robloxAvatar, (img) => {
        setAvatarImg(img);
        setAvatarLoaded(true);
        saveStoredImage('member_avatar', robloxAvatar);
      });
    }
  }, [robloxAvatar, loadImageFromDataUrl]);

  const loadImageFile = (file: File, onSuccess: (img: HTMLImageElement, dataUrl: string) => void) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      const img = new Image();
      img.onload = () => onSuccess(img, dataUrl);
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  // Restore saved template from IndexedDB or permanent /public assets on initial mount
  useEffect(() => {
    let isMounted = true;
    (async () => {
      // Check IndexedDB first
      const savedTemplate = await getStoredImage('card_template');
      if (savedTemplate && isMounted) {
        loadImageFromDataUrl(savedTemplate, (img) => {
          setTemplateImg(img);
          setTemplateLoaded(true);
          setTemplateFileName('Official UOI Template (Saved)');
        });
      } else {
        // Check for public template files
        const testImg = new Image();
        testImg.onload = () => {
          if (isMounted) {
            setTemplateImg(testImg);
            setTemplateLoaded(true);
            setTemplateFileName('Official Permanent Template');
          }
        };
        testImg.onerror = () => {
          const testJpg = new Image();
          testJpg.onload = () => {
            if (isMounted) {
              setTemplateImg(testJpg);
              setTemplateLoaded(true);
              setTemplateFileName('Official Permanent Template (JPG)');
            }
          };
          testJpg.src = '/template.jpg';
        };
        testImg.src = '/template.png';
      }

      // Check saved avatar
      const savedAvatar = await getStoredImage('member_avatar');
      if (savedAvatar && isMounted) {
        loadImageFromDataUrl(savedAvatar, (img) => {
          setAvatarImg(img);
          setAvatarLoaded(true);
        });
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [loadImageFromDataUrl]);

  // Handle template file upload & persist
  const loadTemplateFromFile = (file: File) => {
    setTemplateFileName(file.name);
    loadImageFile(file, (img, dataUrl) => {
      setTemplateImg(img);
      setTemplateLoaded(true);
      saveStoredImage('card_template', dataUrl);
    });
  };

  // Handle avatar upload & persist
  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadImageFile(file, (img, dataUrl) => {
      setAvatarImg(img);
      setAvatarLoaded(true);
      saveStoredImage('member_avatar', dataUrl);
    });
  };

  // Drag and Drop support
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;

    const name = file.name.toLowerCase();
    if (name.includes('avatar') || name.includes('headshot') || name.includes('member') || name.includes('skin')) {
      loadImageFile(file, (img, dataUrl) => {
        setAvatarImg(img);
        setAvatarLoaded(true);
        saveStoredImage('member_avatar', dataUrl);
      });
    } else {
      // Default to permanent template image
      loadTemplateFromFile(file);
    }
  };

  // Clipboard paste (Ctrl+V anywhere on window)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            loadTemplateFromFile(file);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  // Helper: Rounded Rectangle
  function roundRect(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  // ========================================================
  // STRICT TEMPLATE RENDERING:
  // "strictly just edit the blank boxes or lines and image are nothing else"
  // ========================================================
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Standard card canvas resolution matching the official 4:3 template
    const W = 1200;
    const H = 900;
    canvas.width = W;
    canvas.height = H;

    // STEP 1: Draw the official permanent template image as untouched background
    if (templateLoaded && templateImg) {
      ctx.drawImage(templateImg, 0, 0, W, H);
    } else {
      // Clean fallback frame while waiting for the template image
      ctx.fillStyle = '#0b1120';
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 3;
      ctx.strokeRect(10, 10, W - 20, H - 20);

      ctx.fillStyle = '#CBD5E1';
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PERMANENT TEMPLATE FILL ENGINE', W / 2, H / 2 - 40);

      ctx.fillStyle = '#94A3B8';
      ctx.font = '16px system-ui, sans-serif';
      ctx.fillText(
        'Drop your official template image (image_505a3bc4.jpg) here or click "Load Permanent Template"',
        W / 2,
        H / 2
      );

      ctx.font = '14px monospace';
      ctx.fillStyle = '#38BDF8';
      ctx.fillText('Or press Ctrl+V to paste the image directly from your clipboard', W / 2, H / 2 + 35);
      ctx.textAlign = 'left';
    }

    // STEP 2: Fill in CARD SERIAL ID on the top-right line
    // "CARD SERIAL ID: _________________"
    // Positioned cleanly on top of the line without colliding with the label
    ctx.save();
    ctx.fillStyle = '#38BDF8';
    ctx.font = 'bold 14px "Courier New", Courier, monospace';
    ctx.letterSpacing = '1px';
    ctx.fillText(serialId, serialX, serialY);
    ctx.restore();

    // STEP 3: Fill in MEMBER AVATAR into the photo box
    // Position of the avatar frame on the template:
    const pX = 56 + offsetX;
    const pY = 320 + offsetY;
    const pW = 345;
    const pH = 352;

    if (avatarLoaded && avatarImg) {
      ctx.save();
      ctx.beginPath();
      // Clip inside inner border of the photo frame
      ctx.rect(pX + 4, pY + 4, pW - 8, pH - 8);
      ctx.clip();
      ctx.drawImage(avatarImg, pX + 4, pY + 4, pW - 8, pH - 8);
      ctx.restore();
    } else if (!templateLoaded) {
      // Guide outline only if no template image
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.strokeRect(pX, pY, pW, pH);
    }

    // STEP 4: Fill in RANK in the rank box below photo
    // On the template, this box has 'COMMUNITY MEMBER' by default
    const rankBoxX = 54 + offsetX;
    const rankBoxY = 687 + offsetY;
    const rankBoxW = 348;
    const rankBoxH = 46;

    const matchedRole = ROLE_HIERARCHY.find((r) => r.name === data.assignedRank);
    const badgeBorderColor = matchedRole?.badgeBorder || '#F59E0B';

    // Cover the placeholder rank text with dark backdrop and gold frame
    ctx.save();
    ctx.fillStyle = '#080d19';
    roundRect(ctx, rankBoxX, rankBoxY, rankBoxW, rankBoxH, 4);
    ctx.fill();

    ctx.strokeStyle = badgeBorderColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 20px system-ui, -apple-system, sans-serif';
    ctx.letterSpacing = '1.5px';
    ctx.textAlign = 'center';
    ctx.fillText(data.assignedRank, rankBoxX + rankBoxW / 2, rankBoxY + 31);
    ctx.textAlign = 'left';
    ctx.restore();

    // STEP 5: Fill in the 5 BLANK BOXES on the right
    // Each field is positioned precisely inside its corresponding blank box
    const fieldX = 472 + offsetX;
    const fieldValues = [
      { label: 'FULL NAME', val: data.fullName, textY: 358 + offsetY },
      { label: 'ROBLOX USERNAME', val: data.robloxUsername ? `@${data.robloxUsername}` : '', textY: 446 + offsetY },
      { label: 'ROBLOX USER ID', val: data.robloxUserId, textY: 534 + offsetY },
      { label: 'GENDER', val: data.gender, textY: 622 + offsetY },
      { label: 'RANK / ROLE', val: data.assignedRank, textY: 710 + offsetY },
    ];

    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.letterSpacing = '0.5px';

    fieldValues.forEach((f) => {
      if (f.val) {
        ctx.fillText(f.val, fieldX + 18, f.textY);
      }
    });
    ctx.restore();

    // STEP 6: STRICTLY NOTHING ELSE TOUCHED!
    // Logos, barcode, headers, national ribbon, and city skyline remain 100% original.
    // Signature is omitted as requested.
  }, [
    data,
    templateImg,
    templateLoaded,
    avatarImg,
    avatarLoaded,
    serialId,
    serialX,
    serialY,
    offsetY,
    offsetX,
    fontSize,
  ]);

  // Download the edited permanent card (PNG only)
  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png', 1.0);
    const link = document.createElement('a');
    link.download = `UOI_ID_${data.robloxUsername || 'MEMBER'}_${data.assignedRank}.png`;
    link.href = url;
    link.click();
  };

  // Download Complete Citizen ID Bundle (.ZIP)
  const handleDownloadZip = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setZipping(true);
    setZipDownloaded(false);

    try {
      const zip = new JSZip();
      const safeUser = data.robloxUsername || 'CITIZEN';
      const filePrefix = `UOI_${safeUser}_${serialId}`;

      // 1. High-Resolution 1200x900 ID Card Image (PNG)
      const dataUrl = canvas.toDataURL('image/png', 1.0);
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
      zip.file(`${filePrefix}.png`, base64Data, { base64: true });

      // 2. Structured Metadata Dossier (JSON)
      const dossierPayload = {
        serialId,
        status: 'ACTIVE',
        issuedTo: {
          fullName: data.fullName,
          robloxUsername: data.robloxUsername,
          robloxUserId: data.robloxUserId,
          gender: data.gender,
          assignedRank: data.assignedRank,
          roleIds: data.roleIds,
        },
        serverNickname: `${data.fullName} [${serialId}]`,
        issuedAt: new Date().toISOString(),
        format: {
          dimensions: '1200x900',
          type: 'Official Identification Document',
          jurisdiction: 'Union of Indians (UOI)',
        },
        verification: {
          slashCommand: `/card verify ${serialId}`,
          apiEndpoint: `/api/card/verify/${serialId}`,
        },
      };
      zip.file(`dossier_${serialId}.json`, JSON.stringify(dossierPayload, null, 2));

      // 3. Discord Server Nickname Text File
      zip.file('server-nickname.txt', `${data.fullName} [${serialId}]\n`);

      // 4. Verification Readme File
      const readmeText = `===================================================================
UNION OF INDIANS (UOI) - OFFICIAL CITIZEN IDENTIFICATION BUNDLE
===================================================================

Citizen Full Name : ${data.fullName}
Assigned Rank     : ${data.assignedRank}
Roblox Username   : @${data.robloxUsername || 'Unlinked'}
Roblox User ID    : ${data.robloxUserId || 'Unlinked'}
Card Serial ID    : ${serialId}
Server Nickname   : ${data.fullName} [${serialId}]
Generated At      : ${new Date().toUTCString()}

DISCORD SERVER VERIFICATION:
To check this card's authenticity in your server, run:
/card verify ${serialId}

PACKAGE CONTENTS:
1. ${filePrefix}.png  - 1200x900 HD Official ID Card
2. dossier_${serialId}.json     - Complete JSON security dossier & API attributes
3. server-nickname.txt         - Auto-formatted Discord server nickname
4. README_VERIFICATION.txt     - This official verification guide

-------------------------------------------------------------------
All official Union emblems, national ribbon, and barcode remain genuine.
`;
      zip.file('README_VERIFICATION.txt', readmeText);

      // Generate the zip blob and trigger client download
      const blob = await zip.generateAsync({ type: 'blob' });
      const downloadUrl = URL.createObjectURL(blob);
      const tempLink = document.createElement('a');
      tempLink.href = downloadUrl;
      tempLink.download = `${filePrefix}_Package.zip`;
      document.body.appendChild(tempLink);
      tempLink.click();
      document.body.removeChild(tempLink);
      URL.revokeObjectURL(downloadUrl);

      setZipDownloaded(true);
      setTimeout(() => setZipDownloaded(false), 4000);
    } catch (err) {
      console.error('Error generating card .zip archive:', err);
    } finally {
      setZipping(false);
    }
  };

  return (
    <div id="canvas-card-container" className="flex flex-col gap-3">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/90 border border-slate-800 rounded-xl px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold tracking-wide text-white uppercase">
                Permanent Template Fill Node
              </h2>
              <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                Strict Fill Mode
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Only stamps blank boxes, lines, and avatar image. All official artwork and logos are untouched.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Download Complete Package (.ZIP) Button */}
          <button
            id="btn-download-zip"
            onClick={handleDownloadZip}
            disabled={zipping}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer shadow-lg ${
              zipDownloaded
                ? 'bg-emerald-500 text-slate-950 shadow-emerald-500/20'
                : 'bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 active:from-amber-500 active:to-amber-600 text-slate-950 shadow-amber-400/20'
            }`}
            title="Download full package: 1200x900 HD Card, JSON Dossier, Server Nickname, and Verification Guide in a .ZIP file"
          >
            {zipping ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Compiling .ZIP...</span>
              </>
            ) : zipDownloaded ? (
              <>
                <Check className="w-4 h-4" />
                <span>Downloaded .ZIP!</span>
              </>
            ) : (
              <>
                <Archive className="w-4 h-4" />
                <span>Download .ZIP Package</span>
              </>
            )}
          </button>

          {/* Download Edited Card (PNG) */}
          <button
            id="btn-download-canvas"
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 hover:text-white border border-slate-700 rounded-lg transition-all cursor-pointer"
            title="Download high resolution 1200x900 PNG only"
          >
            <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
            <span>Download PNG</span>
          </button>
        </div>
      </div>

      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) loadTemplateFromFile(file);
        }}
        className="hidden"
      />
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        onChange={handleAvatarUpload}
        className="hidden"
      />

      {/* Template & Avatar Controls */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* Load Permanent Template Button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer font-medium transition-all ${
              templateLoaded
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40 shadow-sm'
                : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
            }`}
            title="Load your permanent template image (image_505a3bc4.jpg)"
          >
            <Upload className="w-3.5 h-3.5 text-amber-400" />
            <span>{templateLoaded ? 'Change Permanent Template' : 'Load Permanent Template (image_505a3bc4.jpg)'}</span>
          </button>

          {templateLoaded && (
            <button
              onClick={async () => {
                await removeStoredImage('card_template');
                setTemplateImg(null);
                setTemplateLoaded(false);
                setTemplateFileName('');
              }}
              className="p-1.5 text-slate-500 hover:text-rose-400 cursor-pointer"
              title="Reset template"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Upload Member Avatar Button */}
          <button
            onClick={() => avatarInputRef.current?.click()}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-all ${
              avatarLoaded
                ? 'bg-slate-800 text-sky-300 border-sky-500/40'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
          >
            <User className="w-3.5 h-3.5 text-sky-400" />
            <span>{avatarLoaded ? 'Change Avatar' : 'Upload Member Avatar'}</span>
          </button>

          {avatarLoaded && (
            <button
              onClick={async () => {
                await removeStoredImage('member_avatar');
                setAvatarImg(null);
                setAvatarLoaded(false);
              }}
              className="p-1.5 text-slate-500 hover:text-rose-400 cursor-pointer"
              title="Remove avatar"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Fine Tuning Offsets */}
          <button
            onClick={() => setShowAdjustments(!showAdjustments)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-colors cursor-pointer ${
              showAdjustments
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
            title="Fine-tune text coordinates and sizing"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Adjust Text Alignment</span>
          </button>
        </div>
      </div>

      {/* Fine-Tuning Slider Bar */}
      {showAdjustments && (
        <div className="bg-slate-900 border border-amber-500/30 rounded-xl p-3 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-amber-400 font-medium">Vertical Y-Offset:</span>
              <input
                type="range"
                min="-40"
                max="40"
                value={offsetY}
                onChange={(e) => setOffsetY(parseInt(e.target.value))}
                className="w-28 accent-amber-400"
              />
              <span className="font-mono text-slate-300 w-8">{offsetY}px</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-amber-400 font-medium">Horizontal X-Offset:</span>
              <input
                type="range"
                min="-40"
                max="40"
                value={offsetX}
                onChange={(e) => setOffsetX(parseInt(e.target.value))}
                className="w-28 accent-amber-400"
              />
              <span className="font-mono text-slate-300 w-8">{offsetX}px</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-amber-400 font-medium">Text Size:</span>
              <input
                type="range"
                min="18"
                max="28"
                value={fontSize}
                onChange={(e) => setFontSize(parseInt(e.target.value))}
                className="w-24 accent-amber-400"
              />
              <span className="font-mono text-slate-300 w-8">{fontSize}px</span>
            </div>

            <div className="flex items-center gap-2">
              <Hash className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-slate-300">Serial ID:</span>
              <input
                type="text"
                value={serialId}
                onChange={(e) => handleUpdateSerial(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-xs text-sky-300 font-mono w-36 focus:outline-none focus:border-amber-400"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sky-400 font-medium">Serial X:</span>
              <input
                type="range"
                min="960"
                max="1060"
                value={serialX}
                onChange={(e) => setSerialX(parseInt(e.target.value))}
                className="w-20 accent-sky-400"
              />
              <span className="font-mono text-slate-300 w-8">{serialX}</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sky-400 font-medium">Serial Y:</span>
              <input
                type="range"
                min="20"
                max="60"
                value={serialY}
                onChange={(e) => setSerialY(parseInt(e.target.value))}
                className="w-20 accent-sky-400"
              />
              <span className="font-mono text-slate-300 w-8">{serialY}</span>
            </div>
          </div>

          <button
            onClick={() => {
              setOffsetY(0);
              setOffsetX(0);
              setFontSize(22);
              setSerialX(1010);
              setSerialY(36);
            }}
            className="text-[11px] text-slate-400 hover:text-amber-300 cursor-pointer underline"
          >
            Reset Offsets
          </button>
        </div>
      )}

      {/* Main Canvas Frame with Drag-and-Drop & Direct Preview Action Buttons */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="relative w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-2xl transition-all flex flex-col"
      >
        {/* PREVIEW TOOLBAR: Direct download buttons on the preview option */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 bg-slate-900/95 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-xs font-bold tracking-wide text-slate-200 flex items-center gap-1.5">
              <Eye className="w-4 h-4 text-amber-400" />
              HD Card Preview
            </span>
            <span className="font-mono text-[11px] text-sky-300 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded">
              {serialId}
            </span>
            <span className="text-[10px] text-slate-400 hidden sm:inline">
              (1200×900 Native)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* DIRECT DOWNLOAD .ZIP BUTTON ON PREVIEW */}
            <button
              id="preview-btn-download-zip"
              onClick={handleDownloadZip}
              disabled={zipping}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer shadow-md ${
                zipDownloaded
                  ? 'bg-emerald-500 text-slate-950 shadow-emerald-500/30'
                  : 'bg-amber-400 hover:bg-amber-300 active:bg-amber-500 text-slate-950 shadow-amber-400/20'
              }`}
              title="Download full package with HD Card PNG, JSON Dossier, Server Nickname, and Readme in .ZIP"
            >
              {zipping ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Zipping...</span>
                </>
              ) : zipDownloaded ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Downloaded .ZIP!</span>
                </>
              ) : (
                <>
                  <Archive className="w-3.5 h-3.5 text-slate-950" />
                  <span>Download .ZIP</span>
                </>
              )}
            </button>

            {/* DIRECT DOWNLOAD PNG BUTTON ON PREVIEW */}
            <button
              id="preview-btn-download-png"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-200 border border-slate-700 cursor-pointer transition-colors shadow-sm"
              title="Download high-resolution 1200x900 PNG"
            >
              <Download className="w-3.5 h-3.5 text-slate-400" />
              <span>Download PNG</span>
            </button>

            {/* FULL RESOLUTION MODAL PREVIEW BUTTON */}
            <button
              id="preview-btn-full-view"
              onClick={() => {
                const canvas = canvasRef.current;
                if (canvas) {
                  setPreviewDataUrl(canvas.toDataURL('image/png', 1.0));
                  setShowFullPreview(true);
                }
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/80 cursor-pointer transition-colors"
              title="Expand to Full Resolution Modal"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Zoom Fullscreen</span>
            </button>
          </div>
        </div>

        {!templateLoaded && (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="m-3 border-2 border-dashed border-amber-500/40 hover:border-amber-400/80 bg-amber-500/5 hover:bg-amber-500/10 rounded-xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2"
          >
            <div className="w-12 h-12 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Upload className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold text-white">
              Drop your permanent template (<span className="text-amber-400">image_505a3bc4.jpg</span>) here
            </p>
            <p className="text-xs text-slate-400">
              Or click to browse from your device, or paste with <kbd className="px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700 font-mono text-amber-300">Ctrl+V</kbd>
            </p>
            <span className="text-[11px] text-emerald-400 font-mono mt-1">
              ✓ Saved permanently in your browser once loaded
            </span>
          </div>
        )}

        <div className="w-full overflow-x-auto flex justify-center p-3">
          <canvas
            id="uoi-id-canvas"
            ref={canvasRef}
            className="rounded-lg shadow-2xl max-w-full h-auto border border-slate-800/80 cursor-zoom-in"
            style={{ width: '100%', maxWidth: '920px' }}
            onClick={() => {
              const canvas = canvasRef.current;
              if (canvas) {
                setPreviewDataUrl(canvas.toDataURL('image/png', 1.0));
                setShowFullPreview(true);
              }
            }}
            title="Click card to zoom in full resolution modal"
          />
        </div>

        {/* Action bar directly attached to bottom of preview canvas */}
        <div className="bg-slate-900/80 border-t border-slate-800/80 px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <span className="text-[11px]">Server Nickname:</span>
            <code className="px-2 py-0.5 bg-slate-950 border border-slate-800 rounded font-mono text-emerald-300 text-[11px]">
              {data.fullName} [{serialId}]
            </code>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadZip}
              disabled={zipping}
              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-md cursor-pointer transition-colors shadow-sm"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>Download .ZIP Package</span>
            </button>
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-md border border-slate-700 cursor-pointer transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>PNG</span>
            </button>
          </div>
        </div>
      </div>

      {/* FULL RESOLUTION ZOOM PREVIEW MODAL */}
      {showFullPreview && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/80">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="font-bold text-sm text-white">Full-Resolution Card Preview (1200×900)</h3>
                  <p className="text-[11px] text-slate-400">
                    Official Union of Indians (UOI) Identification Document • Serial: <span className="text-sky-300 font-mono">{serialId}</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadZip}
                  disabled={zipping}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-lg cursor-pointer transition-colors shadow-sm"
                >
                  <Archive className="w-4 h-4" />
                  <span>Download .ZIP</span>
                </button>
                <button
                  onClick={handleDownload}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 cursor-pointer transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Download PNG</span>
                </button>
                <button
                  onClick={() => setShowFullPreview(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer transition-colors ml-2"
                  title="Close preview"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Image Body */}
            <div className="p-4 overflow-auto flex items-center justify-center bg-slate-950">
              {previewDataUrl && (
                <img
                  src={previewDataUrl}
                  alt="Full resolution ID Card"
                  className="max-w-full h-auto rounded-lg shadow-2xl border border-slate-800"
                />
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-800 bg-slate-950/60 text-xs text-slate-400">
              <span>Status: <strong className="text-emerald-400">AUTHENTIC &amp; ACTIVE</strong></span>
              <span className="font-mono text-[11px] text-slate-500">Citizen: {data.fullName} ({data.assignedRank})</span>
            </div>
          </div>
        </div>
      )}

      {/* Status Bar */}
      <div className="flex flex-wrap items-center justify-between text-xs text-slate-400 px-1 gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            <span>
              {templateLoaded
                ? `Permanent Template: ${templateFileName || 'Active'}`
                : 'Waiting for template image (drop or paste)'}
            </span>
          </div>
          <span className="text-slate-600">•</span>
          <span className="text-slate-400">
            Fields Filled: 5 Blank Boxes + Serial ID + Avatar + Rank
          </span>
          {robloxUser && (
            <>
              <span className="text-slate-600">•</span>
              <span className="inline-flex items-center gap-1 text-sky-400 font-mono">
                <Globe2 className="w-3.5 h-3.5 text-sky-400" />
                Roblox: @{robloxUser.name} ({robloxUser.id})
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px] text-slate-500">
          <span>Untouched Original Graphics</span>
          <span>•</span>
          <span>1200×900 HD Output</span>
        </div>
      </div>
    </div>
  );
}
